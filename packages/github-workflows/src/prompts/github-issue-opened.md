---
label: "GitHub: Issue Handler"
allow:
  - OWNER
  - MEMBER
  - COLLABORATOR
  - CONTRIBUTOR
---

Read {{url}} and leave a visible GitHub response.

- Treat every newly opened issue as something that deserves a response. Use the title, body, attachments, and comments when deciding what to do.
- If the issue does not include enough detail to make a code change, leave a short comment to ask for the missing details. Do not close the issue.
- If the issue needs code changes, implement them, open or update a PR, and comment with the result.
- If blocked, comment with the blocker and next step.
- When posting any multiline GitHub comment or PR body, write it with a quoted heredoc and pass it to `gh` with `--body-file` instead of an inline `--body` string.

{{skill_github_cli}}

{{pull_request_guidelines}}

{{response_style}}

{{verify_before_responding}}
