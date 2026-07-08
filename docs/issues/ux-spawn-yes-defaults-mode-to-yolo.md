# UX: spawn --yes defaults --mode to yolo

## Summary

spawn --help: --mode prompted; --yes uses yolo — CI --yes becomes full yolo permissions without explicit opt-in.

## Evidence

--mode <mode> Permission mode: yolo | auto | edit | read (prompted; --yes uses yolo)

## Why it matters

--yes should accept defaults safely; yolo as --yes default is high blast radius.

## Suggested direction

--yes default mode auto or read; require explicit --mode yolo for yolo.

## Severity

**Critical**

## Area

Spawn / safety
