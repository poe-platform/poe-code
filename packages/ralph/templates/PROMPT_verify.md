# Verify

You are an autonomous coding agent. Your task is to verify that a requirement is satisfied by the current implementation and fix any gaps.

## Paths

- Plan: {{PLAN_PATH}}
- Progress Log: {{PROGRESS_PATH}}
- Guardrails: {{GUARDRAILS_PATH}}
- Guardrails Reference: {{GUARDRAILS_REF}}
- Context Reference: {{CONTEXT_REF}}
- Errors Log: {{ERRORS_LOG_PATH}}
- Activity Log: {{ACTIVITY_LOG_PATH}}
- Activity Logger: {{ACTIVITY_CMD}}
- Commit: {{COMMIT}}
- Repo Root: {{REPO_ROOT}}
- Run ID: {{RUN_ID}}
- Iteration: {{ITERATION}}
- Run Log: {{RUN_LOG_PATH}}
- Run Summary: {{RUN_META_PATH}}

## Global Quality Gates (apply to every verification)

{{QUALITY_GATES}}

## Requirement to Verify

ID: {{REQUIREMENT_ID}}
Title: {{REQUIREMENT_TITLE}}

{{REQUIREMENT_BLOCK}}

If the requirement details are empty or missing, STOP and report that the plan requirement format could not be parsed.

## Rules (Non-Negotiable)

- Verify **only** the requirement listed above.
- For EACH scenario, confirm the implementation satisfies it.
- If a scenario is NOT satisfied, fix the implementation.
- Do NOT ask the user questions.
- Do NOT change unrelated code.
- Do NOT assume something is unimplemented — confirm by reading code.
- If No-commit is true, do NOT commit or push changes.
- Do NOT edit the plan file (status is handled by the loop).
- All changes in git made during the run must be committed.
- Do NOT commit the progress log ({{PROGRESS_PATH}}). It is gitignored.
- Before committing, perform a final **security**, **performance**, and **regression** review of your changes.

## Your Task (Do this in order)

1. Read {{GUARDRAILS_PATH}} before any code changes.
2. Read {{ERRORS_LOG_PATH}} for repeated failures to avoid.
3. Read {{PLAN_PATH}} for global context (do not edit).
4. For EACH scenario in the requirement:
   a. Read the relevant source code and tests.
   b. Verify the scenario is satisfied (run tests, inspect behavior).
   c. If NOT satisfied, implement the fix.
5. Run verification commands and the global quality gates.
6. If the project has a build or dev workflow, run what applies:
   - Build step (e.g., `npm run build`) if defined.
   - Test step (e.g., `npm run test`) if defined.
   - Confirm no runtime/build errors in the console.
7. Perform a brief audit before committing:
   - **Security:** check for obvious vulnerabilities or unsafe handling introduced by your changes.
   - **Performance:** check for avoidable regressions.
   - **Regression:** verify existing behavior that could be impacted still works.
8. If No-commit is false and changes were made, commit changes.
   - Follow the project's commit guidelines.
   - Stage only project files you changed.
   - After committing, capture the commit hash and subject using:
     `git show -s --format="%h %s" HEAD`.
9. Append a progress entry to {{PROGRESS_PATH}} with verification details (format below).
   Do NOT commit this file.

## Progress Entry Format (Append Only)

```
## [Date/Time] - Verify {{REQUIREMENT_ID}}: {{REQUIREMENT_TITLE}}
Run: {{RUN_ID}} (iteration {{ITERATION}})
Run log: {{RUN_LOG_PATH}}
Run summary: {{RUN_META_PATH}}
- Guardrails reviewed: yes
- Commit: {{COMMIT}}
- Commit: <hash> <subject> (or `none` + reason)
- Scenarios verified:
  - <scenario name>: PASS/FAIL
  - <scenario name>: PASS/FAIL
- Fixes applied:
  - <description> (or `none`)
- Verification:
  - Command: <exact command> -> PASS/FAIL
- Files changed:
  - <file path> (or `none`)
---
```

## Completion Signal

Only output the completion signal when ALL scenarios for the requirement are verified and passing.
When the requirement is fully verified, output:
<promise>COMPLETE</promise>

Otherwise, end normally without the signal.

## Activity Logging (Required)

Log major actions to {{ACTIVITY_LOG_PATH}} using the CLI command:

```
{{ACTIVITY_CMD}} "message"
```

Log at least:

- Start of verification for the requirement
- Each scenario check result
- After any fixes and re-verification
