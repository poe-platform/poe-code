# UX: models --search "claude/" returns 0 (namespace slash footgun)

## Summary

models --search "claude/" → 0/341 while claude models exist — slash confuses substring match for namespaced ids.

## Evidence

--search "claude/" → 0 models; --search claude works.

## Why it matters

Users pasting prefixes with slash get empty.

## Suggested direction

Strip trailing slash; or match on provider/id parts.

## Severity

Medium

## Area

Models
