# UX: models invalid --endpoint prints ValidationError stack

## Summary

models --endpoint /v1/bogus: good message listing available endpoints, but also ERROR log line + full stack trace to stderr.

## Evidence

Unsupported endpoint … Available endpoints: …
Stack trace: ValidationError at models.ts…

## Why it matters

Validation should not dump stacks.

## Suggested direction

UserError without stack; keep available endpoints list.

## Severity

**High**

## Area

Models
