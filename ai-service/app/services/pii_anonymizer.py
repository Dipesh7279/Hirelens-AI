"""
In-memory PII (Personally Identifiable Information) redaction module.
Sanitizes personal emails, phone numbers, and physical residential addresses
before text is transmitted to external cloud LLM providers.
"""
import re

# Scoped package pattern: @scope/package-name (should NOT be treated as email)
SCOPED_PACKAGE_PATTERN = re.compile(r"(?:^|[\s\"'\(])(@[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+)")

# Technical URL pattern to protect
URL_PROTECT_PATTERN = re.compile(r"https?://[^\s\"'>\)]+")

# Email pattern (RFC 5322 simplified, requires standard domain structure)
EMAIL_PATTERN = re.compile(
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"
)

# Phone number patterns:
# 1. International with leading + (e.g., +1-555-123-4567, +44 20 7946 0958, +91 98765 43210, +91 9876543210)
PHONE_INTL_PATTERN = re.compile(
    r"\+\d{1,3}[\s.-]?(?:\(\d{1,4}\)|\d{1,4})[\s.-]?\d{2,5}[\s.-]?\d{3,5}(?:[\s.-]?\d{1,4})?"
)

# 2. Bracketed area code (e.g., (555) 123-4567, (555)123-4567, (020) 7946 0958)
PHONE_PAREN_PATTERN = re.compile(
    r"\(\d{2,4}\)[\s.-]?\d{3,4}[\s.-]?\d{3,4}"
)

# 3. Delimited standard phone (e.g., 555-123-4567, 555.123.4567) - specifically 3-3-4 digit blocks
PHONE_DELIMITED_PATTERN = re.compile(
    r"(?<!\d)\d{3}[-.]\d{3}[-.]\d{4}(?!\d)"
)

# 3b. Unlabeled 10-digit mobile numbers (e.g., 9876543210 or 98765 43210 starting with 6-9)
PHONE_10DIGIT_MOBILE_PATTERN = re.compile(
    r"(?<!\d)[6-9]\d{4}[\s-]?\d{5}(?!\d)"
)

# 4. Explicit phone labels: Phone: 9876543210, Mobile: 9876543210, Tel: 9876543210
PHONE_LABELED_PATTERN = re.compile(
    r"(?i)\b(?:phone|tel|telephone|mobile|cell|fax)\s*[:#-]?\s*(\+?[0-9\s().-]{7,18}\d)"
)

# Address label pattern: Address: 742 Evergreen Terrace, Springfield, OR 97477
ADDRESS_LABELED_PATTERN = re.compile(
    r"(?i)(\b(?:address|residence|location)\s*[:#-]\s*)([^\n]+)"
)

# Street Address Patterns:
# e.g., 123 Main Street, 452 Pine Valley Road, Suite 200, Apt 4B, 742 Evergreen Terrace
STREET_ADDRESS_PATTERN = re.compile(
    r"(?i)\b\d{1,6}\s+[A-Za-z0-9#.,\s-]{1,35}?\s+\b(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|Court|Ct|Parkway|Pkwy|Circle|Cir|Terrace|Ter|Place|Pl|Square|Sq|Trail|Trl|Highway|Hwy|Loop)\b(?:\s+(?:Suite|Ste|Apt|Apartment|Unit|Room|Rm|#)?\s*[A-Za-z0-9-]+)?",
)

# PO Box: PO Box 1234
PO_BOX_PATTERN = re.compile(
    r"(?i)\b(?:P\.?O\.?\s*Box)\s+\d+\b"
)

# Postal codes with state prefix: e.g., WA 98101, CA 94105, NY 10001-1234
US_STATE_ZIP_PATTERN = re.compile(
    r"\b(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\s+\d{5}(?:-\d{4})?\b"
)

# UK Postal codes: e.g., SW1A 1AA, EC1A 1BB, W1A 0AX
UK_POSTCODE_PATTERN = re.compile(
    r"\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b"
)


def anonymize_text(text: str) -> str:
    """
    Sanitize personal contact info (emails, phones, street addresses, postal codes)
    from resume text in-memory.

    Preserves GitHub URLs/handles, scoped package names, and technical keywords.
    """
    if not isinstance(text, str) or not text.strip():
        return text if isinstance(text, str) else ""

    # Phase 1: Shield technical tokens that must not be corrupted
    placeholders: dict[str, str] = {}
    counter = 0

    def stash(matched_str: str) -> str:
        nonlocal counter
        key = f"__PRESERVED_TOKEN_{counter}__"
        placeholders[key] = matched_str
        counter += 1
        return key

    sanitized = text

    # Protect scoped npm packages (e.g. @tanstack/react-query, @reduxjs/toolkit)
    def stash_scoped(m):
        full = m.group(0)
        token = m.group(1)
        stashed = stash(token)
        return full.replace(token, stashed)

    sanitized = SCOPED_PACKAGE_PATTERN.sub(stash_scoped, sanitized)

    # Protect technical URLs (e.g. https://github.com/torvalds, https://linkedin.com/in/...)
    # We protect the URL structure, but if it contains mailto:, we don't protect it
    def stash_url(m):
        url = m.group(0)
        if url.startswith("mailto:"):
            return url
        return stash(url)

    sanitized = URL_PROTECT_PATTERN.sub(stash_url, sanitized)

    # Phase 2: Redact Labeled Phones first to preserve context
    def redact_labeled_phone(m):
        return f"{m.group(0)[:m.start(1)-m.start(0)]}[PHONE_REDACTED]"

    sanitized = PHONE_LABELED_PATTERN.sub(redact_labeled_phone, sanitized)

    # Phase 3: Redact International & Delimited Phone Numbers
    sanitized = PHONE_INTL_PATTERN.sub("[PHONE_REDACTED]", sanitized)
    sanitized = PHONE_PAREN_PATTERN.sub("[PHONE_REDACTED]", sanitized)
    sanitized = PHONE_DELIMITED_PATTERN.sub("[PHONE_REDACTED]", sanitized)
    sanitized = PHONE_10DIGIT_MOBILE_PATTERN.sub("[PHONE_REDACTED]", sanitized)

    # Phase 4: Redact Emails
    sanitized = EMAIL_PATTERN.sub("[EMAIL_REDACTED]", sanitized)

    # Phase 5: Redact Physical Addresses & Postal Codes
    def redact_labeled_address(m):
        return f"{m.group(1)}[LOCATION_REDACTED]"

    sanitized = ADDRESS_LABELED_PATTERN.sub(redact_labeled_address, sanitized)
    sanitized = PO_BOX_PATTERN.sub("[LOCATION_REDACTED]", sanitized)
    sanitized = STREET_ADDRESS_PATTERN.sub("[LOCATION_REDACTED]", sanitized)
    sanitized = US_STATE_ZIP_PATTERN.sub("[LOCATION_REDACTED]", sanitized)
    sanitized = UK_POSTCODE_PATTERN.sub("[LOCATION_REDACTED]", sanitized)

    # Phase 6: Restore shielded technical tokens
    for token, original in placeholders.items():
        sanitized = sanitized.replace(token, original)

    return sanitized
