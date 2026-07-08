# UX: tasks get bad auth dumps raw GitHub 401 JSON (reconfirmed)

## Summary

tasks get missing --yes: GitHub GraphQL 401 Bad credentials raw JSON — reconfirm GitHub auth UX class.

## Evidence

GitHub GraphQL request failed with status 401: { "message": "Bad credentials" }

## Why it matters

Reconfirm UserError: gh auth login.

## Suggested direction

UserError without raw JSON.

## Severity

**High**

## Area

Tasks / GitHub
