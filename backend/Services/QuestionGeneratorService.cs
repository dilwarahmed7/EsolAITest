using System.Text;
using System.Text.RegularExpressions;
using backend.Models.DTOs;
using backend.Services.Interfaces;

namespace backend.Services
{
    public class QuestionGeneratorService : IQuestionGeneratorService
    {
        private readonly IGeminiClient _geminiClient;

        public QuestionGeneratorService(IGeminiClient geminiClient)
        {
            _geminiClient = geminiClient;
        }

        public async Task<PracticeQuestionResponse> GenerateAsync(QuestionGenerationRequest request)
        {
            request.Seed ??= Guid.NewGuid().ToString("N");

            string modelUsed = "";
            string lastRaw = "";
            List<PracticeQuestion> parsed = new();

            for (int attempt = 1; attempt <= 10; attempt++)
            {
                var prompt = BuildPrompt(request);

                var result = await _geminiClient.GenerateTextAsync(prompt, seed: request.Seed);
                modelUsed = result.ModelUsed;
                lastRaw = result.Output;

                parsed = ParseGeminiResponse(lastRaw);

                Console.WriteLine($"[QuestionGenerator] Attempt {attempt} | Seed: {request.Seed} | Model: {modelUsed} | Parsed: {parsed.Count}");

                if (parsed.Count == 3 && PassesTypeGate(request.ErrorType, request.Level, parsed))
                {
                    return new PracticeQuestionResponse
                    {
                        Questions = parsed,
                        ModelUsed = modelUsed
                    };
                }

                request.Seed = Guid.NewGuid().ToString("N");
            }

            Console.WriteLine("[QuestionGenerator] Could not get 3 questions that match error type + format. Last raw output:");
            Console.WriteLine("--------------------------------------------------");
            Console.WriteLine(lastRaw);
            Console.WriteLine("--------------------------------------------------");

            return new PracticeQuestionResponse
            {
                Questions = new List<PracticeQuestion>(),
                ModelUsed = modelUsed
            };
        }

        private string BuildPrompt(QuestionGenerationRequest request)
        {
            request.Seed ??= Guid.NewGuid().ToString("N");

            var seed = request.Seed!;
            var errorType = NormalizeErrorType(request.ErrorType);
            var level = NormalizeLevel(request.Level);
            var age = request.Age;
            var l1 = (request.FirstLanguage ?? "").Trim();

            var topics = Pick3Topics(seed, level, age);

            var sb = new StringBuilder();

            AppendIntro(sb);
            AppendSeedRules(sb, seed);
            AppendLearnerProfile(sb, l1, age, level);

            AppendCefrDifficulty(sb, level);
            AppendAgeAppropriateness(sb, age);

            AppendTopics(sb, topics);

            if (errorType == "punctuation")
                AppendStructureRulesPunctuation(sb, level);
            else
                AppendStructureRulesDefault(sb);

            AppendBlankRules(sb);
            AppendAnswerRules(sb);

            AppendErrorTypeRules(sb, errorType, level);

            AppendSelfCheck(sb);
            AppendStrictOutputFormat(sb);

            return sb.ToString();
        }

        private static void AppendIntro(StringBuilder sb)
        {
            sb.AppendLine("You are an expert English teacher creating grammar practice for ESOL learners.");
            sb.AppendLine();
        }

        private static void AppendSeedRules(StringBuilder sb, string seed)
        {
            sb.AppendLine($"SEED: {seed}");
            sb.AppendLine("Use the SEED to randomize names, places, objects, and details so each request is different.");
            sb.AppendLine();
        }

        private static void AppendLearnerProfile(StringBuilder sb, string l1, int age, string level)
        {
            sb.AppendLine("LEARNER:");
            sb.AppendLine($"- First language (L1): {l1} (use only for natural names/places; do NOT mention L1)");
            sb.AppendLine($"- Age: {age} (keep contexts age-appropriate)");
            sb.AppendLine($"- CEFR level: {level}");
            sb.AppendLine();
        }

        private static void AppendCefrDifficulty(StringBuilder sb, string level)
        {
            sb.AppendLine("CEFR DIFFICULTY (MUST FOLLOW):");

            switch (level)
            {
                case "A1":
                    sb.AppendLine("- Use 6–9 words per sentence.");
                    sb.AppendLine("- Present simple only.");
                    sb.AppendLine("- Very basic everyday vocabulary.");
                    sb.AppendLine("- Avoid complex clauses and idioms.");
                    break;

                case "A2":
                    sb.AppendLine("- Use 8–12 words per sentence.");
                    sb.AppendLine("- Present simple + simple past + 'going to' allowed.");
                    sb.AppendLine("- Everyday topics and simple situations.");
                    break;

                case "B1":
                    sb.AppendLine("- Use 10–15 words per sentence.");
                    sb.AppendLine("- Everyday + work/study contexts.");
                    sb.AppendLine("- Use common tenses naturally; avoid very complex grammar.");
                    break;

                case "B2":
                    sb.AppendLine("- Use 12–18 words per sentence.");
                    sb.AppendLine("- More fluent and varied grammar; realistic contexts.");
                    break;

                default: // C1/C2
                    sb.AppendLine("- Use 14–22 words per sentence.");
                    sb.AppendLine("- Advanced, natural language; complex clauses allowed.");
                    break;
            }

            sb.AppendLine();
        }

        private static void AppendAgeAppropriateness(StringBuilder sb, int age)
        {
            sb.AppendLine("AGE APPROPRIATENESS (MUST FOLLOW):");

            if (age <= 12)
            {
                sb.AppendLine("- Child-friendly contexts: school, family, hobbies.");
                sb.AppendLine("- No adult themes (contracts, complaints, legal/policy content).");
            }
            else if (age <= 17)
            {
                sb.AppendLine("- Teen contexts: school, friends, hobbies, part-time jobs.");
                sb.AppendLine("- Avoid formal legal/policy/contract content.");
            }
            else
            {
                sb.AppendLine("- Adult contexts: work, appointments, services, travel, housing, emails.");
                sb.AppendLine("- Keep situations realistic and respectful.");
            }

            sb.AppendLine();
        }

        private static void AppendTopics(StringBuilder sb, List<string> topics)
        {
            sb.AppendLine("TOPICS (MANDATORY):");
            sb.AppendLine($"- Question 1 topic: {topics[0]}");
            sb.AppendLine($"- Question 2 topic: {topics[1]}");
            sb.AppendLine($"- Question 3 topic: {topics[2]}");
            sb.AppendLine();
        }

        private static void AppendStructureRulesDefault(StringBuilder sb)
        {
            sb.AppendLine("STRUCTURE (MANDATORY):");
            sb.AppendLine("- Q1: 1 sentence statement");
            sb.AppendLine("- Q2: 1 sentence question (MUST end with ?)");
            sb.AppendLine("- Q3: 2 sentences");
            sb.AppendLine();
        }

        private static void AppendStructureRulesPunctuation(StringBuilder sb, string level)
        {
            sb.AppendLine("STRUCTURE (MANDATORY):");

            if (level is "A1" or "A2")
            {
                sb.AppendLine("- Q1: 2 short sentences (blank the punctuation between them).");
                sb.AppendLine("- Q2: 1 short question (blank the FINAL ? at the end).");
                sb.AppendLine("- Q3: 2 short sentences (blank the punctuation between them).");
            }
            else
            {
                sb.AppendLine("- Q1: 1–2 sentences.");
                sb.AppendLine("- Q2: 1 question sentence.");
                sb.AppendLine("- Q3: 2 sentences.");
            }

            sb.AppendLine();
        }

        private static void AppendBlankRules(StringBuilder sb)
        {
            sb.AppendLine("BLANK RULES (MOST IMPORTANT):");
            sb.AppendLine("- EVERY question MUST contain at least ONE blank written EXACTLY as ___");
            sb.AppendLine("- Use 1–2 blanks per question.");
            sb.AppendLine("- If ANY question is missing ___, output exactly: INVALID");
            sb.AppendLine();
        }

        private static void AppendAnswerRules(StringBuilder sb)
        {
            sb.AppendLine("ANSWER RULES:");
            sb.AppendLine("- Answers MUST be a JSON array in square brackets.");
            sb.AppendLine("- Number of answers MUST equal number of blanks.");
            sb.AppendLine("- If answers do not match the error type rules below, output exactly: INVALID");
            sb.AppendLine();
        }

        private static void AppendErrorTypeRules(StringBuilder sb, string errorType, string level)
        {
            sb.AppendLine($"ERROR TYPE (ONLY THIS TYPE): {errorType}");
            sb.AppendLine("ERROR TYPE RULES (CRITICAL):");

            switch (errorType)
            {
                case "preposition":
                    AppendPrepositionRules(sb);
                    break;

                case "article":
                    AppendArticleRules(sb);
                    break;

                case "punctuation":
                    AppendPunctuationRules(sb, level);
                    break;

                case "spelling":
                    AppendSpellingRules(sb);
                    break;

                case "verbtense":
                    AppendVerbTenseRules(sb, level);
                    break;

                case "verbform":
                    AppendVerbFormRules(sb, level);
                    break;

                case "agreement":
                    AppendAgreementRules(sb);
                    break;

                case "wordchoice":
                    AppendWordChoiceRules(sb);
                    break;

                case "wordorder":
                    AppendWordOrderRules(sb);
                    break;

                case "missingword":
                    AppendMissingWordRules(sb);
                    break;

                case "modality":
                    AppendModalityRules(sb);
                    break;

                default:
                    sb.AppendLine("- If the ERROR TYPE is unknown, output INVALID.");
                    break;
            }

            sb.AppendLine();
        }

        private static void AppendPrepositionRules(StringBuilder sb)
        {
            sb.AppendLine("1) Preposition:");
            sb.AppendLine("- Every blank is ONLY a missing preposition.");
            sb.AppendLine("- Answers MUST be ONLY prepositions from this list:");
            sb.AppendLine("  in, on, at, to, for, from, with, by, about, into, over, under, between, behind,");
            sb.AppendLine("  before, after, during, without, through, across, around, near, inside, outside, above, below,");
            sb.AppendLine("  in front of, next to.");
            sb.AppendLine("- Do NOT blank articles, verbs, nouns, or punctuation.");
            sb.AppendLine();
            sb.AppendLine("EXAMPLE:");
            sb.AppendLine("Question 1:");
            sb.AppendLine("I go ___ school every day.");
            sb.AppendLine("Answer 1:");
            sb.AppendLine("[\"to\"]");
        }

        private static void AppendArticleRules(StringBuilder sb)
        {
            sb.AppendLine("1) Article:");
            sb.AppendLine("- Every blank is ONLY an article position.");
            sb.AppendLine("- Answers MUST be ONLY: \"a\", \"an\", \"the\", or \"\" (empty string for zero article).");
            sb.AppendLine("- Do NOT blank possessives (my/your/his/her/our/their).");
            sb.AppendLine("- Prefer unambiguous noun phrases (avoid cases where multiple answers could fit).");
            sb.AppendLine();
            sb.AppendLine("EXAMPLE:");
            sb.AppendLine("Question 1:");
            sb.AppendLine("I saw ___ dog in the park.");
            sb.AppendLine("Answer 1:");
            sb.AppendLine("[\"a\"]");
        }

        private static void AppendPunctuationRules(StringBuilder sb, string level)
        {
            sb.AppendLine("1) Punctuation:");
            sb.AppendLine("- EVERY question MUST include ___ (even Q2).");
            sb.AppendLine("- EVERY blank ___ replaces ONLY punctuation. Do NOT remove/replace any words.");

            if (level is "A1" or "A2")
            {
                sb.AppendLine("- For A1/A2: ONLY blank end punctuation: \".\" or \"?\" or \"!\".");
                sb.AppendLine("- Put ___ EXACTLY where the end punctuation should be.");
                sb.AppendLine("- For Q2, blank the FINAL question mark, like: 'Do you like music___'");
                sb.AppendLine("- If a sentence continues after a blanked \".\" then the next sentence MUST start with a capital letter.");
                sb.AppendLine("- Do NOT place \"?\" before \"or\" choices (bad: \"pizza? or pasta?\").");
                sb.AppendLine();
                sb.AppendLine("EXAMPLE:");
                sb.AppendLine("Question 1:");
                sb.AppendLine("I am at home___ It is cold today.");
                sb.AppendLine("Answer 1:");
                sb.AppendLine("[\".\"]");
            }
            else
            {
                sb.AppendLine("- Allowed answers: \".\", \",\", \"?\", \"!\", \":\", \";\", \"'\", \"\\\"\", \"-\".");
                sb.AppendLine("- Blanks must be placed where punctuation naturally belongs.");
                sb.AppendLine("- Do NOT blank normal words.");
            }
        }

        private static void AppendSpellingRules(StringBuilder sb)
        {
            sb.AppendLine("1) Spelling:");
            sb.AppendLine("- Each blank replaces ONE misspelled word.");
            sb.AppendLine("- The sentence must show the incorrect spelling in place of the blank (e.g., '(cofee)').");
            sb.AppendLine("- Answers are the correct spellings (letters only, no spaces).");
            sb.AppendLine();
            sb.AppendLine("EXAMPLE:");
            sb.AppendLine("Question 1:");
            sb.AppendLine("I like ___ (cofee).");
            sb.AppendLine("Answer 1:");
            sb.AppendLine("[\"coffee\"]");
        }

        private static void AppendVerbTenseRules(StringBuilder sb, string level)
        {
            sb.AppendLine("1) VerbTense:");
            sb.AppendLine("- Each blank is a missing verb phrase that tests tense choice.");
            sb.AppendLine("- Use time markers to make the tense unambiguous (yesterday/now/already/tomorrow/last week).");
            sb.AppendLine("- Answers MUST be complete verb forms (may include auxiliaries like 'is', 'am', 'are', 'was', 'were', 'have', 'has', 'did').");
            if (level == "A1")
                sb.AppendLine("- For A1: use present simple or simple past only.");
            sb.AppendLine();
            sb.AppendLine("EXAMPLE:");
            sb.AppendLine("Question 1:");
            sb.AppendLine("Yesterday I ___ to the shop.");
            sb.AppendLine("Answer 1:");
            sb.AppendLine("[\"went\"]");
        }

        private static void AppendVerbFormRules(StringBuilder sb, string level)
        {
            sb.AppendLine("1) VerbForm:");
            sb.AppendLine("- Each blank tests verb form (infinitive, -ing, past participle, third person -s), NOT tense meaning.");
            sb.AppendLine("- Use clear triggers (want + to, enjoy + -ing, can + base verb, have + past participle).");
            sb.AppendLine("- Answers should be the correctly formed verb chunk.");
            if (level == "A1")
                sb.AppendLine("- For A1: keep forms basic (to + verb, -ing after like/love).");
            sb.AppendLine();
            sb.AppendLine("EXAMPLE:");
            sb.AppendLine("Question 1:");
            sb.AppendLine("I want ___ (to go) home.");
            sb.AppendLine("Answer 1:");
            sb.AppendLine("[\"to go\"]");
        }

        private static void AppendAgreementRules(StringBuilder sb)
        {
            sb.AppendLine("1) Agreement:");
            sb.AppendLine("- Each blank targets agreement ONLY (subject–verb agreement or determiner agreement).");
            sb.AppendLine("- Examples: is/are, has/have, do/does, this/these, that/those.");
            sb.AppendLine("- Keep subjects clear singular/plural so the answer is obvious.");
            sb.AppendLine("- Answers should be SHORT (1–2 words).");
            sb.AppendLine();
            sb.AppendLine("EXAMPLE:");
            sb.AppendLine("Question 1:");
            sb.AppendLine("My friends ___ happy.");
            sb.AppendLine("Answer 1:");
            sb.AppendLine("[\"are\"]");
        }

        private static void AppendWordChoiceRules(StringBuilder sb)
        {
            sb.AppendLine("1) WordChoice:");
            sb.AppendLine("- Each blank is ONE missing word where only ONE common word fits best.");
            sb.AppendLine("- Use common confusions (make/do, say/tell, fun/funny, borrow/lend).");
            sb.AppendLine("- Answers MUST be a single word (no spaces).");
            sb.AppendLine();
            sb.AppendLine("EXAMPLE:");
            sb.AppendLine("Question 1:");
            sb.AppendLine("Can you ___ me your pen?");
            sb.AppendLine("Answer 1:");
            sb.AppendLine("[\"lend\"]");
        }

        private static void AppendWordOrderRules(StringBuilder sb)
        {
            sb.AppendLine("1) WordOrder:");
            sb.AppendLine("- The sentence contains a word order problem; the blank is a missing short chunk to fix it.");
            sb.AppendLine("- Answers should be 1–3 words (short chunk), NOT punctuation only.");
            sb.AppendLine("- Target: adverb position (always/usually), question order, object pronoun position.");
            sb.AppendLine("- Do NOT turn this into a missing preposition/article exercise.");
            sb.AppendLine();
            sb.AppendLine("EXAMPLE:");
            sb.AppendLine("Question 1:");
            sb.AppendLine("I ___ go to work. (always)");
            sb.AppendLine("Answer 1:");
            sb.AppendLine("[\"always\"]");
        }

        private static void AppendMissingWordRules(StringBuilder sb)
        {
            sb.AppendLine("1) MissingWord:");
            sb.AppendLine("- Each blank is a missing FUNCTION word needed for grammar (auxiliary, pronoun, connector, 'to', etc.).");
            sb.AppendLine("- Answers should be short (1–2 words).");
            sb.AppendLine("- Do NOT use prepositions-only or articles-only blanks (those are separate error types).");
            sb.AppendLine();
            sb.AppendLine("EXAMPLE:");
            sb.AppendLine("Question 1:");
            sb.AppendLine("She ___ happy today.");
            sb.AppendLine("Answer 1:");
            sb.AppendLine("[\"is\"]");
        }

        private static void AppendModalityRules(StringBuilder sb)
        {
            sb.AppendLine("1) Modality:");
            sb.AppendLine("- Each blank targets modals or semi-modals (can/could/should/must/have to/might).");
            sb.AppendLine("- Answers MUST be a modal or modal phrase (e.g., 'should', 'have to').");
            sb.AppendLine("- Context must clearly signal advice/obligation/ability/permission/possibility.");
            sb.AppendLine();
            sb.AppendLine("EXAMPLE:");
            sb.AppendLine("Question 1:");
            sb.AppendLine("You ___ see a doctor.");
            sb.AppendLine("Answer 1:");
            sb.AppendLine("[\"should\"]");
        }

        private static void AppendSelfCheck(StringBuilder sb)
        {
            sb.AppendLine("MANDATORY SELF-CHECK (SILENT):");
            sb.AppendLine("- Insert answers into blanks.");
            sb.AppendLine("- Read the result.");
            sb.AppendLine("- If anything is unnatural/ungrammatical or wrong error type, rewrite it.");
            sb.AppendLine("- If you cannot satisfy ALL rules, output INVALID.");
            sb.AppendLine();
        }

        private static void AppendStrictOutputFormat(StringBuilder sb)
        {
            sb.AppendLine("STRICT OUTPUT FORMAT (NO EXTRA TEXT):");
            sb.AppendLine();
            sb.AppendLine("Question 1:");
            sb.AppendLine("<question>");
            sb.AppendLine();
            sb.AppendLine("Answer 1:");
            sb.AppendLine("[\"answer\"]");
            sb.AppendLine();
            sb.AppendLine("Question 2:");
            sb.AppendLine("<question>");
            sb.AppendLine();
            sb.AppendLine("Answer 2:");
            sb.AppendLine("[\"answer\"]");
            sb.AppendLine();
            sb.AppendLine("Question 3:");
            sb.AppendLine("<question>");
            sb.AppendLine();
            sb.AppendLine("Answer 3:");
            sb.AppendLine("[\"answer\"]");
        }

        private static string NormalizeLevel(string? raw)
        {
            var lvl = (raw ?? "B1").Trim().ToUpperInvariant();
            return lvl switch
            {
                "A1" => "A1",
                "A2" => "A2",
                "B1" => "B1",
                "B2" => "B2",
                "C1" => "C1",
                "C2" => "C2",
                _ => "B1"
            };
        }

        private static string NormalizeErrorType(string? raw)
        {
            var et = (raw ?? "").Trim().ToLowerInvariant().Replace(" ", "");

            return et switch
            {
                "articles" => "article",
                "article" => "article",
                "prepositions" => "preposition",
                "preposition" => "preposition",
                "punctuation" => "punctuation",
                "spelling" => "spelling",
                "verbtense" => "verbtense",
                "verbtenses" => "verbtense",
                "verbform" => "verbform",
                "wordchoice" => "wordchoice",
                "wordorder" => "wordorder",
                "missingword" => "missingword",
                "agreement" => "agreement",
                "modality" => "modality",
                _ => et
            };
        }

        private static readonly string[] TopicsA =
        {
            "family", "food", "shopping", "school", "home", "hobbies", "weather", "sports", "travel"
        };

        private static readonly string[] TopicsB =
        {
            "work", "study", "restaurants", "public transport", "appointments",
            "phone calls", "emails", "housing", "technology", "exercise", "movies", "music"
        };

        private static readonly string[] TopicsC =
        {
            "work emails", "customer support", "travel problems", "project update",
            "complaint message", "public services", "housing contract", "policy changes"
        };

        private static List<string> Pick3Topics(string seed, string level, int age)
        {
            int hash = seed.Aggregate(17, (acc, c) => acc * 31 + c);
            var rng = new Random(hash);

            string[] pool = (level == "A1" || level == "A2") ? TopicsA
                         : (level == "B1" || level == "B2") ? TopicsB
                         : TopicsC;

            if (age <= 17)
            {
                pool = pool.Where(t =>
                    !t.Contains("contract", StringComparison.OrdinalIgnoreCase) &&
                    !t.Contains("policy", StringComparison.OrdinalIgnoreCase) &&
                    !t.Contains("public services", StringComparison.OrdinalIgnoreCase) &&
                    !t.Contains("complaint", StringComparison.OrdinalIgnoreCase)
                ).ToArray();

                if (pool.Length < 3)
                    pool = TopicsA;
            }

            var list = pool.ToList();
            for (int i = list.Count - 1; i > 0; i--)
            {
                int j = rng.Next(i + 1);
                (list[i], list[j]) = (list[j], list[i]);
            }

            return list.Distinct(StringComparer.OrdinalIgnoreCase).Take(3).ToList();
        }

        private List<PracticeQuestion> ParseGeminiResponse(string raw)
        {
            raw = (raw ?? "").Replace("\r\n", "\n");
            if (string.IsNullOrWhiteSpace(raw))
                return new List<PracticeQuestion>();

            if (raw.Trim().Equals("INVALID", StringComparison.OrdinalIgnoreCase))
                return new List<PracticeQuestion>();

            for (int i = 1; i <= 3; i++)
            {
                var m = Regex.Match(
                    raw,
                    $@"Question\s*{i}\s*:\s*(?<q>.*?)(?=\n\s*Answer\s*{i}\s*:)",
                    RegexOptions.IgnoreCase | RegexOptions.Singleline);

                if (!m.Success) return new List<PracticeQuestion>();

                var qText = m.Groups["q"].Value;
                if (!qText.Contains("_"))
                    return new List<PracticeQuestion>();
            }

            var blocks = Regex.Matches(
                raw,
                @"Question\s*(?<qnum>[1-3])\s*:\s*(?<qtext>.*?)\s*Answer\s*(?<anum>[1-3])\s*:\s*(?<alist>\[[\s\S]*?\]|[^\n]+)",
                RegexOptions.IgnoreCase | RegexOptions.Singleline);

            if (blocks.Count == 0)
                return new List<PracticeQuestion>();

            var temp = new Dictionary<int, PracticeQuestion>();

            foreach (Match m in blocks)
            {
                if (!int.TryParse(m.Groups["qnum"].Value, out int qnum)) continue;
                if (!int.TryParse(m.Groups["anum"].Value, out int anum)) continue;
                if (qnum != anum) continue;

                var questionText = m.Groups["qtext"].Value.Trim();
                var answersRaw = m.Groups["alist"].Value.Trim();

                questionText = Regex.Replace(questionText, @"_{2,}", "___");

                int blankCount = Regex.Matches(questionText, @"___").Count;
                if (blankCount <= 0) continue;

                var answers = ParseAnswers(answersRaw);
                if (answers.Count != blankCount) continue;

                temp[qnum] = new PracticeQuestion
                {
                    QuestionText = questionText,
                    Answers = answers
                };
            }

            var result = new List<PracticeQuestion>();
            for (int i = 1; i <= 3; i++)
            {
                if (!temp.TryGetValue(i, out var q))
                    return new List<PracticeQuestion>();
                result.Add(q);
            }

            return result;
        }

        private static List<string> ParseAnswers(string raw)
        {
            raw = (raw ?? "").Trim();

            if (raw.StartsWith("["))
            {
                var quoted = Regex.Matches(raw, "\"(.*?)\"", RegexOptions.Singleline)
                                  .Select(m => m.Groups[1].Value.Trim())
                                  .ToList();

                if (quoted.Count > 0)
                    return quoted;

                var inner = raw.Trim().TrimStart('[').TrimEnd(']');
                return inner.Split(',', StringSplitOptions.RemoveEmptyEntries)
                            .Select(x => x.Trim().Trim('"').Trim('\''))
                            .ToList();
            }

            var single = raw.Trim().Trim('"').Trim('\'');
            return string.IsNullOrWhiteSpace(single) ? new List<string>() : new List<string> { single };
        }

        private static bool PassesTypeGate(string? errorTypeRaw, string? levelRaw, List<PracticeQuestion> questions)
        {
            var et = NormalizeErrorType(errorTypeRaw);
            var level = NormalizeLevel(levelRaw);

            if (et != "punctuation")
            {
                if (!questions[1].QuestionText.TrimEnd().EndsWith("?"))
                    return false;
            }

            if (questions.Any(q => !q.QuestionText.Contains("___")))
                return false;

            return et switch
            {
                "article" => AllAnswersAreArticles(questions),
                "preposition" => AllAnswersArePrepositions(questions),
                "punctuation" => AllAnswersArePunctuationStrict(questions, level) && PunctuationPlacementsLookNatural(questions, level),
                "spelling" => AllAnswersLookLikeSingleWords(questions),
                "wordchoice" => AllAnswersLookLikeSingleWords(questions),
                "modality" => AllAnswersAreModalish(questions),
                "agreement" => AllAnswersLookLikeAgreementForms(questions),
                "missingword" => AllAnswersLookLikeMissingWords(questions),
                "wordorder" => AllAnswersLookLikeShortChunks(questions),
                "verbtense" => AllAnswersLookLikeVerbPhrases(questions),
                "verbform" => AllAnswersLookLikeVerbPhrases(questions),
                _ => true
            };
        }

        private static bool AllAnswersAreArticles(List<PracticeQuestion> questions)
        {
            var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "a", "an", "the", "" };
            return questions.All(q => q.Answers.All(a => allowed.Contains(a.Trim())));
        }

        private static readonly HashSet<string> AllowedPrepositions = new(StringComparer.OrdinalIgnoreCase)
        {
            "in","on","at","to","for","from","with","by","about","into","over","under","between","behind",
            "before","after","during","without","through","across","around","near","inside","outside","above","below",
            "in front of","next to"
        };

        private static bool AllAnswersArePrepositions(List<PracticeQuestion> questions)
        {
            return questions.All(q => q.Answers.All(a => AllowedPrepositions.Contains(a.Trim())));
        }

        private static bool AllAnswersArePunctuationStrict(List<PracticeQuestion> questions, string level)
        {
            HashSet<string> allowed = (level is "A1" or "A2")
                ? new HashSet<string> { ".", "?", "!" }
                : new HashSet<string> { ".", ",", "?", "!", ":", ";", "'", "\"", "-", "—" };

            return questions.All(q => q.Answers.All(a => allowed.Contains(a.Trim())));
        }

        private static bool PunctuationPlacementsLookNatural(List<PracticeQuestion> questions, string level)
        {
            foreach (var q in questions)
            {
                var working = q.QuestionText;
                var answers = q.Answers.Select(a => a.Trim()).ToList();

                for (int i = 0; i < answers.Count; i++)
                {
                    var a = answers[i];
                    var idx = working.IndexOf("___", StringComparison.Ordinal);
                    if (idx < 0) return false;

                    var after = working.Substring(idx + 3);

                    if (a is "." or "!" or "?")
                    {
                        var afterTrim = after.TrimStart();
                        if (afterTrim.StartsWith("or ", StringComparison.OrdinalIgnoreCase) ||
                            afterTrim.StartsWith("and ", StringComparison.OrdinalIgnoreCase) ||
                            afterTrim.StartsWith("but ", StringComparison.OrdinalIgnoreCase))
                            return false;
                    }

                    if (a == ".")
                    {
                        var j = 0;
                        while (j < after.Length && char.IsWhiteSpace(after[j])) j++;
                        if (j < after.Length && char.IsLetter(after[j]) && !char.IsUpper(after[j]))
                            return false;
                    }

                    if (level is "A1" or "A2")
                    {
                        if (after.Length > 0 && !char.IsWhiteSpace(after[0]))
                            return false;
                    }

                    working = working.Remove(idx, 3).Insert(idx, a);
                }

                if (Regex.IsMatch(working, @"[?!\.]{2,}"))
                    return false;
            }

            return true;
        }

        private static bool AllAnswersLookLikeSingleWords(List<PracticeQuestion> questions)
        {
            return questions.All(q => q.Answers.All(a =>
                Regex.IsMatch(a.Trim(), @"^[A-Za-z]+([\'\-][A-Za-z]+)?$")));
        }

        private static bool AllAnswersAreModalish(List<PracticeQuestion> questions)
        {
            var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "can","could","may","might","must","should","would","will","shall",
                "have to","has to","had to","need to","needs to","needed to","ought to"
            };

            return questions.All(q => q.Answers.All(a => allowed.Contains(a.Trim())));
        }

        private static bool AllAnswersLookLikeAgreementForms(List<PracticeQuestion> questions)
        {
            var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "is","are","was","were",
                "has","have","had",
                "do","does","did",
                "this","these","that","those",
                "a","an"
            };

            return questions.All(q => q.Answers.All(a =>
            {
                var s = a.Trim();
                if (allowed.Contains(s)) return true;
                if (s.Equals("don't", StringComparison.OrdinalIgnoreCase) || s.Equals("doesn't", StringComparison.OrdinalIgnoreCase))
                    return true;
                return false;
            }));
        }

        private static bool AllAnswersLookLikeMissingWords(List<PracticeQuestion> questions)
        {
            var articles = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "a", "an", "the", "" };

            return questions.All(q => q.Answers.All(a =>
            {
                var s = a.Trim();
                if (string.IsNullOrWhiteSpace(s)) return false;

                var parts = s.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length < 1 || parts.Length > 2) return false;

                if (!parts.All(p => Regex.IsMatch(p, @"^[A-Za-z]+(\'[A-Za-z]+)?$"))) return false;

                if (articles.Contains(s)) return false;
                if (AllowedPrepositions.Contains(s)) return false;

                return true;
            }));
        }

        private static bool AllAnswersLookLikeShortChunks(List<PracticeQuestion> questions)
        {
            return questions.All(q => q.Answers.All(a =>
            {
                var s = a.Trim();
                if (string.IsNullOrWhiteSpace(s)) return false;

                var parts = s.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length < 1 || parts.Length > 3) return false;

                return parts.All(p => Regex.IsMatch(p, @"^[A-Za-z]+([\'\-][A-Za-z]+)?$"));
            }));
        }

        private static bool AllAnswersLookLikeVerbPhrases(List<PracticeQuestion> questions)
        {
            return questions.All(q => q.Answers.All(a =>
            {
                var s = a.Trim();
                if (string.IsNullOrWhiteSpace(s)) return false;
                if (Regex.IsMatch(s, @"[0-9]")) return false;
                if (Regex.IsMatch(s, @"^[\.\,\?\!\:\;\'\""\-\—]+$")) return false;

                var parts = s.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length < 1 || parts.Length > 4) return false;

                return parts.All(p => Regex.IsMatch(p, @"^[A-Za-z]+([\'\-][A-Za-z]+)?$"));
            }));
        }
    }
}
