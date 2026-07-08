# UX: configure unknown provider error is clear (positive)

## Summary

configure --provider not-a-provider → Unknown provider "not-a-provider" without See logs — good ValidationError.

## Evidence

■  Error: Unknown provider "not-a-provider".

## Why it matters

Positive provider validation.

## Suggested direction

Keep; align provider login to drop See logs.

## Severity

Low

## Area

Configure / positive pattern
