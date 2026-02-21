import torch
from transformers import T5Tokenizer, T5ForConditionalGeneration
import os
import re
import difflib

class FCEErrorCorrector:
    """Test interface for the trained FCE error correction model"""
    
    def __init__(self, model_path="/content/drive/MyDrive/FCEModel/trained_model"):
        self.model_path = model_path
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        
        print(f"Loading model from {model_path}...")
        print(f"Using device: {self.device}")
        
        try:
            self.tokenizer = T5Tokenizer.from_pretrained(model_path)
            self.model = T5ForConditionalGeneration.from_pretrained(model_path)
            self.model.to(self.device)
            self.model.eval()
            print("✓ Model loaded successfully!\n")
        except Exception as e:
            print(f"❌ Error loading model: {e}")
            print("Please make sure the model has been trained first.")
            raise
    
    def correct_text(self, student_input, prompt="", num_beams=4, max_length=256):
        """
        Correct grammatical errors in student input
        
        Args:
            student_input: The text written by the student
            prompt: Optional prompt/question context (recommended for better results)
            num_beams: Number of beams for beam search (higher = better quality, slower)
            max_length: Maximum length of generated output
            
        Returns:
            Dictionary with original text, corrected text, and changes
        """
        # Prepare input with context if prompt provided
        if prompt:
            input_text = f"correct grammar with context. Question: {prompt} Answer: {student_input}"
        else:
            input_text = f"correct grammar: {student_input}"
        
        # Tokenize
        input_ids = self.tokenizer.encode(
            input_text, 
            return_tensors='pt', 
            max_length=max_length, 
            truncation=True
        )
        input_ids = input_ids.to(self.device)
        
        # Generate correction
        with torch.no_grad():
            outputs = self.model.generate(
                input_ids,
                max_length=max_length,
                num_beams=num_beams,
                early_stopping=True,
                no_repeat_ngram_size=3,
                repetition_penalty=1.2,
                length_penalty=1.0
            )
        
        corrected_text = self.tokenizer.decode(outputs[0], skip_special_tokens=True)
        
        # Identify changes
        changes = self._identify_changes(student_input, corrected_text)
        
        # Calculate score (max 10 points)
        num_errors = len(changes)
        score = max(0, 10 - num_errors)  # 10 - number of errors, minimum 0
        
        return {
            'original': student_input,
            'corrected': corrected_text,
            'prompt': prompt,
            'changes': changes,
            'has_errors': len(changes) > 0,
            'num_errors': num_errors,
            'score': score
        }
    
    @staticmethod
    def _wp_tokenize(s: str):
        """Tokenize text into words and punctuation."""
        return re.findall(r"\w+|[^\w\s]", s, re.UNICODE)
    
    def _identify_changes(self, original, corrected):
        """
        Identify changes between original and corrected text using difflib.
        Returns a list of clear change descriptions: insertions, deletions, and replacements.
        """
        o_tokens = self._wp_tokenize(original)
        c_tokens = self._wp_tokenize(corrected)
        
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
            
            if len(changes) >= 50:  # Limit to 50 changes
                break
        
        return changes
    
    def print_correction(self, result):
        """Pretty print the correction result"""
        print("=" * 70)
        if result['prompt']:
            print(f"PROMPT: {result['prompt']}")
            print("=" * 70)
        print(f"ORIGINAL:\n  {result['original']}")
        print("-" * 70)
        print(f"CORRECTED:\n  {result['corrected']}")
        print("-" * 70)
        
        if result['changes']:
            print(f"CHANGES DETECTED ({len(result['changes'])} changes):")
            for i, change in enumerate(result['changes'], 1):
                change_type = change.get("type", "unknown")
                
                if change_type == "replaced":
                    print(f"  {i}. (replaced) '{change['from']}' → '{change['to']}'")
                elif change_type == "deleted":
                    print(f"  {i}. (deleted) '{change['from']}'")
                elif change_type == "added":
                    print(f"  {i}. (added) '{change['to']}'")
        else:
            print("✓ No changes needed (text appears correct)")
        
        # Print score
        print("-" * 70)
        score = result['score']
        score_bar = "█" * score + "░" * (10 - score)
        print(f"SCORE: {score}/10 [{score_bar}]")
        print("=" * 70)
        print()
    
    def batch_correct(self, texts, prompts=None):
        """
        Correct multiple texts at once
        
        Args:
            texts: List of student texts
            prompts: Optional list of prompts (same length as texts)
            
        Returns:
            List of correction results
        """
        if prompts is None:
            prompts = [""] * len(texts)
        
        results = []
        for text, prompt in zip(texts, prompts):
            result = self.correct_text(text, prompt)
            results.append(result)
        
        return results


def run_predefined_tests():
    """Run predefined test cases"""
    
    # Initialize the corrector
    corrector = FCEErrorCorrector()
    
    print("\n" + "🔍 RUNNING PREDEFINED TEST CASES ".center(70, "="))
    print()
    
    # Test cases
    test_cases = [
        {
            'name': 'Test 1: Multiple error types',
            'prompt': 'You recently entered a competition. Write a letter to the organiser.',
            'input': 'Dear Sir, Thanks for you letter. I am very exciting to hear I win the prize.'
        },
        {
            'name': 'Test 2: Agreement and verb form errors',
            'prompt': 'Your teacher has asked you to write a report about daily life at your school.',
            'input': 'In my school, student learn many subject. They enjoy study in library.'
        },
        {
            'name': 'Test 3: Tense errors with FCE-style prompt',
            'prompt': 'Last month you went on vacation with your family. Write a letter to your English pen friend describing your vacation.',
            'input': 'Last summer I go to Spain with my family. We stay at hotel near the beach.'
        },
        {
            'name': 'Test 4: No context (general correction)',
            'prompt': '',
            'input': 'She don\'t like coffee. He have three brother.'
        },
        {
            'name': 'Test 5: Preposition and article errors',
            'prompt': 'Write about your daily routine.',
            'input': 'Every day I wake up at morning and go to school by bus. I arrive at school in 8 o\'clock.'
        },
        {
            'name': 'Test 6: Already correct text',
            'prompt': 'Describe your family.',
            'input': 'I have two brothers and one sister. We live in a big house near the city center.'
        }
    ]
    
    results = []
    for i, test in enumerate(test_cases, 1):
        print(f"\n{'='*70}")
        print(f"{test['name']}")
        result = corrector.correct_text(test['input'], test['prompt'])
        corrector.print_correction(result)
        results.append(result)
    
    # Summary
    print("\n" + "📊 TEST SUMMARY ".center(70, "="))
    print(f"Total tests: {len(test_cases)}")
    texts_with_errors = sum(1 for r in results if r['has_errors'])
    print(f"Texts with corrections: {texts_with_errors}/{len(test_cases)}")
    print(f"Texts already correct: {len(test_cases) - texts_with_errors}/{len(test_cases)}")
    total_changes = sum(len(r['changes']) for r in results)
    print(f"Total changes made: {total_changes}")
    
    # Overall score
    total_score = sum(r['score'] for r in results)
    max_possible_score = len(test_cases) * 10
    average_score = total_score / len(test_cases) if results else 0
    print(f"\nOVERALL SCORE: {total_score}/{max_possible_score}")
    print(f"Average score per text: {average_score:.1f}/10")
    print("=" * 70)
    
    return results


def interactive_mode():
    """Interactive testing mode"""
    
    corrector = FCEErrorCorrector()
    
    print("\n" + "🎯 INTERACTIVE MODE ".center(70, "="))
    print("Enter student text to check for errors (or 'quit' to exit)")
    print("Tip: Providing a prompt/question gives better results!")
    print("=" * 70)
    print()
    
    while True:
        print("\n" + "-" * 70)
        student_input = input("Student text: ").strip()
        
        if student_input.lower() in ['quit', 'exit', 'q']:
            print("Exiting interactive mode. Goodbye!")
            break
        
        if not student_input:
            print("⚠ Please enter some text.")
            continue
        
        prompt = input("Prompt/Question (optional, press Enter to skip): ").strip()
        
        print("\n⏳ Analyzing...")
        result = corrector.correct_text(student_input, prompt)
        corrector.print_correction(result)


def batch_test_from_file(file_path):
    """Test corrections from a file (one text per line)"""
    
    corrector = FCEErrorCorrector()
    
    print(f"\n📄 Loading texts from {file_path}...")
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            texts = [line.strip() for line in f if line.strip()]
        
        print(f"Found {len(texts)} texts to correct\n")
        
        for i, text in enumerate(texts, 1):
            print(f"\n{'='*70}")
            print(f"Text {i}/{len(texts)}")
            result = corrector.correct_text(text)
            corrector.print_correction(result)
    
    except FileNotFoundError:
        print(f"❌ Error: File '{file_path}' not found")
    except Exception as e:
        print(f"❌ Error reading file: {e}")


if __name__ == "__main__":
    import sys
    
    print("\n" + "🎓 FCE ERROR CORRECTION MODEL - TEST INTERFACE ".center(70, "="))
    print()
    
    # Check if model exists
    model_path = "/content/drive/MyDrive/FCEModel/trained_model"
    if not os.path.exists(model_path):
        print(f"❌ Error: Model not found at {model_path}")
        print("Please train the model first using train_fce_correction_error_feedback.py")
        sys.exit(1)
    
    # Menu
    print("Choose a testing mode:")
    print("  1. Run predefined test cases")
    print("  2. Interactive mode (enter your own text)")
    print("  3. Batch test from file")
    print("  4. Exit")
    print()
    
    choice = input("Enter choice (1-4): ").strip()
    
    if choice == '1':
        run_predefined_tests()
    elif choice == '2':
        interactive_mode()
    elif choice == '3':
        file_path = input("Enter file path: ").strip()
        batch_test_from_file(file_path)
    elif choice == '4':
        print("Goodbye!")
    else:
        print("Invalid choice. Running predefined tests by default.")
        run_predefined_tests()