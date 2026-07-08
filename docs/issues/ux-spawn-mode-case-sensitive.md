# UX: --mode is case-sensitive (AUTO invalid)

## Summary

spawn --mode AUTO fails Invalid --mode "AUTO". Expected yolo, auto, edit, or read — case-sensitive; users typing AUTO fail.

## Evidence

Invalid --mode "AUTO". Expected yolo, auto, edit, or read.

## Why it matters

Case-insensitive enums are friendlier for CLI.

## Suggested direction

Accept case-insensitive mode; normalize to lower.

## Severity

Low–Medium

## Area

Spawn
