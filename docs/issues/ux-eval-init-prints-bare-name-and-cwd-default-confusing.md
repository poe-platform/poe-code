# UX: eval init prints bare name and creates cwd folder not under evals/

## Summary

eval init ux-probe-eval prints bare ux-probe-eval and next: eval check; creates ./ux-probe-eval in cwd not evals/. Help Usage npm run dev. --yes not on init help but may be ignored.

## Evidence

```bash
$ poe-code eval init ux-probe-eval
ux-probe-eval
next: poe-code eval check ux-probe-eval
# created ./ux-probe-eval not evals/ux-probe-eval
```

## Why it matters

Path/location surprise; bare stdout not design-system; identity npm run dev.

## Suggested direction

Create under evals/ by default; design-system success with path; displayBinaryName.

## Severity

**High**

## Area

Eval
