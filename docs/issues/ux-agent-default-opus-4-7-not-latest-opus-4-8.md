# UX: agent default is opus-4.7 while catalog has newer opus-4.8

## Summary

agent --model default is anthropic/claude-opus-4.7; catalog has anthropic/claude-opus-4.8 (Date Added 2026-05-28). Not broken (4.7 exists) but defaults lag latest frontier.

## Evidence

DEFAULT_FRONTIER_MODEL = opus-4.7; catalog has opus-4.8.

## Why it matters

Defaults may lag; optional upgrade path.

## Suggested direction

Consider DEFAULT_FRONTIER_MODEL = opus-4.8 or document pin policy.

## Severity

Low–Medium

## Area

Config / models
