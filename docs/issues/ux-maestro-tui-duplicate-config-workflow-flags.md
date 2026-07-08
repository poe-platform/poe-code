# UX: maestro tui has both --config and --workflow for same path

## Summary

maestro tui --help lists --config Path to WORKFLOW.md and --workflow Path to WORKFLOW.md — duplicate flags for same purpose.

## Evidence

--config <path> Path to WORKFLOW.md
--workflow <path> Path to WORKFLOW.md

## Why it matters

Duplicate options confuse users and docs.

## Suggested direction

Single flag; alias the other.

## Severity

Medium

## Area

Maestro
