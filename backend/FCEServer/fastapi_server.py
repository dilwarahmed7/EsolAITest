from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
import re
import difflib
import os
import joblib
from huggingface_hub import snapshot_download

# =========================
# Configuration
# =========================

class Config:
    MODEL_REF = os.environ.get(
        "FCE_MODEL_REF",
        "dilwarahmed/fce-grammar-corrector"
    )

    HF_TOKEN = os.environ.get("HF_TOKEN", None)

    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    MAX_ENCODER_LEN = 512
    DEFAULT_MAX_NEW_TOKENS = 256

    INSTRUCTION_PREFIX = (
        "fix_grammar Keep meaning. Improve grammar, spelling, and punctuation. "
        "Output only the corrected text."
    )

    ERROR_TAGGER_REPO = os.environ.get(
        "FCE_ERROR_TAGGER_REPO",
        "dilwarahmed/fce-error-tagger"
    )
    ERROR_TAGGER_FILE = "error_type_classifier.joblib"
    ERROR_TAGGER_REPO_TYPE = "model"


config = Config()

ARTICLES = {"a", "an", "the"}

MICRO_FEEDBACK = {
    "agreement/plural": (
        "Check agreement (subject–verb and singular/plural nouns). "
        "For 3rd person singular, use 'does/has/is' and add -s where needed."
    ),
    "articles/determiners": "Check articles and determiners (a/an/the/your). Use them when needed and remove extra ones.",
    "verb tense/form": "Check verb tense and verb form (e.g., past vs present, infinitive vs -ing).",
    "prepositions": "Check the preposition choice (e.g., 'in July' not 'on July').",
    "spelling": "Fix spelling mistakes.",
    "word choice/form": "Use the correct word or word form for the meaning.",
    "missing word": "A word is missing—add the word needed for a complete/grammatical phrase.",
    "unnecessary word": "Remove extra words that aren’t needed.",
    "punctuation": "Fix punctuation (commas, full stops, capitalization).",
    "word order": "Adjust word order to match natural English structure.",
    "other": "Review this part for grammar/usage.",
}

# =========================
# Request / Response Models
# =========================

class CorrectionRequest(BaseModel):
    student_input: str
    prompt: str = ""
    max_length: int = config.DEFAULT_MAX_NEW_TOKENS


class CorrectionResponse(BaseModel):
    original: str
    corrected: str
    prompt: str
    num_errors: int
    score: int
    changes: list
    has_errors: bool

# =========================
# FastAPI App Setup
# =========================

app = FastAPI(
    title="FCE Error Correction API",
    description="API for grammatical error correction using a trained seq2seq model",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# Model Manager
# =========================

class ModelManager:
    def __init__(self):
        self.model = None
        self.tokenizer = None
        self.device = config.DEVICE
        self.loaded = False
        self.model_ref = config.MODEL_REF

        self.error_clf = None
        self.error_clf_loaded = False
        self.error_clf_effective_path = None
        self.error_clf_repo_dir = None

    def load_model(self):
        """
        Load:
          1) Correction model (HF or local, controlled by MODEL_REF)
          2) Error-type classifier (ALWAYS from HF repo snapshot)
        """
        self._load_correction_model()
        self._load_error_classifier_from_hf()

    def _load_correction_model(self):
        model_ref = self.model_ref
        is_local = os.path.exists(model_ref)

        load_kwargs = {}
        if (not is_local) and config.HF_TOKEN:
            load_kwargs["token"] = config.HF_TOKEN

        self.tokenizer = AutoTokenizer.from_pretrained(model_ref, **load_kwargs)
        self.model = AutoModelForSeq2SeqLM.from_pretrained(model_ref, **load_kwargs)

        self.model.to(self.device)
        self.model.eval()
        self.loaded = True

    def _load_error_classifier_from_hf(self):
        self.error_clf = None
        self.error_clf_loaded = False
        self.error_clf_effective_path = None
        self.error_clf_repo_dir = None

        snap_kwargs = {"repo_type": config.ERROR_TAGGER_REPO_TYPE}
        if config.HF_TOKEN:
            snap_kwargs["token"] = config.HF_TOKEN

        repo_dir = snapshot_download(
            repo_id=config.ERROR_TAGGER_REPO,
            **snap_kwargs
        )
        self.error_clf_repo_dir = repo_dir

        clf_path = os.path.join(repo_dir, config.ERROR_TAGGER_FILE)
        if not os.path.exists(clf_path):
            raise FileNotFoundError(
                f"'{config.ERROR_TAGGER_FILE}' not found in HF repo snapshot: {repo_dir}. "
                f"Make sure you uploaded it to {config.ERROR_TAGGER_REPO}."
            )

        self.error_clf = joblib.load(clf_path)
        self.error_clf_loaded = True
        self.error_clf_effective_path = clf_path
        print(f"✓ Loaded error classifier (HF): {clf_path}")


model_manager = ModelManager()

@app.on_event("startup")
async def startup_event():
    try:
        model_manager.load_model()
    except Exception as e:
        print(f"Model failed to load: {e}")

# =========================
# Helper Functions
# =========================

def _wp_tokenize(text: str):
    return re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?|\d+|[^\w\s]", text)


def _micro_feedback_for(error_type: str) -> str:
    return MICRO_FEEDBACK.get(error_type, MICRO_FEEDBACK["other"])


def _normalize_pair_for_clf(frm, to) -> str:
    frm = (frm or "").strip()
    to = (to or "").strip()
    return f"INC: {frm} || COR: {to}"


def _predict_error_type_heuristic(change: dict) -> str:
    frm_raw = change.get("from")
    to_raw = change.get("to")

    frm = (frm_raw or "").strip().lower() if frm_raw else ""
    to = (to_raw or "").strip().lower() if to_raw else ""

    if change["type"] == "added" and to in ARTICLES:
        return "articles/determiners"

    if change["type"] == "replaced" and frm and to:
        if frm + "s" == to or frm + "es" == to or (frm.endswith("y") and frm[:-1] + "ies" == to):
            return "agreement/plural"

    if change["type"] == "added":
        return "missing word"
    if change["type"] == "deleted":
        return "unnecessary word"

    return "other"


def _predict_error_type(change: dict) -> str:
    if model_manager.error_clf_loaded and model_manager.error_clf is not None:
        try:
            x = _normalize_pair_for_clf(change.get("from"), change.get("to"))
            return model_manager.error_clf.predict([x])[0]
        except Exception:
            pass

    return _predict_error_type_heuristic(change)


def identify_changes(original: str, corrected: str):
    o_tokens = _wp_tokenize(original)
    c_tokens = _wp_tokenize(corrected)

    sm = difflib.SequenceMatcher(None, o_tokens, c_tokens)
    changes = []

    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue

        original_segment = " ".join(o_tokens[i1:i2]).replace(" ,", ",").replace(" .", ".")
        corrected_segment = " ".join(c_tokens[j1:j2]).replace(" ,", ",").replace(" .", ".")

        if tag == "replace":
            change = {"type": "replaced", "from": original_segment, "to": corrected_segment}
        elif tag == "delete":
            change = {"type": "deleted", "from": original_segment, "to": None}
        elif tag == "insert":
            change = {"type": "added", "from": None, "to": corrected_segment}
        else:
            continue

        error_type = _predict_error_type(change)
        change["error_type"] = error_type
        change["micro_feedback"] = _micro_feedback_for(error_type)

        changes.append(change)
        if len(changes) >= 50:
            break

    return changes


def correct_text(student_input: str, prompt: str = "", max_length: int = config.DEFAULT_MAX_NEW_TOKENS):
    if not model_manager.loaded:
        raise RuntimeError("Model not loaded")

    input_text = f"{config.INSTRUCTION_PREFIX} {student_input}"

    batch = model_manager.tokenizer(
        input_text,
        return_tensors="pt",
        max_length=config.MAX_ENCODER_LEN,
        truncation=True
    )
    batch = {k: v.to(model_manager.device) for k, v in batch.items()}

    with torch.no_grad():
        outputs = model_manager.model.generate(
            **batch,
            max_new_tokens=max_length,
            num_beams=6,
            no_repeat_ngram_size=3,
            repetition_penalty=1.1,
            early_stopping=True,
        )

    corrected = model_manager.tokenizer.decode(outputs[0], skip_special_tokens=True).strip()

    changes = identify_changes(student_input, corrected)
    num_errors = len(changes)
    score = max(0, 10 - num_errors)

    return {
        "original": student_input,
        "corrected": corrected,
        "prompt": prompt,
        "num_errors": num_errors,
        "score": score,
        "changes": changes,
        "has_errors": num_errors > 0,
    }

# =========================
# API Routes
# =========================

@app.get("/")
async def root():
    return {
        "message": "FCE Error Correction API",
        "model_loaded": model_manager.loaded,
        "device": model_manager.device,
        "model_ref": model_manager.model_ref,
        "error_classifier_loaded": model_manager.error_clf_loaded,
        "error_classifier_repo": config.ERROR_TAGGER_REPO,
        "error_classifier_file": config.ERROR_TAGGER_FILE,
        "error_classifier_effective_path": model_manager.error_clf_effective_path,
        "error_classifier_repo_dir": model_manager.error_clf_repo_dir,
    }


@app.get("/health")
async def health():
    if not model_manager.loaded:
        raise HTTPException(status_code=503, detail="Model not loaded")
    return {"status": "ok"}


@app.post("/correct", response_model=CorrectionResponse)
async def correct(request: CorrectionRequest):
    if not request.student_input.strip():
        raise HTTPException(status_code=400, detail="student_input cannot be empty")

    try:
        return CorrectionResponse(**correct_text(
            student_input=request.student_input,
            prompt=request.prompt,
            max_length=request.max_length
        ))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# =========================
# Run Server
# =========================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
