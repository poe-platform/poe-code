# UX: spawn --stdin from pipe works (positive)

## Summary

echo "say only: ok" | spawn claude --mode read --model haiku --stdin succeeds.

## Evidence

pipe + --stdin → ✓ agent: ok

## Why it matters

Positive stdin prompt form.

## Suggested direction

Keep; document in Examples.

## Severity

Low

## Area

Spawn / positive pattern
