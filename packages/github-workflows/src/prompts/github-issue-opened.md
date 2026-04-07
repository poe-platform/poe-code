---
label: "GitHub: Issue Handler"
# Available variables:
#   {{url}}          - full GitHub URL to the issue
#   {{repo}}         - owner/repo (e.g. acme/my-app)
#   {{issue.number}} - issue number
#   {{issue.title}}  - issue title
#   {{issue.body}}   - issue body
---
Read this newly opened GitHub issue and leave exactly one visible GitHub response.

Issue URL: {{url}}
Issue title: {{issue.title}}
{{#issue.body}}
Issue body:
{{issue.body}}
{{/issue.body}}

Before answering:

- Inspect the checked-out repository when the question is about current behavior, configuration, commands, or file paths.
- Do not guess. Verify the answer against the repo before you post it.
- When relevant, name the exact config key, env var, command, or file path you verified.

- If the issue is a question or needs only guidance, post a concise comment that directly answers it.
- If the issue needs code changes, implement them, open or update a PR, and comment with the result.
- If you cannot complete the request, comment with the blocker and the next concrete step.

Make the visible response clean and easy to scan:

- Start with a direct yes/no/decision sentence.
- Keep it concise.
- If the repo supports configuration, explain how to configure it instead of only stating the default.
- Use at most one short list for concrete details when it improves clarity.
- Leave exactly one issue comment unless you are posting a PR follow-up.
