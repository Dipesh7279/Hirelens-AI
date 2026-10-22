"""
EEOC & Title VII Protected-Class Discriminatory Question Interceptor.
Programmatically intercepts inquiries relating to age, marital/family status,
disabilities/health, religion, and national origin in candidate interview generation.
"""
import re
from typing import Tuple, List, Optional
from app.models.interview_schema import InterviewQuestion

# Pre-compiled EEOC prohibited inquiry regex patterns
EEOC_PATTERNS = {
    "age_inquiry": re.compile(
        r"(?i)\b(?:graduat(?:ed|ion)\s+year|high\s+school\s+year|date\s+of\s+birth|when\s+were\s+you\s+born|retirement\s+plans?|how\s+old\s+are\s+you)\b"
    ),
    "family_marital_inquiry": re.compile(
        r"(?i)\b(?:children|kids|childcare|pregnancy|pregnant|spouse|husband|wife|marital\s+status|maiden\s+name|family\s+plans?|plan(?:ning)?\s+to\s+have\s+(?:a\s+)?family)\b"
    ),
    "disability_health_inquiry": re.compile(
        r"(?i)\b(?:disabilit(?:y|ies)|physical\s+impairments?|medical\s+history|sick\s+leave|psychiatric|mental\s+health|workers['’]?\s*compensation|health\s+conditions?|chronic\s+illness(?:es)?)\b"
    ),
    "religion_creed_inquiry": re.compile(
        r"(?i)\b(?:religious\s+holidays?|sabbath|church|mosque|synagogue|place\s+of\s+worship|creed|religious\s+beliefs?)\b"
    ),
    "national_origin_inquiry": re.compile(
        r"(?i)\b(?:native\s+language|mother\s+tongue|citizenship\s+history|ancestral\s+origin|country\s+of\s+birth|where\s+are\s+you\s+originally\s+from|what\s+is\s+your\s+nationality)\b"
    ),
    "gender_ethnicity_inquiry": re.compile(
        r"(?i)\b(?:gender\s+identity|sexual\s+orientation|racial\s+background|ethnic\s+background|what\s+is\s+your\s+(?:gender|sex|race|ethnicity))\b"
    ),
}


def check_eeoc_compliance(question_text: str) -> Tuple[bool, Optional[str]]:
    """
    Check if a question text contains prohibited protected-class inquiries.
    Returns (is_compliant, violation_category).
    """
    if not isinstance(question_text, str) or not question_text.strip():
        return True, None

    for category, pattern in EEOC_PATTERNS.items():
        if pattern.search(question_text):
            return False, category

    return True, None


def sanitize_interview_questions(
    questions: List[InterviewQuestion],
    verified_skills: List[str],
    project_titles: Optional[List[str]] = None,
) -> List[InterviewQuestion]:
    """
    Scans a list of generated interview questions against EEOC compliance.
    Any violating question is replaced with a certified, neutral technical, project, or behavioral question.
    """
    certified_questions: List[InterviewQuestion] = []
    skills = [s.strip() for s in (verified_skills or []) if isinstance(s, str) and s.strip()]
    projects = [p.strip() for p in (project_titles or []) if isinstance(p, str) and p.strip()]

    tech_templates = [
        (
            "In your work with {skill}, how do you ensure code quality, maintainability, and test coverage?",
            "Hands-on {skill} design patterns, maintainability, and testing strategy",
        ),
        (
            "How do you diagnose performance bottlenecks and handle production errors when building with {skill}?",
            "Production debugging, observability, and performance trade-offs in {skill}",
        ),
        (
            "What architectural trade-offs do you consider when designing modular systems with {skill}?",
            "System boundaries, interface design, and scalability in {skill}",
        ),
    ]
    project_templates = [
        (
            "Can you walk through the technical architecture of {target} and the key trade-offs you made?",
            "Architectural decision-making, module boundaries, and technical execution in {target}",
        ),
        (
            "How did you validate reliability, edge cases, and maintainability while building {target}?",
            "Testing strategy, failure handling, and iterative improvements in {target}",
        ),
    ]

    for idx, q in enumerate(questions):
        is_compliant_q, _ = check_eeoc_compliance(q.question)
        is_compliant_focus, _ = check_eeoc_compliance(q.expectedFocus)
        if is_compliant_q and is_compliant_focus:
            certified_questions.append(q)
        else:
            skill = skills[idx % len(skills)] if skills else "software engineering"
            if q.type == "technical":
                tmpl_q, tmpl_f = tech_templates[idx % len(tech_templates)]
                replacement_text = tmpl_q.format(skill=skill)
                replacement_focus = tmpl_f.format(skill=skill)
            elif q.type == "project":
                if projects:
                    proj = projects[idx % len(projects)]
                    tmpl_q, tmpl_f = project_templates[idx % len(project_templates)]
                    replacement_text = tmpl_q.format(target=proj)
                    replacement_focus = tmpl_f.format(target=proj)
                else:
                    replacement_text = f"Can you walk through the technical architecture of a project where you applied {skill} in production?"
                    replacement_focus = f"Architectural decision-making and technical execution with {skill}"
            else:
                replacement_text = "Describe a situation where you had to adapt quickly to changing technical requirements or ambiguous specifications."
                replacement_focus = "Adaptability, structured problem-solving, and communication under ambiguity"

            certified_questions.append(
                InterviewQuestion(
                    type=q.type,
                    question=replacement_text,
                    expectedFocus=replacement_focus,
                )
            )

    return certified_questions
