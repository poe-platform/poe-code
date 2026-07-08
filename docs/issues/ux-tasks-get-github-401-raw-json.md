# UX: tasks get with bad GitHub auth dumps raw 401 JSON

## Summary

tasks get missing-id fails with raw GitHub GraphQL 401 JSON Bad credentials — unframed auth error.

## Evidence

```bash
$ poe-code tasks get missing-id
■  [error] GitHub GraphQL request failed with status 401: { "message": "Bad credentials", …}
```

## Why it matters

Users need gh auth login next step not raw GraphQL.

## Suggested direction

UserError: GitHub auth failed. Run gh auth login; no raw JSON.

## Severity

**High**

## Area

Tasks / GitHub
