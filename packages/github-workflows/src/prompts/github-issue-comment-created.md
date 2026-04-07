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

{{#pr.number}}
- This comment is on pull request #{{pr.number}}.
- If the comment asks for code changes, implement them on the current PR branch, update the existing PR, and comment with the result.
- Do not open a new PR unless updating the existing PR is impossible.
{{/pr.number}}
{{^pr.number}}
- If the comment asks for code changes, open or update a PR and comment with the result.
{{/pr.number}}
- If blocked, comment with the blocker and next step.

{{skill_github_cli}}

{{pull_request_guidelines}}

{{response_style}}

{{verify_before_responding}}
