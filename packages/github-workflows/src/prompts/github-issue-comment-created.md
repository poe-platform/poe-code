---
label: "GitHub: Issue Comment Handler"
allow:
  - OWNER
  - MEMBER
  - COLLABORATOR
prefix: "poe-code"
# Available variables:
#   {{url}}            - full GitHub URL to the issue
#   {{repo}}           - owner/repo (e.g. acme/my-app)
#   {{issue.number}}   - issue number
#   {{issue.title}}    - issue title
#   {{comment.author}} - login of the comment author
#   {{comment.body}}   - body text of the triggering comment
---
Read {{url}} and act on the comment from {{comment.author}}: {{comment.body}}
