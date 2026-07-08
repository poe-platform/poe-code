# UX: usage list --filter "" returns all entries

## Summary

usage list --filter "" still shows 20 entries — empty filter ignored (empty flag class).

## Evidence

usage list --filter "" → full list of 20 entries.

## Why it matters

Explicit empty filter should error or match nothing.

## Suggested direction

Reject empty --filter when present.

## Severity

Low–Medium

## Area

Usage
