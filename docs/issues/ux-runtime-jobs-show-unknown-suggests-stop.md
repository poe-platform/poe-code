# UX: runtime jobs show is unknown; suggests stop (odd)

## Summary

runtime jobs show is not a command; Commander Did you mean: stop? — users expect show/get for job details.

## Evidence

```bash
$ poe-code runtime jobs show
error: unknown command 'show'
(Did you mean stop?)
```
Commands: ls, attach, logs, stop, sync, sandbox.

## Why it matters

Missing show/get detail command; wrong suggestion.

## Suggested direction

Add jobs show <id> or make ls default detail; better suggestions.

## Severity

Medium

## Area

Runtime jobs
