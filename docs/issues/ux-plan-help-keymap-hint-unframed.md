---
severity: low
impact: polish
reproduced: y
recommendation: fix
evidence: "src/cli/commands/plan.ts:532 .addHelpText(\"after\", \"\\nExplorer keymap: e edit, a archive, d delete, n new\") appends an unlabelled trailing line; asserted verbatim in src/cli/commands/plan-root-command.test.ts:133"
comment: "Correct and neatly reasoned: an interactive keymap line ('e edit, a archive, d delete, n new') dangling at the end of a non-interactive help page reads as debug output, and its argument that UI hints belong in the UI is the better resolution. Note the keys it documents are destructive shortcuts (a archive, d delete) with no confirmation mentioned - worth checking against the archive/delete Critical while touching this."
---

# UX: plan --help keymap hint rendered outside any section or panel

## Summary

`plan --help` ends with a bare line:

```
Explorer keymap: e edit, a archive, d delete, n new
```

This line appears at the bottom with no section header, no panel frame, and no label — it looks like stray debug output rather than intentional help text.

## Evidence

The line appears after the Commands section with no surrounding structure:
```
Commands:
  browse [options]   Browse plans in the interactive explorer.
  ...

Explorer keymap: e edit, a archive, d delete, n new
```

## Why it matters

Users may not notice or trust it as documentation. It also mixes UI-operation hints into a non-interactive help page, which is jarring.

## Suggested direction

Either remove the keymap hint from the help page entirely (it belongs in the interactive explorer UI itself), or add it as a clearly-labelled section: `Notes:` or `Interactive explorer:`.

## Severity

Low

## Area

Plan / help / formatting
