from functools import lru_cache


class SkillMatcherUnavailable(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _load_model():
    try:
        from sentence_transformers import SentenceTransformer 
        from sklearn.metrics.pairwise import cosine_similarity
        return SentenceTransformer("all-MiniLM-L6-v2"), cosine_similarity
    except Exception:
        try:
            from sklearn.feature_extraction.text import TfidfVectorizer
            from sklearn.metrics.pairwise import cosine_similarity

            class _FallbackSkillModel:
                def encode(self, skills):
                    return skills

            def _fallback_similarity(resume_skills, github_skills):
                vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4))
                all_text = list(resume_skills) + list(github_skills)
                mat = vec.fit_transform(all_text)
                r_mat = mat[: len(resume_skills)]
                g_mat = mat[len(resume_skills) :]
                return cosine_similarity(r_mat, g_mat)

            return _FallbackSkillModel(), _fallback_similarity
        except ImportError as e:
            raise SkillMatcherUnavailable(
                "Semantic skill matching dependencies are missing. "
                "Install the AI service requirements."
            ) from e


def match_skills(
    resume_skills,
    github_skills
):

    if not resume_skills:
        return {
            "score": 0,
            "matches": []
        }

    if not github_skills:
        return {
            "score": 0,
            "matches": []
        }

    model, cosine_similarity = _load_model()
    resume_vectors = model.encode(resume_skills)
    github_vectors = model.encode(github_skills)
    all_similarities = cosine_similarity(resume_vectors, github_vectors)
    matches = []

    for resume_skill, similarities in zip(resume_skills, all_similarities):
        best_index = similarities.argmax()
        best_skill = github_skills[best_index]
        similarity = similarities[best_index]

        matches.append({
            "resumeSkill": resume_skill,
            "githubSkill": best_skill,
            "similarity": round(
                float(similarity) * 100,
                2
            ),
        })

    score = sum(
        item["similarity"]
        for item in matches
    ) / len(matches)

    return {
        "score": round(score, 2),
        "matches": matches
    }