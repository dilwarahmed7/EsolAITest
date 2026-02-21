import os
import re
import json
import difflib
import numpy as np
import xml.etree.ElementTree as ET
from pathlib import Path
from tqdm import tqdm

import torch
from torch.utils.data import Dataset, DataLoader
from torch.cuda.amp import autocast, GradScaler
from torch.optim import AdamW

from transformers import (
    T5Tokenizer,
    T5ForConditionalGeneration,
    get_linear_schedule_with_warmup
)

from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.metrics import classification_report
import joblib


# =========================
# Configuration
# =========================
class Config:
    PROJECT_ROOT = "/content/drive/MyDrive/FCEModel/FCEErrorTagger"

    BASE_PATH = "/content/drive/MyDrive/FCEModel/fce-released-dataset"
    DATASET_PATH = os.path.join(BASE_PATH, "dataset")
    PROMPTS_PATH = os.path.join(BASE_PATH, "prompts")

    MODEL_SAVE_PATH = os.path.join(PROJECT_ROOT, "trained_model")
    ERROR_CLS_FILENAME = "error_type_classifier.joblib"

    MODEL_NAME = "t5-small"
    MAX_ENCODER_LEN = 512
    MAX_NEW_TOKENS = 256
    PROMPT_MAX_TOKENS = 96

    BATCH_SIZE = 4
    EPOCHS = 10
    LEARNING_RATE = 3e-4
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    GRADIENT_ACCUMULATION_STEPS = 2
    EARLY_STOPPING_PATIENCE = 3

    INSTRUCTION_PREFIX = (
        "fix_grammar Keep meaning. Improve grammar, spelling, and punctuation. "
        "Output only the corrected text."
    )


config = Config()

print("PROJECT_ROOT:", config.PROJECT_ROOT)
print("DATASET_PATH:", config.DATASET_PATH, "| exists:", os.path.exists(config.DATASET_PATH))
print("PROMPTS_PATH:", config.PROMPTS_PATH, "| exists:", os.path.exists(config.PROMPTS_PATH))
print("MODEL_SAVE_PATH:", config.MODEL_SAVE_PATH)


ERROR_TYPES = {
    'RP': 'Punctuation',
    'DD': 'Determiner/Possessive',
    'RJ': 'Adjective form',
    'MD': 'Missing Determiner',
    'TV': 'Verb tense',
    'RT': 'Wrong preposition',
    'S': 'Spelling',
    'MT': 'Missing word',
    'RV': 'Wrong verb',
    'MP': 'Missing punctuation',
    'AGN': 'Agreement (noun)',
    'RN': 'Wrong noun',
    'FN': 'Noun form',
    'FV': 'Verb form',
    'UQ': 'Unnecessary quantifier',
    'UA': 'Unnecessary article',
    'UT': 'Unnecessary word',
    'MC': 'Missing conjunction',
    'MA': 'Missing article',
    'DN': 'Derivation (noun)',
    'UV': 'Unnecessary verb',
    'AGA': 'Agreement (article)',
    'AGV': 'Agreement (verb)',

    'UP': 'Unnecessary punctuation',
    'R':  'Replacement/word choice',
    'RD': 'Reference/Determiner',
    'W':  'Word order',
    'ID': 'Idiomatic usage',
    'UY': 'Unclear/Style',
    'RA': 'Reference/Pronoun'
}

FCE_TO_FRIENDLY = {
    "AGN": "agreement/plural",
    "AGV": "agreement/plural",
    "AGA": "agreement/plural",

    "MD": "articles/determiners",
    "MA": "articles/determiners",
    "DD": "articles/determiners",
    "UA": "articles/determiners",

    "TV": "verb tense/form",
    "FV": "verb tense/form",
    "RV": "verb tense/form",
    "UV": "verb tense/form",

    "RT": "prepositions",

    "S": "spelling",

    "RJ": "word choice/form",
    "RN": "word choice/form",
    "FN": "word choice/form",
    "R":  "word choice/form",
    "ID": "word choice/form",

    "MT": "missing word",
    "UT": "unnecessary word",

    "RP": "punctuation",
    "MP": "punctuation",
    "UP": "punctuation",

    "W": "word order",
}

MICRO_FEEDBACK = {
    "agreement/plural": "Match singular/plural forms (e.g., plural nouns usually need 'are', not 'is').",
    "articles/determiners": "Check articles and determiners (a/an/the/your). Use them when needed and remove extra ones.",
    "verb tense/form": "Check verb tense and verb form (e.g., past vs present, infinitive vs -ing).",
    "prepositions": "Check the preposition choice (e.g., 'in July' not 'on July').",
    "spelling": "Fix spelling mistakes.",
    "word choice/form": "Use the correct word or word form for the meaning (e.g., excited vs exciting).",
    "missing word": "A word is missing—add the word needed for a complete/grammatical phrase.",
    "unnecessary word": "Remove extra words that aren’t needed.",
    "punctuation": "Fix punctuation (commas, full stops, capitalization).",
    "word order": "Adjust word order to match natural English structure.",
    "other": "Review this part for grammar/usage.",
}

class PromptParser:
    def __init__(self, prompts_path):
        self.prompts_path = prompts_path
        self.prompts = {}
        self.load_prompts()

    def load_prompts(self):
        prompt_count = 0
        xml_files = list(Path(self.prompts_path).glob("*.xml"))
        for xml_file in xml_files:
            try:
                tree = ET.parse(xml_file)
                root = tree.getroot()
                for exam in root.findall('.//exam'):
                    exam_id = f"{exam.get('x')}*{exam.get('y')}"
                    for question in exam.findall('.//q'):
                        q_num = question.get('n')
                        prompt_text = ET.tostring(question, encoding='unicode', method='text')
                        prompt_text = ' '.join(prompt_text.split())
                        self.prompts[f"{exam_id}*{q_num}"] = prompt_text
                        prompt_count += 1
            except Exception as e:
                print(f"Error loading prompts from {xml_file}: {e}")

        print(f"Loaded {prompt_count} prompts from {len(xml_files)} XML files")
        if prompt_count > 0:
            print(f"Sample prompt keys: {list(self.prompts.keys())[:3]}")

    def get_prompt(self, exam_id, question_num):
        return self.prompts.get(f"{exam_id}*{question_num}", "")


class FCEDataParser:
    def __init__(self, dataset_path, prompt_parser):
        self.dataset_path = dataset_path
        self.prompt_parser = prompt_parser
        self.data = []

    def parse_coded_answer(self, coded_answer_elem):
        corrections = []

        def process_element(elem):
            text_parts = []
            if elem.text:
                text_parts.append(elem.text)

            for child in elem:
                if child.tag == 'NS':
                    error_type = child.get('type', 'UNKNOWN')
                    incorrect, correct = "", ""
                    i_elem = child.find('i')
                    c_elem = child.find('c')
                    if i_elem is not None:
                        incorrect = self.get_all_text(i_elem)
                    if c_elem is not None:
                        correct = self.get_all_text(c_elem)

                    if incorrect or correct:
                        corrections.append({
                            'error_type': error_type,
                            'incorrect': incorrect,
                            'correct': correct,
                            'error_name': ERROR_TYPES.get(error_type, 'Unknown')
                        })

                    if correct:
                        text_parts.append(correct)
                    elif incorrect:
                        text_parts.append(incorrect)

                    if child.tail:
                        text_parts.append(child.tail)
                else:
                    child_text = process_element(child)
                    text_parts.append(child_text)
                    if child.tail:
                        text_parts.append(child.tail)

            return ''.join(text_parts)

        original_text = self.build_original_text(coded_answer_elem)
        corrected_text = process_element(coded_answer_elem)
        return original_text, corrected_text, corrections

    def get_all_text(self, elem):
        parts = []
        if elem.text:
            parts.append(elem.text)
        for child in elem:
            parts.append(self.get_all_text(child))
            if child.tail:
                parts.append(child.tail)
        return ''.join(parts)

    def build_original_text(self, coded_answer_elem):
        text_parts = []

        def process_element(elem):
            if elem.text:
                text_parts.append(elem.text)
            for child in elem:
                if child.tag == 'NS':
                    i_elem = child.find('i')
                    c_elem = child.find('c')
                    if i_elem is not None:
                        text_parts.append(self.get_all_text(i_elem))
                    elif c_elem is not None:
                        pass
                    if child.tail:
                        text_parts.append(child.tail)
                else:
                    process_element(child)
                    if child.tail:
                        text_parts.append(child.tail)

        process_element(coded_answer_elem)
        return ''.join(text_parts)

    def parse_dataset(self):
        print("Parsing FCE dataset...")
        prompts_found, prompts_missing = 0, 0

        dataset_root = Path(self.dataset_path)
        folders = [p for p in dataset_root.iterdir() if p.is_dir()]
        for folder in tqdm(folders):
            for xml_file in folder.glob("*.xml"):
                try:
                    tree = ET.parse(xml_file)
                    root = tree.getroot()
                    head = root.find('head')
                    if head is None:
                        continue

                    sortkey = head.get('sortkey', '')
                    parts = sortkey.split('*')
                    if len(parts) >= 3:
                        exam_id = f"{parts[1]}*{parts[2]}"
                    else:
                        continue

                    candidate = head.find('.//candidate')
                    language, age = "", ""
                    if candidate is not None:
                        lang_elem = candidate.find('.//language')
                        age_elem = candidate.find('.//age')
                        language = (lang_elem.text or "") if lang_elem is not None else ""
                        age = (age_elem.text or "") if age_elem is not None else ""

                    text_elem = head.find('text')
                    if text_elem is None:
                        continue

                    for answer in text_elem:
                        q_num_elem = answer.find('question_number')
                        if q_num_elem is None:
                            continue
                        q_num = q_num_elem.text

                        prompt = self.prompt_parser.get_prompt(exam_id, q_num)
                        if prompt:
                            prompts_found += 1
                        else:
                            prompts_missing += 1

                        coded_answer = answer.find('coded_answer')
                        if coded_answer is None:
                            continue

                        original, corrected, corrections = self.parse_coded_answer(coded_answer)
                        if corrections:
                            self.data.append({
                                'prompt': prompt,
                                'original_text': original.strip(),
                                'corrected_text': corrected.strip(),
                                'corrections': corrections,
                                'language': language,
                                'age': age
                            })
                except Exception as e:
                    print(f"Error parsing {xml_file}: {e}")

        print(f"\nParsed {len(self.data)} samples with corrections")
        print(f"Prompt mapping: {prompts_found} matched, {prompts_missing} missing")
        return self.data


def tokenize(text, tokenizer):
    return tokenizer.encode(text, add_special_tokens=False)

def decode_ids(ids, tokenizer):
    return tokenizer.decode(ids, skip_special_tokens=True)

def trim_to_tokens(text, tokenizer, max_tokens):
    ids = tokenize(text, tokenizer)
    if len(ids) <= max_tokens:
        return text
    trimmed = ids[-max_tokens:]
    return decode_ids(trimmed, tokenizer)

def build_input_text(prompt: str, student_text: str):
    if prompt:
        return (
            f"{config.INSTRUCTION_PREFIX} "
            f" Question: {prompt} "
            f" Answer: {student_text}"
        )
    else:
        return f"{config.INSTRUCTION_PREFIX} {student_text}"


class FCEDataset(Dataset):
    def __init__(self, data, tokenizer, max_encoder_len=512, prompt_max_tokens=128):
        self.data = data
        self.tokenizer = tokenizer
        self.max_encoder_len = max_encoder_len
        self.prompt_max_tokens = prompt_max_tokens

    def __len__(self):
        return len(self.data)

    def _compose_and_trim(self, prompt, original_text):
        prefix = config.INSTRUCTION_PREFIX

        if prompt:
            prompt_capped = trim_to_tokens(prompt, self.tokenizer, self.prompt_max_tokens)
            base = f"{prefix} Question: {prompt_capped} Answer: "
        else:
            base = f"{prefix} "

        base_ids = tokenize(base, self.tokenizer)
        ans_ids = tokenize(original_text, self.tokenizer)

        if len(base_ids) + len(ans_ids) <= self.max_encoder_len:
            return base + original_text

        base_no_prompt = f"{prefix} "
        base_no_prompt_ids = tokenize(base_no_prompt, self.tokenizer)

        if len(base_no_prompt_ids) + len(ans_ids) <= self.max_encoder_len:
            return base_no_prompt + original_text

        remaining = max(self.max_encoder_len - len(base_no_prompt_ids), 0)
        kept_ans = decode_ids(ans_ids[-remaining:], self.tokenizer)
        return base_no_prompt + kept_ans

    def __getitem__(self, idx):
        item = self.data[idx]
        input_text = self._compose_and_trim(item['prompt'], item['original_text'])
        target_text = item['corrected_text']

        input_encoding = self.tokenizer(
            input_text,
            max_length=self.max_encoder_len,
            padding='max_length',
            truncation=True,
            return_tensors='pt'
        )

        target_encoding = self.tokenizer(
            target_text,
            max_length=config.MAX_NEW_TOKENS,
            padding='max_length',
            truncation=True,
            return_tensors='pt'
        )

        labels = target_encoding['input_ids'].squeeze()
        labels[labels == self.tokenizer.pad_token_id] = -100

        return {
            'input_ids': input_encoding['input_ids'].squeeze(),
            'attention_mask': input_encoding['attention_mask'].squeeze(),
            'labels': labels
        }


def _wp_tokenize(s: str):
    return re.findall(r"\w+|[^\w\s]", s, re.UNICODE)

def micro_feedback_for(error_type: str) -> str:
    return MICRO_FEEDBACK.get(error_type, MICRO_FEEDBACK["other"])

def _normalize_pair_for_clf(frm, to):
    frm = (frm or "").strip()
    to = (to or "").strip()
    return f"INC: {frm} || COR: {to}"

def predict_error_type_for_change(clf, change):
    if clf is None:
        if change["type"] == "added":
            return "missing word"
        if change["type"] == "deleted":
            return "unnecessary word"
        return "other"

    frm = change.get("from", "")
    to = change.get("to", "")

    if change["type"] == "added":
        x = _normalize_pair_for_clf("", to)
    elif change["type"] == "deleted":
        x = _normalize_pair_for_clf(frm, "")
    else:
        x = _normalize_pair_for_clf(frm, to)

    try:
        return clf.predict([x])[0]
    except Exception:
        return "other"

def identify_changes(original: str, corrected: str, max_items: int = 50, clf=None):
    o_tokens = _wp_tokenize(original)
    c_tokens = _wp_tokenize(corrected)

    sm = difflib.SequenceMatcher(None, o_tokens, c_tokens)
    changes = []

    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue

        original_segment = " ".join(o_tokens[i1:i2])
        corrected_segment = " ".join(c_tokens[j1:j2])

        original_segment = original_segment.replace(" ,", ",").replace(" .", ".")
        corrected_segment = corrected_segment.replace(" ,", ",").replace(" .", ".")

        if tag == "replace":
            change = {"type": "replaced", "from": original_segment, "to": corrected_segment}
        elif tag == "delete":
            change = {"type": "deleted", "from": original_segment, "to": None}
        elif tag == "insert":
            change = {"type": "added", "from": None, "to": corrected_segment}
        else:
            continue

        et = predict_error_type_for_change(clf, change)
        change["error_type"] = et
        change["micro_feedback"] = micro_feedback_for(et)

        changes.append(change)
        if len(changes) >= max_items:
            break

    return changes

def format_changes_for_display(changes):
    if not changes:
        return "No changes needed (text appears correct)"

    lines = ["CHANGES DETECTED:"]
    for i, ch in enumerate(changes, 1):
        if ch["type"] == "replaced":
            lines.append(
                f"  {i}. (replaced) '{ch['from']}' → '{ch['to']}' | "
                f"type={ch['error_type']} | tip={ch['micro_feedback']}"
            )
        elif ch["type"] == "deleted":
            lines.append(
                f"  {i}. (deleted) '{ch['from']}' | "
                f"type={ch['error_type']} | tip={ch['micro_feedback']}"
            )
        elif ch["type"] == "added":
            lines.append(
                f"  {i}. (added) '{ch['to']}' | "
                f"type={ch['error_type']} | tip={ch['micro_feedback']}"
            )
    return "\n".join(lines)


def build_error_type_examples(data, min_len=1, max_len=40):
    X, y = [], []
    for item in data:
        for corr in item.get("corrections", []):
            fce_code = (corr.get("error_type") or "UNKNOWN").strip()
            inc = (corr.get("incorrect") or "").strip()
            cor = (corr.get("correct") or "").strip()

            if not inc and not cor:
                continue

            inc_tokens = _wp_tokenize(inc)
            cor_tokens = _wp_tokenize(cor)
            if len(inc_tokens) < min_len and len(cor_tokens) < min_len:
                continue
            if len(inc_tokens) > max_len or len(cor_tokens) > max_len:
                continue

            friendly = FCE_TO_FRIENDLY.get(fce_code, "other")
            X.append(f"INC: {inc} || COR: {cor}")
            y.append(friendly)

    return X, y

def classifier_path(save_dir):
    return os.path.join(save_dir, config.ERROR_CLS_FILENAME)

def train_error_type_classifier(all_data, save_dir):
    X, y = build_error_type_examples(all_data)

    if len(X) < 200 or len(set(y)) < 2:
        print("⚠️ Not enough examples or label variety to train classifier robustly.")
        print(f"Found {len(X)} examples and {len(set(y))} labels. Skipping classifier training.")
        return None

    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=0.15, random_state=42, stratify=y
    )

    clf = Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=50000)),
        ("lr", LogisticRegression(max_iter=2000, n_jobs=-1))
    ])

    print("\nTraining error-type classifier...")
    clf.fit(X_train, y_train)

    preds = clf.predict(X_val)
    print("\nClassifier validation report:")
    print(classification_report(y_val, preds))

    os.makedirs(save_dir, exist_ok=True)
    path = classifier_path(save_dir)
    joblib.dump(clf, path)
    print(f"✓ Saved error-type classifier to {path}")

    return clf

def load_error_type_classifier(save_dir):
    path = classifier_path(save_dir)
    if os.path.exists(path):
        return joblib.load(path)
    return None


def train_model():
    print(f"Using device: {config.DEVICE}")
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    if not os.path.exists(config.DATASET_PATH):
        raise FileNotFoundError(f"DATASET_PATH not found: {config.DATASET_PATH}")
    if not os.path.exists(config.PROMPTS_PATH):
        raise FileNotFoundError(f"PROMPTS_PATH not found: {config.PROMPTS_PATH}")

    print("Loading prompts...")
    prompt_parser = PromptParser(config.PROMPTS_PATH)

    print("Parsing dataset...")
    parser = FCEDataParser(config.DATASET_PATH, prompt_parser)
    data = parser.parse_dataset()
    if not data:
        print("No data found! Please check your paths.")
        return

    train_data, val_data = train_test_split(data, test_size=0.1, random_state=42)
    print(f"Training samples: {len(train_data)}, Validation samples: {len(val_data)}")

    # Train classifier helper model
    _ = train_error_type_classifier(data, config.MODEL_SAVE_PATH)

    print("Loading T5...")
    tokenizer = T5Tokenizer.from_pretrained(config.MODEL_NAME)
    model = T5ForConditionalGeneration.from_pretrained(config.MODEL_NAME)
    model.to(config.DEVICE)

    train_dataset = FCEDataset(train_data, tokenizer, config.MAX_ENCODER_LEN, config.PROMPT_MAX_TOKENS)
    val_dataset = FCEDataset(val_data, tokenizer, config.MAX_ENCODER_LEN, config.PROMPT_MAX_TOKENS)

    train_loader = DataLoader(train_dataset, batch_size=config.BATCH_SIZE, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=config.BATCH_SIZE)

    optimizer = AdamW(model.parameters(), lr=config.LEARNING_RATE)
    total_steps = len(train_loader) * config.EPOCHS
    scheduler = get_linear_schedule_with_warmup(
        optimizer, num_warmup_steps=0, num_training_steps=total_steps
    )

    print("Starting T5 training...")
    print(f"Effective batch size: {config.BATCH_SIZE * config.GRADIENT_ACCUMULATION_STEPS}")

    best_val_loss = float('inf')
    patience_counter = 0
    use_amp = torch.cuda.is_available()
    scaler = GradScaler(enabled=use_amp)

    for epoch in range(config.EPOCHS):
        model.train()
        train_loss = 0.0
        optimizer.zero_grad()

        for batch_idx, batch in enumerate(tqdm(train_loader, desc=f"Epoch {epoch+1}/{config.EPOCHS}")):
            input_ids = batch['input_ids'].to(config.DEVICE)
            attention_mask = batch['attention_mask'].to(config.DEVICE)
            labels = batch['labels'].to(config.DEVICE)

            with autocast(enabled=use_amp):
                outputs = model(
                    input_ids=input_ids,
                    attention_mask=attention_mask,
                    labels=labels
                )
                loss = outputs.loss / config.GRADIENT_ACCUMULATION_STEPS

            train_loss += loss.item() * config.GRADIENT_ACCUMULATION_STEPS
            scaler.scale(loss).backward()

            if (batch_idx + 1) % config.GRADIENT_ACCUMULATION_STEPS == 0:
                if use_amp:
                    scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                scaler.step(optimizer)
                scaler.update()
                scheduler.step()
                optimizer.zero_grad()

            if torch.cuda.is_available() and (batch_idx % 50 == 0):
                torch.cuda.empty_cache()

        avg_train_loss = train_loss / len(train_loader)

        model.eval()
        val_loss = 0.0
        with torch.no_grad():
            for batch in tqdm(val_loader, desc="Validation"):
                input_ids = batch['input_ids'].to(config.DEVICE)
                attention_mask = batch['attention_mask'].to(config.DEVICE)
                labels = batch['labels'].to(config.DEVICE)

                with autocast(enabled=use_amp):
                    outputs = model(
                        input_ids=input_ids,
                        attention_mask=attention_mask,
                        labels=labels
                    )
                val_loss += outputs.loss.item()

        avg_val_loss = val_loss / len(val_loader)
        print(f"Epoch {epoch+1}: Train Loss={avg_train_loss:.4f} | Val Loss={avg_val_loss:.4f}")

        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            patience_counter = 0
            os.makedirs(config.MODEL_SAVE_PATH, exist_ok=True)
            model.save_pretrained(config.MODEL_SAVE_PATH)
            tokenizer.save_pretrained(config.MODEL_SAVE_PATH)
            print(f"✓ Saved best T5 to {config.MODEL_SAVE_PATH}")
        else:
            patience_counter += 1
            print(f"⚠ No improvement (patience {patience_counter}/{config.EARLY_STOPPING_PATIENCE})")
            if patience_counter >= config.EARLY_STOPPING_PATIENCE:
                print("Early stopping triggered.")
                break

        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    print(f"\nTraining complete! Best val loss: {best_val_loss:.4f}")


def test_model(prompt, student_input, return_json=True):
    tokenizer = T5Tokenizer.from_pretrained(config.MODEL_SAVE_PATH)
    model = T5ForConditionalGeneration.from_pretrained(config.MODEL_SAVE_PATH)
    model.to(config.DEVICE)
    model.eval()

    clf = load_error_type_classifier(config.MODEL_SAVE_PATH)

    def compose_for_test(prompt, student_text):
        prefix = config.INSTRUCTION_PREFIX
        if prompt:
            prompt_ids = tokenizer.encode(prompt, add_special_tokens=False)
            if len(prompt_ids) > config.PROMPT_MAX_TOKENS:
                prompt = tokenizer.decode(prompt_ids[:config.PROMPT_MAX_TOKENS], skip_special_tokens=True)
            base = f"{prefix} Question: {prompt} Answer: "
        else:
            base = f"{prefix} "

        base_ids = tokenizer.encode(base, add_special_tokens=False)
        ans_ids = tokenizer.encode(student_text, add_special_tokens=False)

        if len(base_ids) + len(ans_ids) <= config.MAX_ENCODER_LEN:
            return base + student_text

        base_no_prompt = f"{prefix} "
        base_no_prompt_ids = tokenizer.encode(base_no_prompt, add_special_tokens=False)
        if len(base_no_prompt_ids) + len(ans_ids) <= config.MAX_ENCODER_LEN:
            return base_no_prompt + student_text

        remaining = max(config.MAX_ENCODER_LEN - len(base_no_prompt_ids), 0)
        kept_ans = tokenizer.decode(ans_ids[-remaining:], skip_special_tokens=True)
        return base_no_prompt + kept_ans

    input_text = compose_for_test(prompt, student_input)
    input_ids = tokenizer.encode(
        input_text, return_tensors='pt',
        max_length=config.MAX_ENCODER_LEN, truncation=True
    ).to(config.DEVICE)

    with torch.no_grad():
        outputs = model.generate(
            input_ids,
            max_new_tokens=config.MAX_NEW_TOKENS,
            num_beams=6,
            no_repeat_ngram_size=3,
            repetition_penalty=1.1,
            length_penalty=1.0,
            early_stopping=True
        )

    corrected = tokenizer.decode(outputs[0], skip_special_tokens=True)
    changes = identify_changes(student_input, corrected, clf=clf)

    payload = {
        "original": student_input,
        "corrected": corrected,
        "prompt": prompt,
        "num_errors": len(changes),
        "changes": changes,
        "has_errors": len(changes) > 0
    }

    print(f"\n{'='*70}")
    print(f"PROMPT: {prompt}")
    print(f"{'='*70}")
    print(f"ORIGINAL:  {student_input}")
    print(f"CORRECTED: {corrected}\n")
    print(format_changes_for_display(changes))
    print(f"{'='*70}")

    if return_json:
        print("\nJSON OUTPUT:")
        print(json.dumps(payload, indent=2, ensure_ascii=False))

    return payload


if __name__ == "__main__":
    SKIP_TRAINING = False

    if not SKIP_TRAINING:
        train_model()

    print("\n" + "="*70)
    print(" TESTING: T5 + EXPLAINABLE FEEDBACK ".center(70, "="))
    print("="*70)

    test_model(
        prompt="You recently entered a competition. Write a letter to the organiser.",
        student_input="Dear Sir, Thanks for you letter. I am very exciting to hear I win the prize."
    )

    test_model(
        prompt="Your teacher has asked you to write a report about daily life at your school.",
        student_input="In my school, student learn many subject. They enjoy study in library."
    )

    test_model(
        prompt="Write about your last vacation.",
        student_input="Last summer I go to Spain with my family. We stay at hotel near the beach."
    )

    test_model(
        prompt="",
        student_input="She don't like coffee. He have three brother."
    )
