---
severity: high
impact: usability
comment: "Fourth filing within the tasks GitHub 401 cluster (next instead of get); retire into ux-tasks-get-github-401-raw-json.md. Coverage only - though it does confirm the failure is in the shared GitHub client rather than one subcommand, which supports fixing it there."
---

# UX: tasks next with bad auth dumps raw GitHub 401 JSON

## Summary

tasks next some-id --yes fails with raw GraphQL 401 Bad credentials — unframed auth error.

## Evidence

GitHub GraphQL request failed with status 401: { "message": "Bad credentials" }

## Why it matters

Users need gh auth login next step.

## Suggested direction

UserError: GitHub auth failed. Run gh auth login.

## Severity

**High**

## Area

Tasks / GitHub
