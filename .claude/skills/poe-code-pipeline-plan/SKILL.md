---
name: poe-code-pipeline-plan
description: "Generate a Pipeline plan markdown file with YAML frontmatter from a user request. Triggers on: create a pipeline plan, write plan for, plan this feature, pipeline plan."
---

# Pipeline plan

Write the plan as YAML frontmatter. Each task's `prompt` must be self-contained; do not rely on the markdown body or earlier tasks at runtime.

## Where to write (first match wins)

1. Request mentions an `.md` file: edit it in place.
2. A file in the plan directory matches the topic (filename stem or `# heading`): overwrite it, regardless of its `kind:`. One file per topic.
3. Otherwise: create `<plan-directory>/<name>.md`.

## Steps

Read the first `steps.yaml` found at `<project-root>/.poe-code/pipeline/steps.yaml` then `~/.poe-code/pipeline/steps.yaml`.

- Without one: stepless tasks, scalar `status: open`.
- With one: per task, use judgement to pick only the configured steps that genuinely apply (e.g. a docs-only task probably doesn't need `test`; a config bump may not need its own `commit` step). Set every step you include to `open`. `setup`/`teardown` are inherited; set `setup: false` to disable or define a full block to override.

## Format

```markdown
---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
readiness: draft

tasks:
  - id: validate-signup-input
    title: Validate signup request body
    prompt: |
      In src/api/signup.ts, validate the request body before the handler
      runs. Reject when email is missing, malformed, or > 254 chars, or
      password is < 8 chars. Return 400 with a JSON `{ code }` on reject.
    status:
      implement: open
      test: open

  - id: rate-limit-signup
    title: Rate-limit signup to 5/hour per IP
    prompt: |
      Add a 5/hour-per-IP limit to src/api/signup.ts using the existing
      limiter in src/middleware/rate-limit.ts. On exceed return 429 with
      a Retry-After header.
    status:
      implement: open
      test: open

  - id: audit-failed-signups
    title: Log failed signups to the audit log
    prompt: |
      When signup fails validation or rate limiting, write {ip, ts, reason}
      via src/audit/logger.ts. Never log the password attempt.
    status:
      implement: open
      test: open

  - id: document-signup-limits
    title: Document signup validation and rate limits
    prompt: |
      Add a "Signup limits" section to docs/api/signup.md covering email
      length, password length, and the 5/hour-per-IP rate limit.
    status:
      implement: open
---

# Context

Design notes or acceptance criteria.
```

Stepless variant: when no `steps.yaml` is present, `status` is a scalar instead of a per-step map:

```yaml
tasks:
  - id: bump-node-version
    title: Bump Node engine to 20
    prompt: |
      Update `engines.node` in package.json to `>=20`. Update the same
      pin in .nvmrc and the Node version in .github/workflows/ci.yml.
    status: open

  - id: drop-deprecated-flag
    title: Remove the deprecated --legacy-render flag
    prompt: |
      In src/cli/render.ts remove the `--legacy-render` flag and any
      branches that read it. The flag has been a no-op since v3.2.
    status: open
```

Validate with `poe-code pipeline validate <path>` or `npx poe-code ...`.
