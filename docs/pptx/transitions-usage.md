# Transition usage draft

The `pptx` command supports `transitions list|get|add|set|remove`. Creation and
editing are limited to direct cut/fade/push/wipe transitions. Compatibility
branches, Morph, through-black variants and other effects are preserved and
reported unsupported; editing them fails.

```sh
pptx transitions list slides.pptx --json
pptx transitions get slides.pptx --slide 1 --json
pptx transitions add slides.pptx --slide 1 --kind push --direction left --duration 700 --advance-after 2500 --advance-on-click false -o timed.pptx
pptx transitions set timed.pptx --slide 1 --advance-after null --advance-on-click true -o manual.pptx
pptx transitions remove manual.pptx --slide 1 -o cleared.pptx
```

Durations and delays are integer milliseconds from 0 through 2147483647.
`--advance-after 0` means immediate automatic advance. `--advance-after null`
explicitly removes automatic advance; this nullable clear operation supplements
the format table's numeric grammar and follows the shared SDK absence convention.
Omitting an option in `set` preserves its current setting. New transitions default
to click advance, no automatic advance and 500 ms duration (cut is always zero).
Cut/fade forbid direction; push/wipe require an applicable direction. Imported
speed-only transitions have no exact millisecond duration to report.

Mutations require a selected slide or explicit `--all`, plus `--output`,
`--in-place` or `--dry-run`. Scalar options cannot repeat. Unsupported content,
invalid settings and stale selectors fail before output publication. Removing a
supported transition removes its advance metadata, retains unrelated slide nodes,
and leaves existing sound relationship/media parts intact.

The operation SDK exposes `readTransitions(input, { selection? }, context)` and
`mutateTransitions(input, action, options, context)` through the `pptx` package.
Both are async and use caller-admitted bytes or explicit input capabilities.
`MutateTransitionsOptions` uses `kind`, `direction`, `duration`, `advanceAfter`,
`advanceOnClick`, `selection` and `allowEmpty`. Use `advanceAfter: null` to clear
and `advanceAfter: 0` for immediate advance. No runtime reads host files, queries
time, fetches links or plays sound.

```ts
const timed = await mutateTransitions(bytes, "add", {
  selection: { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } },
  kind: "fade",
  duration: 700,
  advanceAfter: 2500,
  advanceOnClick: false
}, context);
const transitions = await readTransitions(timed.bytes, {}, context);
```

This is a byte-operation SDK, not a claim that the complete live presentation
object model is implemented. README publication remains unapproved.
