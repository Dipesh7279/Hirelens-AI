"""Conservative, free fallback parser used when the optional Gemini API is unavailable."""
import re
from app.models.resume_schema import Education, Experience, Project, ResumeParsed
from app.services.resume_extractor import extract_github_username

SKILLS = (
    "python", "javascript", "typescript", "java", "c++", "c#", "go", "rust", "sql",
    "html", "css", "react", "node.js", "express", "fastapi", "django", "flask",
    "mongodb", "postgresql", "mysql", "redis", "aws", "azure", "gcp", "docker",
    "kubernetes", "git", "linux", "machine learning", "pytorch", "tensorflow",
    "scikit-learn", "pandas", "numpy", "leadership", "communication", "project management",
)

_SECTION_HEADINGS = {
    "summary": re.compile(r"^(?:professional\s+summary|summary|profile|objective)\s*:?\s*$", re.I),
    "skills": re.compile(r"^(?:technical\s+skills|skills|core\s+competencies|technologies)\s*:?\s*$", re.I),
    "projects": re.compile(r"^(?:projects|academic\s+projects|personal\s+projects|key\s+projects)\s*:?\s*$", re.I),
    "experience": re.compile(r"^(?:experience|work\s+experience|professional\s+experience|employment|internships?)\s*:?\s*$", re.I),
    "education": re.compile(r"^(?:education|academic\s+background|qualifications)\s*:?\s*$", re.I),
    "other": re.compile(r"^(?:certifications?(?:\s*&\s*achievements?)?|achievements?|awards?|publications?|languages|interests)\s*:?\s*$", re.I),
}

_DATE_RANGE_RE = re.compile(
    r"((?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+)?(?:19|20)\d{2}\s*(?:[-–—\ufffd]|to)\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+)?(?:(?:19|20)\d{2}|Present|Current)|(19|20)\d{2})",
    re.I,
)


def _split_sections(raw_text: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current = "header"
    for raw_line in raw_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        matched_section = None
        for sec_name, pattern in _SECTION_HEADINGS.items():
            if pattern.match(line):
                matched_section = sec_name
                break
        if matched_section:
            current = matched_section
            sections.setdefault(current, [])
            continue
        sections.setdefault(current, []).append(line)
    return sections


def _parse_skills_section(lines: list[str], base_skills: list[str]) -> list[str]:
    seen = {s.lower() for s in base_skills}
    result = list(base_skills)
    for line in lines:
        content = line.split(":", 1)[1] if ":" in line else line
        for token in re.split(r"[,;|•·]", content):
            item = token.strip().strip("-–—*")
            if 1 < len(item) <= 50 and item.lower() not in seen:
                seen.add(item.lower())
                result.append(item)
    return result


def _parse_education_section(lines: list[str]) -> list[Education]:
    entries: list[Education] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        year_match = _DATE_RANGE_RE.search(line)
        year = year_match.group(0).strip().replace("\ufffd", "–") if year_match else ""
        deg_part = line[:year_match.start()].strip(" \t|,-–—") if year_match else line
        institute = ""
        if i + 1 < len(lines) and not _DATE_RANGE_RE.search(lines[i + 1]):
            next_line = lines[i + 1]
            institute = next_line.split("|")[0].strip()
            if not year:
                ym2 = _DATE_RANGE_RE.search(next_line)
                if ym2:
                    year = ym2.group(0).strip().replace("\ufffd", "–")
            i += 2
        else:
            if "—" in deg_part or " - " in deg_part or "|" in deg_part:
                parts = [p.strip() for p in re.split(r"\||—|\s-\s", deg_part) if p.strip()]
                if len(parts) >= 2:
                    deg_part, institute = parts[0], parts[1]
            i += 1
        if deg_part:
            entries.append(Education(degree=deg_part, institute=institute, year=year))
    return entries


def _parse_experience_section(lines: list[str]) -> list[Experience]:
    entries: list[Experience] = []
    current_role = ""
    current_company = ""
    current_duration = ""

    for line in lines:
        date_match = _DATE_RANGE_RE.search(line)
        is_header = ("\t" in line or "|" in line or "—" in line) or (
            date_match is not None and not line.endswith(".")
        )
        if is_header and date_match:
            if current_role or current_company:
                entries.append(Experience(role=current_role, company=current_company, duration=current_duration))
            current_duration = date_match.group(0).strip().replace("\ufffd", "–")
            head = line[:date_match.start()].strip(" \t|,-–—")
            if "," in head:
                parts = [p.strip() for p in head.split(",") if p.strip()]
                current_role = parts[0]
                current_company = ", ".join(parts[1:])
            elif "—" in head or " - " in head or "|" in head:
                parts = [p.strip() for p in re.split(r"\||—|\s-\s", head) if p.strip()]
                current_role = parts[0]
                current_company = parts[1] if len(parts) > 1 else ""
            else:
                current_role = head
                current_company = ""
    if current_role or current_company:
        entries.append(Experience(role=current_role, company=current_company, duration=current_duration))
    return entries


def _parse_projects_section(lines: list[str]) -> list[Project]:
    projects: list[Project] = []
    current_title = ""
    current_stack: list[str] = []
    current_desc: list[str] = []

    for line in lines:
        # Project header typically has a parenthesized tech stack, tab+year, or pipe separator, and doesn't end with a period
        paren_match = re.match(r"^([^()]{2,80}?)\s*\(([^)]+)\)\s*(?:[\t|—-]?\s*(?:19|20)\d{2})?$", line)
        pipe_match = not line.endswith(".") and ("\t" in line or " | " in line or " — " in line) and len(line) < 110
        if paren_match:
            if current_title:
                projects.append(Project(title=current_title, description=" ".join(current_desc).strip(), techStack=current_stack))
            current_title = paren_match.group(1).strip(" \t|,-–—")
            current_stack = [s.strip() for s in paren_match.group(2).split(",") if s.strip()]
            current_desc = []
        elif pipe_match:
            if current_title:
                projects.append(Project(title=current_title, description=" ".join(current_desc).strip(), techStack=current_stack))
            parts = [p.strip() for p in re.split(r"\t|\s\|\s|\s—\s", line) if p.strip()]
            current_title = parts[0]
            current_stack = [
                s for s in SKILLS if re.search(rf"(?<![\w+#.]){re.escape(s)}(?![\w+#.])", line.casefold())
            ]
            current_desc = []
        else:
            if current_title:
                current_desc.append(line.lstrip("•-*–— "))
    if current_title:
        projects.append(Project(title=current_title, description=" ".join(current_desc).strip(), techStack=current_stack))
    return projects


def parse_resume_fallback(raw_text: str) -> ResumeParsed:
    """Extract known skill mentions and deterministically parse standard resume sections when present."""
    normalized = re.sub(r"\s+", " ", raw_text).casefold()
    found = [skill for skill in SKILLS if re.search(rf"(?<![\w+#.]){re.escape(skill)}(?![\w+#.])", normalized)]

    sections = _split_sections(raw_text)
    has_structured_sections = any(k in sections for k in ("skills", "education", "experience", "projects"))
    if not has_structured_sections:
        return ResumeParsed(skills=found, githubUsername=extract_github_username(raw_text))

    skills = _parse_skills_section(sections.get("skills", []), found) if "skills" in sections else found
    education = _parse_education_section(sections.get("education", []))
    experience = _parse_experience_section(sections.get("experience", []))
    projects = _parse_projects_section(sections.get("projects", []))

    return ResumeParsed(
        skills=skills,
        education=education,
        experience=experience,
        projects=projects,
        githubUsername=extract_github_username(raw_text),
    )

