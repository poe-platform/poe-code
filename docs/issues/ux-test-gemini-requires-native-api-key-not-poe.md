# UX: test gemini demands GEMINI_API_KEY not Poe credential

## Summary

test gemini fails: When using Gemini API, you must specify the GEMINI_API_KEY — does not use Poe auth after configure.

## Evidence

stderr: When using Gemini API, you must specify the GEMINI_API_KEY environment variable.

## Why it matters

Reconfirm gemini credential path not Poe-managed for health check.

## Suggested direction

Configure should inject Poe-backed key/env; test should use it.

## Severity

**High**

## Area

Test / gemini
