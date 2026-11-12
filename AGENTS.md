# Repository Agent Instructions

## Git Commit Conventions

For all future work in this repository, follow these rules unless the user explicitly requests otherwise.

### Commit automatically

- After completing an authorized, bounded implementation task, running the relevant validation, and reviewing the final diff, create a local Git commit automatically.
- This authorization applies only to completed implementation tasks whose relevant validation passes. It does not apply to read-only reviews or research; do not create commits for those activities alone.
- Do not ask for additional confirmation merely to create a local commit.
- Never automatically push, merge, create a release, or deploy.
- Do not commit when tests fail unexpectedly, changes are outside the authorized scope, or ownership of existing modifications is unclear.
- Do not reset, discard, or overwrite unrelated user changes.
- Stage only task-related files. Exclude secrets, private documents, temporary reports, generated artifacts, screenshots, and personal Obsidian notes.

### Commit message format

Use Conventional Commits:

`type(scope): concise description`

Allowed types:

- `feat`: new behavior
- `fix`: bug correction
- `style`: visual or formatting changes without behavioral changes
- `refactor`: internal restructuring
- `test`: test coverage or test infrastructure
- `docs`: documentation
- `chore`: maintenance or tooling
- `perf`: performance improvements

Rules:

- Write commit subjects in English.
- Use a clear imperative description.
- Keep the subject within 72 characters when practical.
- Prefer describing the actual change over the task or project-management phase.
- Never include milestone identifiers such as M1, M1.1, M1.2, Phase 1, Sprint or milestone numbers in the commit subject.
- Do not use generic messages such as "update files", "finish task", or "complete milestone".
- Add a short commit body only when it explains a meaningful design trade-off, compatibility requirement, or known limitation.
- Do not add generated commit trailers or Co-authored-by lines unless explicitly required.

### Final response format

After committing, report only:

- What changed (1–3 concise points)
- Validation result
- Commit short SHA and commit subject
- Remaining risks or blockers, if any

Do not include milestone identifiers in the final summary headings or commit subjects unless the user explicitly requests them.

Detailed evidence should remain in test logs or a handoff report when the task requires one.

### Safety boundary

Local commit permission does not grant permission to:

- Push to remote repositories
- Merge branches
- Deploy
- Change production infrastructure
- Modify private content outside the task scope
