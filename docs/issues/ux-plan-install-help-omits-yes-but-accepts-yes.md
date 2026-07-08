# UX: plan install --help omits --yes but --yes works

## Summary

plan install --help has agent/local/global only; plan install --yes --local works and installs skill without documenting --yes.

## Evidence

plan install help: no --yes
plan install --yes --local → Installed plan skill…

## Why it matters

Help/behavior mismatch for non-TTY.

## Suggested direction

Document --yes on help.

## Severity

Medium

## Area

Plan install
