# UX: spawn with empty agent validates --mode before agent

## Summary

spawn "" "hi" non-TTY: spawn requires --mode … or --yes to use yolo — mode checked before empty agent rejected; also documents --yes→yolo.

## Evidence

spawn requires --mode when running without an interactive TTY. Pass --mode yolo… or pass --yes to use yolo.

## Why it matters

Validation order wrong; reinforces dangerous --yes yolo default.

## Suggested direction

Validate agent first; --yes default auto not yolo.

## Severity

**High**

## Area

Spawn
