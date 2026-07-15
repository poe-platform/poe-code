---
severity: medium
impact: polish
comment: "Careful filing and an interesting tension with the two positives calling this same help best-in-class: both readings are right, and that is the finding. The Filters/Views/Examples content is the best in the CLI and it is rendered outside the design system, duplicating flag names already in Options. So the fix is not to remove the depth the positives praise but to render it consistently - keep Examples, fold Filters into Options descriptions. Read alongside ux-dual-help-systems.md: this is that split visible inside one command's help."
---

# UX: models --help mixes styled Options section with unstyled Filters/Views/Examples sections

## Summary

`poe-code models --help` outputs two separate help formats back-to-back:

1. **Styled Options section** — standard Commander.js format with yellow flags and descriptions
2. **Unstyled plain-text sections** — `Filters:`, `Views:`, and `Examples:` blocks in uncolored white text below the standard help

The result is a jarring visual split halfway through the output.

## Evidence

```
Options:
  --provider <name>    Filter by provider name        ← yellow, styled
  --model <name>       Filter by exact model id
  ...
  -h, --help           Display help for command

Filters:                                               ← unstyled white
  --provider   Substring match on provider/owner
  --model      Exact model id match
  ...

Views:
  capabilities   Model features...
  pricing        Cost per million tokens...
  ...

Examples:
  $ poe-code models --provider anthropic
  ...
```

Flag names appear in the Options section (with `--` prefix, yellow color) AND again in the Filters section (without `--`, no color). This redundancy doubles the content without adding value.

## Why it matters

The two visual styles break the design system contract users learn from other commands. The repetition of flag names in both sections is confusing — users may not immediately recognize that `--provider` in Options and `provider` in Filters refer to the same flag.

## Suggested direction

Remove the `Filters:` section (it repeats Options content) and integrate `Views:` content into the Options descriptions. Keep `Examples:` but style it consistently with the rest of the help (or add it to all complex commands uniformly).

## Severity

Medium

## Area

Models / help / design system / visual consistency
