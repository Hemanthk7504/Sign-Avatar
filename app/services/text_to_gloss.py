"""
Text -> Gloss conversion.

Converts free-form English text into a simplified gloss sequence approximating
sign-language grammar (topic-comment ordering, dropped articles/copulas,
tagged non-manual markers for questions/negation). This is a linguistically
-informed rule-based pass; it is intentionally decoupled from motion
generation so it can later be replaced by a trained seq2seq gloss model
without touching the rest of the pipeline.
"""
import re
from typing import List

from app.schemas import GlossToken

# Words that carry little sign-level meaning and are dropped in ASL-style gloss.
DROP_WORDS = {
    "a", "an", "the", "is", "are", "am", "was", "were", "be", "been", "being",
    "do", "does", "did", "to", "of", "for", "in", "on", "at", "and", "but",
    "will", "would", "shall", "should", "can", "could", "may", "might",
}

WH_WORDS = {"who", "what", "when", "where", "why", "how", "which"}
NEGATION_WORDS = {"not", "no", "never", "n't", "cannot", "cant", "don't", "doesn't", "didn't"}

TIME_WORDS = {
    "today", "tomorrow", "yesterday", "now", "later", "soon",
    "morning", "afternoon", "evening", "night", "week", "month", "year",
}


def _tokenize(text: str) -> List[str]:
    text = text.strip()
    # Split off terminal punctuation but keep it as its own token so we can
    # detect question/negation intent.
    tokens = re.findall(r"[A-Za-z']+|[.?!]", text)
    return tokens


def _lemma(word: str) -> str:
    """Very small heuristic lemmatizer sufficient for gloss lookup."""
    w = word.lower()
    if w.endswith("ing") and len(w) > 5:
        return w[:-3]
    if w.endswith("ed") and len(w) > 4:
        return w[:-2]
    if w.endswith("s") and not w.endswith("ss") and len(w) > 3:
        return w[:-1]
    return w


def text_to_gloss(text: str) -> List[GlossToken]:
    """
    Convert a sentence (or several) into an ordered list of GlossToken.
    Applies:
      - stopword dropping
      - lemmatization
      - TIME-fronting (time words moved to the front of their clause, common in ASL)
      - WH-question / yes-no question / negation tagging as non-manual markers
    """
    raw_tokens = _tokenize(text)
    if not raw_tokens:
        return []

    is_question = raw_tokens[-1] == "?" or raw_tokens[0].lower() in WH_WORDS
    is_wh_question = raw_tokens[0].lower() in WH_WORDS
    has_negation = any(t.lower().rstrip("'") in NEGATION_WORDS for t in raw_tokens)

    words = [t for t in raw_tokens if t not in {".", "?", "!"}]

    content_words = []
    time_words = []
    for w in words:
        lw = w.lower()
        if lw in DROP_WORDS:
            continue
        lemma = _lemma(w)
        if lw in TIME_WORDS:
            time_words.append(lemma)
        else:
            content_words.append(lemma)

    ordered = time_words + content_words  # TIME-fronting

    tokens: List[GlossToken] = []
    for i, lemma in enumerate(ordered):
        non_manual = []
        if is_wh_question:
            non_manual.append("furrowed_brow")      # WH-questions: brows down, head forward
        elif is_question:
            non_manual.append("raised_eyebrows")     # yes/no questions: brows up, head forward
        if has_negation:
            non_manual.append("head_shake")
        if i == len(ordered) - 1 and is_question:
            non_manual.append("head_forward")

        tokens.append(
            GlossToken(
                word=lemma,
                gloss=lemma.upper(),
                non_manual=non_manual,
            )
        )

    return tokens
