# UX: eval list unknown command suggests lint (odd Did you mean)

## Summary

eval list is not a command; error Did you mean: lint? which is a poor suggestion for list (distance match without semantic sense).

## Evidence

```bash
$ poe-code eval list
■  Unknown command "list".
│  Did you mean: lint?
```

## Why it matters

Shows toolcraft suggestions can be semantically wrong even when distance-close.

## Suggested direction

Prefer semantic aliases (list→report) or suppress distant/meaningless suggestions; document real commands.

## Severity

Medium

## Area

Eval / suggestions
