---
label: "GitHub: Pull Request Comment Handler"
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

- This comment is on pull request #{{pr.number}}.
- Implement changes on the current PR branch, update the existing PR, and comment with the result.
- Do not open a new PR unless updating the existing PR is impossible.
- If blocked, comment with the blocker and next step.
- When posting any multiline GitHub comment or PR body, write it with a quoted heredoc and pass it to `gh` with `--body-file` instead of an inline `--body` string.

{{skill_github_cli}}

{{pull_request_guidelines}}

{{response_style}}

{{verify_before_responding}}
