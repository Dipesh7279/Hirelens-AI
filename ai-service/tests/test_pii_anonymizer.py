"""
Unit tests for the server-side PII anonymizer and its integration with resume_structurer.
"""
from unittest.mock import patch
from app.services.pii_anonymizer import anonymize_text
from app.services.resume_structurer import structure_resume_with_mode


def test_redacts_single_and_multiple_emails():
    text = (
        "Contact me at candidate@gmail.com or alternatively at alt.email@yahoo.co.uk. "
        "Also reach out via direct mailto:work.contact-2026@domain.org for inquiries."
    )
    sanitized = anonymize_text(text)
    assert "candidate@gmail.com" not in sanitized
    assert "alt.email@yahoo.co.uk" not in sanitized
    assert "work.contact-2026@domain.org" not in sanitized
    assert sanitized.count("[EMAIL_REDACTED]") >= 2


def test_preserves_scoped_packages_and_github():
    text = (
        "Proficient with @tanstack/react-query, @reduxjs/toolkit, and @types/node. "
        "Code available at https://github.com/yyx990803 and github.com/torvalds. "
        "Running on Python 3.11 with FastAPI 0.115."
    )
    sanitized = anonymize_text(text)
    assert "@tanstack/react-query" in sanitized
    assert "@reduxjs/toolkit" in sanitized
    assert "@types/node" in sanitized
    assert "https://github.com/yyx990803" in sanitized
    assert "github.com/torvalds" in sanitized
    assert "Python 3.11" in sanitized
    assert "FastAPI 0.115" in sanitized


def test_redacts_phone_formats():
    text = (
        "Cell: +1-555-123-4567, Alternate: (555) 234-5678, Dotted: 555.345.6789. "
        "UK Office: +44 20 7946 0958, India Mobile: +91 98765 43210. "
        "Tel: 9876543210. Experience: 2020-2024 at Acme Corp."
    )
    sanitized = anonymize_text(text)
    assert "+1-555-123-4567" not in sanitized
    assert "(555) 234-5678" not in sanitized
    assert "555.345.6789" not in sanitized
    assert "+44 20 7946 0958" not in sanitized
    assert "+91 98765 43210" not in sanitized
    assert "9876543210" not in sanitized
    assert "[PHONE_REDACTED]" in sanitized
    # Years and date ranges must NOT be corrupted
    assert "2020-2024" in sanitized


def test_redacts_street_addresses_and_postal_codes():
    text = (
        "Living at 452 Pine Valley Road, Suite 200, Seattle, WA 98101. "
        "Previous address: 123 Main Street, Apt 4B, New York, NY 10001. "
        "Mailing: PO Box 789. London address near SW1A 1AA."
    )
    sanitized = anonymize_text(text)
    assert "452 Pine Valley Road" not in sanitized
    assert "123 Main Street" not in sanitized
    assert "PO Box 789" not in sanitized
    assert "WA 98101" not in sanitized
    assert "SW1A 1AA" not in sanitized
    assert "[LOCATION_REDACTED]" in sanitized


def test_resume_structurer_passes_sanitized_text_to_gemini():
    raw_resume = (
        "Alex Rivera\n"
        "Email: alex.rivera.work@example.com | Phone: +1 (555) 019-2834\n"
        "Address: 742 Evergreen Terrace, Springfield, OR 97477\n"
        "GitHub: https://github.com/alexrivera-dev\n\n"
        "Skills: React, TypeScript, Node.js, PostgreSQL, Docker\n"
        "Experience: Senior Engineer at Acme Tech (2021 - Present)\n"
        "Projects: Cloud Distributed Cache using Redis and Go"
    )

    mock_gemini_response = {
        "skills": ["React", "TypeScript", "Node.js", "PostgreSQL", "Docker", "Redis", "Go"],
        "education": [{"degree": "B.S. in Computer Science", "institute": "State University", "year": "2020"}],
        "experience": [{"role": "Senior Engineer", "company": "Acme Tech", "duration": "2021 - Present"}],
        "projects": [{"title": "Cloud Distributed Cache", "description": "High throughput cache", "techStack": ["Redis", "Go"]}],
        "githubUsername": "alexrivera-dev"
    }

    with patch("app.services.resume_structurer.call_gemini_json", return_value=mock_gemini_response) as mock_call:
        parsed, mode = structure_resume_with_mode(raw_resume)

        assert mode == "gemini"
        assert parsed.githubUsername == "alexrivera-dev"
        assert "React" in parsed.skills
        assert len(parsed.experience) == 1

        # Verify that call_gemini_json was called
        mock_call.assert_called_once()
        sent_system_prompt, sent_user_text = mock_call.call_args[0][:2]

        # Invariant checks on the prompt sent to Gemini:
        # Zero real personal contact info sent across the wire
        assert "alex.rivera.work@example.com" not in sent_user_text
        assert "+1 (555) 019-2834" not in sent_user_text
        assert "742 Evergreen Terrace" not in sent_user_text
        assert "OR 97477" not in sent_user_text

        # Redaction placeholders are present
        assert "[EMAIL_REDACTED]" in sent_user_text
        assert "[PHONE_REDACTED]" in sent_user_text
        assert "[LOCATION_REDACTED]" in sent_user_text

        # Technical context and skills are fully intact
        assert "React" in sent_user_text
        assert "TypeScript" in sent_user_text
        assert "alexrivera-dev" in sent_user_text or "github.com/alexrivera-dev" in sent_user_text

