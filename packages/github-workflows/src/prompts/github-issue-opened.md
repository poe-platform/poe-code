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

- If the issue needs code changes, implement them, open or update a PR, and comment with the result.
- If the issue is a question or needs only guidance, post a concise comment that directly answers it. Be practical, give examples.
- If you cannot complete the request, comment with the blocker and the next concrete step.

{{response_style}}

{{verify_before_responding}}
