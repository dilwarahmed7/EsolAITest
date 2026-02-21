import os
import xml.etree.ElementTree as ET
from pathlib import Path
import re
import json
import torch
from torch.utils.data import Dataset, DataLoader
from torch.cuda.amp import autocast, GradScaler
from transformers import (
    T5Tokenizer, 
    T5ForConditionalGeneration,
    get_linear_schedule_with_warmup
)
from torch.optim import AdamW
from tqdm import tqdm
import numpy as np
from sklearn.model_selection import train_test_split
import difflib

# =========================
# Configuration
# =========================
class Config:
    BASE_PATH = "/content/drive/MyDrive/FCEModel/fce-released-dataset"
    DATASET_PATH = os.path.join(BASE_PATH, "dataset")
    PROMPTS_PATH = os.path.join(BASE_PATH, "prompts")
    MODEL_SAVE_PATH = "/content/drive/MyDrive/FCEModel/trained_model"

    MODEL_NAME = "t5-small"
    # Encoder length: T5-small practical cap is 512 tokens.
    # We'll ensure student text gets priority within this budget.
    MAX_ENCODER_LEN = 512

    # Decoder/output budget (how long the corrected text can be)
    MAX_NEW_TOKENS = 256  # can raise to 384 if needed

    # Prompt token cap (so student text isn't truncated)
    PROMPT_MAX_TOKENS = 96

    # Training
    BATCH_SIZE = 4
    EPOCHS = 10
    LEARNING_RATE = 3e-4
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    GRADIENT_ACCUMULATION_STEPS = 2
    EARLY_STOPPING_PATIENCE = 3

    # Instruction prefix: keep stable in train & test
    INSTRUCTION_PREFIX = (
        "fix_grammar Keep meaning. Improve grammar, spelling, and punctuation. "
        "Output only the corrected text."
    )

config = Config()

# =========================
# Error type mapping
# =========================
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

    # Common extra codes in your sample files (optional, for nicer logs)
    'UP': 'Unnecessary punctuation',
    'R':  'Replacement/word choice',
    'RD': 'Reference/Determiner',
    'W':  'Word order',
    'ID': 'Idiomatic usage',
    'UY': 'Unclear/Style',
    'RA': 'Reference/Pronoun'
}

# =========================
# Prompt parser
# =========================
class PromptParser:
    def __init__(self, prompts_path):
        self.prompts_path = prompts_path
        self.prompts = {}
        self.load_prompts()

    def load_prompts(self):
        prompt_count = 0
        for xml_file in Path(self.prompts_path).glob("*.xml"):
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

        print(f"Loaded {prompt_count} prompts from {len(list(Path(self.prompts_path).glob('*.xml')))} XML files")
        if prompt_count > 0:
            sample_keys = list(self.prompts.keys())[:3]
            print(f"Sample prompt keys: {sample_keys}")

    def get_prompt(self, exam_id, question_num):
        key = f"{exam_id}*{question_num}"
        return self.prompts.get(key, "")

# =========================
# FCE data parser
# =========================
class FCEDataParser:
    def __init__(self, dataset_path, prompt_parser):
        self.dataset_path = dataset_path
        self.prompt_parser = prompt_parser
        self.data = []

    def parse_coded_answer(self, coded_answer_elem):
        corrections = []

        def process_element(elem, parent_text=""):
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
                    # Build corrected text
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
        prompts_found = 0
        prompts_missing = 0
        sample_mappings = []

        for folder in tqdm(list(Path(self.dataset_path).iterdir())):
            if not folder.is_dir():
                continue
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
                    language = ""
                    age = ""
                    if candidate is not None:
                        lang_elem = candidate.find('.//language')
                        age_elem = candidate.find('.//age')
                        if lang_elem is not None:
                            language = lang_elem.text or ""
                        if age_elem is not None:
                            age = age_elem.text or ""

                    text_elem = head.find('text')
                    if text_elem is None:
                        continue

                    for answer in text_elem:
                        q_num_elem = answer.find('question_number')
                        if q_num_elem is None:
                            continue
                        q_num = q_num_elem.text

                        lookup_key = f"{exam_id}*{q_num}"
                        prompt = self.prompt_parser.get_prompt(exam_id, q_num)

                        if prompt:
                            prompts_found += 1
                            if len(sample_mappings) < 3:
                                sample_mappings.append({
                                    'key': lookup_key,
                                    'prompt_preview': prompt[:80] + '...' if len(prompt) > 80 else prompt
                                })
                        else:
                            prompts_missing += 1
                            if prompts_missing <= 3:
                                print(f"⚠️  No prompt found for key: {lookup_key}")

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

        if sample_mappings:
            print("\nSample mappings (first 3):")
            for i, mapping in enumerate(sample_mappings, 1):
                print(f"  {i}. Key: {mapping['key']}")
                print(f"     Prompt: {mapping['prompt_preview']}")

        if prompts_missing > 0:
            print(f"\n⚠️  Warning: {prompts_missing} answers have no matching prompt")
            print(f"   These will train without context (using fallback format)")

        return self.data

# =========================
# Token helpers (priority to student text)
# =========================
def tokenize(text, tokenizer):
    return tokenizer.encode(text, add_special_tokens=False)

def decode_ids(ids, tokenizer):
    return tokenizer.decode(ids, skip_special_tokens=True)

def trim_to_tokens(text, tokenizer, max_tokens):
    ids = tokenize(text, tokenizer)
    if len(ids) <= max_tokens:
        return text
    # Keep the *last* tokens (more likely to include conclusions / endings)
    trimmed = ids[-max_tokens:]
    return decode_ids(trimmed, tokenizer)

def build_input_text(prompt: str, student_text: str):
    """
    Stable instruction + optional prompt + student answer.
    We will allocate token budget so the student_text is preserved first.
    """
    if prompt:
        return (
            f"{config.INSTRUCTION_PREFIX} "
            f" Question: {prompt} "
            f" Answer: {student_text}"
        )
    else:
        return f"{config.INSTRUCTION_PREFIX} {student_text}"

# =========================
# Dataset
# =========================
class FCEDataset(Dataset):
    def __init__(self, data, tokenizer, max_encoder_len=512, prompt_max_tokens=128):
        self.data = data
        self.tokenizer = tokenizer
        self.max_encoder_len = max_encoder_len
        self.prompt_max_tokens = prompt_max_tokens

    def __len__(self):
        return len(self.data)

    def _compose_and_trim(self, prompt, original_text):
        """
        Ensure the student text gets priority.
        1) Build instruction + (capped prompt) + answer.
        2) If still > max_encoder_len, drop the prompt entirely.
        3) If still > max, keep the last tokens of the *answer*.
        """
        prefix = config.INSTRUCTION_PREFIX

        if prompt:
            # Cap the prompt first
            prompt_capped = trim_to_tokens(prompt, self.tokenizer, self.prompt_max_tokens)
            base = f"{prefix} Question: {prompt_capped} Answer: "
        else:
            base = f"{prefix} "

        # Now compute budgets
        base_ids = tokenize(base, self.tokenizer)
        ans_ids = tokenize(original_text, self.tokenizer)

        # If fits, great
        if len(base_ids) + len(ans_ids) <= self.max_encoder_len:
            return base + original_text

        # Try dropping the prompt entirely
        base_no_prompt = f"{prefix} "
        base_no_prompt_ids = tokenize(base_no_prompt, self.tokenizer)

        if len(base_no_prompt_ids) + len(ans_ids) <= self.max_encoder_len:
            return base_no_prompt + original_text

        # Still too long: keep the last tokens of the answer to fit budget
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

        # Target can also be long;  we cap it via max_length here for label tensor,
        # while generation uses config.MAX_NEW_TOKENS later.
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

# =========================
# Training
# =========================
def train_model():
    print(f"Using device: {config.DEVICE}")
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

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

    # Example
    print("\n" + "="*70)
    print("SAMPLE TRAINING EXAMPLE:")
    print("="*70)
    if train_data:
        sample = train_data[0]
        sample_input = build_input_text(sample['prompt'], sample['original_text'])[:300] + "..."
        error_descs = []
        for corr in sample['corrections'][:3]:
            if corr['incorrect'] and corr['correct']:
                error_descs.append(f"[{corr['error_name']}] '{corr['incorrect']}' -> '{corr['correct']}'")
        sample_output = f"Corrected: {sample['corrected_text'][:100]}... | Errors: {'; '.join(error_descs)}"
        print(f"INPUT:\n  {sample_input}\n")
        print(f"TARGET OUTPUT:\n  {sample_output}")
        print("="*70 + "\n")

    print("Loading model...")
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

    print("Starting training...")
    print(f"Effective batch size: {config.BATCH_SIZE * config.GRADIENT_ACCUMULATION_STEPS}")

    best_val_loss = float('inf')
    patience_counter = 0
    use_amp = torch.cuda.is_available()
    scaler = GradScaler(enabled=use_amp)

    for epoch in range(config.EPOCHS):
        # Train
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

        # Validate
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
        print(f"Epoch {epoch+1}: Train Loss = {avg_train_loss:.4f}, Val Loss = {avg_val_loss:.4f}")

        # Early stopping + save best
        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            patience_counter = 0
            os.makedirs(config.MODEL_SAVE_PATH, exist_ok=True)
            model.save_pretrained(config.MODEL_SAVE_PATH)
            tokenizer.save_pretrained(config.MODEL_SAVE_PATH)
            print(f"✓ Model improved! Saved to {config.MODEL_SAVE_PATH}")
        else:
            patience_counter += 1
            print(f"⚠ No improvement (patience: {patience_counter}/{config.EARLY_STOPPING_PATIENCE})")
            if patience_counter >= config.EARLY_STOPPING_PATIENCE:
                print(f"\nEarly stopping triggered after {epoch+1} epochs")
                break

        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    print(f"\nTraining complete! Best validation loss: {best_val_loss:.4f}")

# =========================
# Diff / change identification (IMPROVED)
# =========================
def _wp_tokenize(s: str):
    """Tokenize text into words and punctuation."""
    return re.findall(r"\w+|[^\w\s]", s, re.UNICODE)

def identify_changes(original: str, corrected: str, max_items: int = 50):
    """
    Identify changes between original and corrected text.
    Returns a list of clear change descriptions: insertions, deletions, and replacements.
    """
    o_tokens = _wp_tokenize(original)
    c_tokens = _wp_tokenize(corrected)
    
    sm = difflib.SequenceMatcher(None, o_tokens, c_tokens)
    
    changes = []
    
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        
        original_segment = " ".join(o_tokens[i1:i2])
        corrected_segment = " ".join(c_tokens[j1:j2])
        
        # Clean up spacing around punctuation
        original_segment = original_segment.replace(" ,", ",").replace(" .", ".")
        corrected_segment = corrected_segment.replace(" ,", ",").replace(" .", ".")
        
        if tag == "replace":
            changes.append({
                "type": "replaced",
                "from": original_segment,
                "to": corrected_segment
            })
        elif tag == "delete":
            changes.append({
                "type": "deleted",
                "from": original_segment,
                "to": None
            })
        elif tag == "insert":
            changes.append({
                "type": "added",
                "from": None,
                "to": corrected_segment
            })
        
        if len(changes) >= max_items:
            break
    
    return changes

def format_changes_for_display(changes):
    """Format changes into human-readable output."""
    if not changes:
        return "No changes needed (text appears correct)"
    
    lines = ["CHANGES DETECTED:"]
    for i, change in enumerate(changes, 1):
        change_type = change.get("type", "unknown")
        
        if change_type == "replaced":
            lines.append(f"  {i}. (replaced) '{change['from']}' → '{change['to']}'")
        elif change_type == "deleted":
            lines.append(f"  {i}. (deleted) '{change['from']}'")
        elif change_type == "added":
            lines.append(f"  {i}. (added) '{change['to']}'")
    
    return "\n".join(lines)

# =========================
# Testing
# =========================
def test_model(prompt, student_input):
    tokenizer = T5Tokenizer.from_pretrained(config.MODEL_SAVE_PATH)
    model = T5ForConditionalGeneration.from_pretrained(config.MODEL_SAVE_PATH)
    model.to(config.DEVICE)
    model.eval()

    # Compose input with student text priority & fixed prefix
    # (we re-use the dataset logic here inline for simplicity)
    def compose_for_test(prompt, student_text):
        prefix = config.INSTRUCTION_PREFIX
        if prompt:
            # cap prompt
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

        # try without prompt
        base_no_prompt = f"{prefix} "
        base_no_prompt_ids = tokenizer.encode(base_no_prompt, add_special_tokens=False)
        if len(base_no_prompt_ids) + len(ans_ids) <= config.MAX_ENCODER_LEN:
            return base_no_prompt + student_text

        remaining = max(config.MAX_ENCODER_LEN - len(base_no_prompt_ids), 0)
        kept_ans = tokenizer.decode(ans_ids[-remaining:], skip_special_tokens=True)
        return base_no_prompt + kept_ans

    input_text = compose_for_test(prompt, student_input)
    input_ids = tokenizer.encode(input_text, return_tensors='pt', max_length=config.MAX_ENCODER_LEN, truncation=True)
    input_ids = input_ids.to(config.DEVICE)

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

    result = tokenizer.decode(outputs[0], skip_special_tokens=True)

    changes = identify_changes(student_input, result)
    print(f"\n{'='*70}")
    print(f"PROMPT: {prompt}")
    print(f"{'='*70}")
    print(f"ORIGINAL: {student_input}")
    print(f"CORRECTED: {result}")
    print(f"\n{format_changes_for_display(changes)}")
    print(f"{'='*70}")

    return result

# =========================
# Main
# =========================
if __name__ == "__main__":
    # CHANGE THIS FLAG TO CONTROL TRAINING VS TESTING
    SKIP_TRAINING = True  # Set to False to train, True to skip training
    
    if not SKIP_TRAINING:
        # Train the model
        train_model()

    # Quick tests
    print("\n" + "="*70)
    print(" TESTING THE TRAINED MODEL ".center(70, "="))
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