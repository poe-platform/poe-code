# UX: auth api-key help still no danger warning (reconfirmed)

## Summary

auth api-key --help still only Display stored API key with -h — reconfirm no secret warning.

## Evidence

auth api-key help: Display stored API key. Options: -h only.

## Why it matters

Reconfirm Critical secret reveal lacks help warning.

## Suggested direction

Warn in description; default mask + --reveal.

## Severity

**High**

## Area

Auth / security
