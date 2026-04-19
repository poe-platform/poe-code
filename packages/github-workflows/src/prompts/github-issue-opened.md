---
label: "GitHub: Issue Handler"
allow:
  - OWNER
  - MEMBER
  - COLLABORATOR
---
Read {{url}} and leave a visible GitHub response.

- First assess if the issue is actionable: it must have a title that conveys intent AND a body with enough detail to understand the request. Empty bodies, one-word titles that are not a real product name, and gibberish do not qualify.
- If the issue is not actionable, post a short comment explaining what's missing (e.g. "Closing: the body is empty and the title alone doesn't describe a reproducible issue. Please reopen with steps to reproduce or a clear feature request.") and close the issue with `gh issue close`. Do not apply labels.
- If the issue is actionable and needs code changes, implement them, open or update a PR, and comment with the result.
- If blocked, comment with the blocker and next step.
- When posting any multiline GitHub comment or PR body, write it with a quoted heredoc and pass it to `gh` with `--body-file` instead of an inline `--body` string.

{{skill_github_cli}}

{{pull_request_guidelines}}

{{response_style}}

{{verify_before_responding}}
