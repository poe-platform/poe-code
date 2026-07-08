# UX: tasks GitHub 401 still dumps raw GraphQL JSON (reconfirmed)

## Summary

tasks get/next without valid GitHub auth dump [error] GitHub GraphQL request failed with status 401: { json } — reconfirm of tasks-github-auth-raw-error.

## Evidence

```bash
$ poe-code tasks get 123
■  [error] GitHub GraphQL request failed with status 401: { "message": "Bad credentials", … }
```

## Why it matters

Unusable recovery; secrets-adjacent noise.

## Suggested direction

UserError: GitHub auth required. Run gh auth login or set GITHUB_TOKEN.

## Severity

**High**

## Area

Tasks
