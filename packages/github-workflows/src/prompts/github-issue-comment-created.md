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
# Available variables:
#   {{url}}            - full GitHub URL to the issue
#   {{repo}}           - owner/repo (e.g. acme/my-app)
#   {{issue.number}}   - issue number
#   {{issue.title}}    - issue title
#   {{comment.author}} - login of the comment author
#   {{comment.body}}   - body text of the triggering comment
---
Read {{url}} and leave a visible GitHub response to the comment from {{comment.author}}: {{comment.body}}

{{#pr.number}}
- This comment is on pull request #{{pr.number}}.
- If the comment asks for code changes or follow-up implementation, implement them on the current PR branch, update the existing PR, and comment with the result.
- Do not open a new PR from a pull request comment unless updating the existing PR is impossible.
{{/pr.number}}
{{^pr.number}}
- If the comment asks for code changes or follow-up implementation, make the changes, open or update a PR, and comment with the result.
{{/pr.number}}
- If the comment only needs guidance or clarification, reply directly and concisely.
- If you cannot complete the request, comment with the blocker and the next concrete step.

{{response_style}}

{{verify_before_responding}}
