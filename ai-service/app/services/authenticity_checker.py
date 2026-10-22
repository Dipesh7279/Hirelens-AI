"""
Step 3 of the resume pipeline: a limited text-pattern heuristic.

This is NOT a certified AI-text detector or plagiarism checker. It flags
two limited patterns only: a small list of template-like phrases and
repeated phrases within the same resume. Report this as a heuristic signal,
never as evidence of authorship or a hiring verdict.
"""
import re
from collections import Counter
from app.models.resume_schema import AuthenticityResult

# A small seed list of generic AI/template boilerplate phrases. In
# production this should be a larger, curated corpus — kept short here
# for a college-project demo.
KNOWN_BOILERPLATE_NGRAMS = {
    "results driven professional with",
    "proven track record of",
    "passionate about leveraging technology",
    "highly motivated self starter",
    "extensive experience in delivering",
}

NGRAM_SIZE = 4  # phrase length in words


def _normalize(text: str) -> list[str]:
    words = re.findall(r"[a-zA-Z]+", text.lower())
    return words


def _ngrams(words: list[str], n: int) -> list[str]:
    return [" ".join(words[i:i + n]) for i in range(len(words) - n + 1)]


ZERO_WIDTH_PATTERN = re.compile(r"[\u200B-\u200D\uFEFF\u2060\u200E\u200F]")

PROMPT_INJECTION_PATTERN = re.compile(
    r"(?i)\b(?:ignore\s+(?:all\s+)?previous\s+instructions|system\s+prompt|grant\s+(?:a\s+)?score\s+of\s+100|bypass\s+(?:all\s+)?rules|disregard\s+(?:all\s+)?prior\s+instructions)\b"
)


def check_authenticity(raw_text: str) -> AuthenticityResult:
    flags = []
    score = 100

    if not isinstance(raw_text, str) or not raw_text.strip():
        return AuthenticityResult(authenticityScore=100, flags=[])

    # Security Signal 1: Zero-Width / Invisible Unicode manipulation
    if ZERO_WIDTH_PATTERN.search(raw_text):
        flags.append("invisible_characters_detected")
        score -= 35

    # Security Signal 2: Adversarial Prompt Injection instructions
    if PROMPT_INJECTION_PATTERN.search(raw_text):
        flags.append("adversarial_injection_detected")
        score -= 40

    words = _normalize(raw_text)
    ngrams = _ngrams(words, NGRAM_SIZE)

    if not ngrams:
        score = max(0, min(100, score))
        return AuthenticityResult(authenticityScore=score, flags=flags)

    # Signal 3: known template-like phrases present verbatim
    boilerplate_hits = sum(1 for g in ngrams if g in KNOWN_BOILERPLATE_NGRAMS)
    if boilerplate_hits >= 2:
        flags.append("ai_generated_pattern")
        score -= min(30, boilerplate_hits * 8)

    # Signal 4: internal repetition — same 5-gram repeated many times
    counts = Counter(ngrams)
    repeated = [g for g, c in counts.items() if c >= 3]
    if repeated:
        flags.append("duplicate_content")
        score -= min(25, len(repeated) * 5)

    # Signal 5: Extreme keyword stuffing
    if len(words) >= 50:
        word_counts = Counter(words)
        _most_frequent_word, highest_freq = word_counts.most_common(1)[0]
        if highest_freq >= 15 and (highest_freq / len(words)) > 0.15:
            flags.append("keyword_stuffing_detected")
            score -= 25

    score = max(0, min(100, score))
    return AuthenticityResult(authenticityScore=score, flags=flags)
