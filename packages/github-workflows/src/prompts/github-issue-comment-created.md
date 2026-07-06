---
label: "GitHub: Issue Comment Handler"
allow:
  - OWNER
  - MEMBER
  - COLLABORATOR
prefix:
  - "poe-code"
  - "poe-code-agent"
  - "@poe-code-agent"
---

Read {{url}} and leave a visible GitHub response to the comment from {{comment.author}}: {{comment.body}}

- If the comment asks for code changes, open or update a PR and comment with the result.
- Before starting new work, check for existing open PRs by the agent that relate to this issue. If any exist and need updating based on the new instructions, update them instead of opening a new PR.
- If blocked, comment with the blocker and next step.
- When posting any multiline GitHub comment or PR body, write it with a quoted heredoc and pass it to `gh` with `--body-file` instead of an inline `--body` string.

{{skill_github_cli}}

{{pull_request_guidelines}}

{{response_style}}

{{verify_before_responding}}
