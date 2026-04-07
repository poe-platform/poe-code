---
label: "GitHub: Issue Handler"
# Available variables:
#   {{url}}          - full GitHub URL to the issue
#   {{repo}}         - owner/repo (e.g. acme/my-app)
#   {{issue.number}} - issue number
#   {{issue.title}}  - issue title
#   {{issue.body}}   - issue body
---
Read {{url}} and leave a visible GitHub response.

- If the issue is a question or needs only guidance, post a concise comment that directly answers it.
- If the issue needs code changes, implement them, open or update a PR, and comment with the result.
- If you cannot complete the request, comment with the blocker and the next concrete step.

- Start with a direct answer or decision.
- Keep it concise.
- Use short Markdown sections only when they improve clarity.

Before answering:

- Inspect the checked-out repository
- Verify every claim against the repo before you post it.
