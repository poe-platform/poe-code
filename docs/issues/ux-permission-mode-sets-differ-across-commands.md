# UX: Permission mode choice sets differ across spawn/gaslight/harness/gh

## Summary

spawn: yolo|auto|edit|read; gaslight: read|edit|yolo|auto with default auto; harness: read|edit|auto|yolo; github-workflows run: yolo|edit|read (no auto). Same concept, different sets and order.

## Evidence

spawn --mode yolo|auto|edit|read
gaslight default auto; choices reordered
harness read|edit|auto|yolo
gh run: yolo|edit|read (no auto)

## Why it matters

Scripts cannot port --mode between commands; safety defaults unclear.

## Suggested direction

Single shared mode enum + defaults matrix documented on every command.

## Severity

**High**

## Area

Safety copy
