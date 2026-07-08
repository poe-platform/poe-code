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
