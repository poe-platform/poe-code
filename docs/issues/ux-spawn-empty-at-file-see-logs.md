# UX: spawn empty @file prompt has See logs

## Summary

spawn claude @/tmp/empty.txt: No prompt provided via argument or stdin + See logs — clear message, system chrome.

## Evidence

■  Error: No prompt provided via argument or stdin
●  See logs …

## Why it matters

UserError without logs.

## Suggested direction

UserError; mention empty file.

## Severity

Medium

## Area

Spawn
