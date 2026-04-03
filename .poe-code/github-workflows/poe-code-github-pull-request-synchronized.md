---
# Installed by: poe-code github-workflows install github-pull-request-synchronized
# Edit this file to customize the automation prompt and configuration.
label: "GitHub: Pull Request Update Handler"
# Available variables:
#   {{url}}       - full GitHub URL to the pull request
#   {{repo}}      - owner/repo (e.g. acme/my-app)
#   {{pr.number}} - pull request number
---
Read {{url}} and re-review the updated pull request.
