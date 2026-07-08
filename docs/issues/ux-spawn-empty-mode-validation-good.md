# UX: spawn --mode "" validation is good (positive)

## Summary

spawn --mode "": Invalid --mode "". Expected yolo, auto, edit, or read — clear ValidationError.

## Evidence

Invalid --mode "". Expected yolo, auto, edit, or read.

## Why it matters

Positive empty mode rejection (contrast empty model accepted).

## Suggested direction

Keep; apply to empty --model on configure.

## Severity

Low

## Area

Spawn / positive pattern
