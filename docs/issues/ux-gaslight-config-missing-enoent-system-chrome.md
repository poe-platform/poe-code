# UX: gaslight --config missing file is ENOENT system chrome

## Summary

gaslight --config /tmp/no-gaslight.yaml: ENOENT open + See logs — should be ValidationError config not found.

## Evidence

ENOENT: no such file or directory, open '/tmp/no-gaslight.yaml' 

## Why it matters

UserError without logs; suggest gaslight install.

## Suggested direction

Config not found: path.

## Severity

Medium

## Area

Gaslight
