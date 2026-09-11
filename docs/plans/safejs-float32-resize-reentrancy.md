# Float32 operations during buffer resizing

Follow-up to the ArrayBuffer foundation. Do not claim full resizable typed-array
compatibility from the initial bounds and tracking tests.

Read-only native/interpreter comparisons on the current implementation confirmed:

- `view.join(separator)` where `separator.toString()` shrinks an eight-byte
  tracking view's buffer to zero returns `"-"` natively, but
  `"undefined-undefined"` in SafeJS. Missing indexed elements contribute empty
  strings after separator coercion; the originally captured element count stays.
- `view.slice(start)` on a fixed view at offset four, where `start.valueOf()`
  shrinks its buffer to zero, throws native TypeError but SafeJS RangeError.
  Revalidate the view after coercion with native exception ordering.
- A control using a length-tracking iterator at offset zero followed by shrinking
  its buffer to zero agrees: `{value: undefined, done: true}`. Do not change this
  passing behavior. A fixed view becoming out of bounds still needs comparison.

Next: add native-oracle failing tests for these cases before implementation.
Include fixed versus tracking views, zero/nonzero slice counts, resize during end
coercion, iterator recovery, snapshots and budget retention. Keep this follow-up
atomic and qualify it independently; do not change currently running full-suite
sources during qualification.

Join follow-up is now in progress after foundation commit
`64625bc4b6ea825fe81690d03fb4674c8181faf0` was verified on remote main.
Five native tests produced three failures (full/partial shrink) and two passing
controls (growth and shrink/regrow). The join loop now emits empty text for
missing indexed values while retaining its original captured length and budget
checks. Logs: `/tmp/poe-safejs-join-resize-red.log` and
`/tmp/poe-safejs-join-resize-qualified.log`. This follow-up is still local and needs
lint, type, broader focused checks and its real harness before its own push.

Foundation release monitoring: scoped workflow 34092258055 and CLI workflow
34092258379 were both in progress after verified push. Neither publication is
confirmed yet. Continue this work while monitoring those runs.

Join was delivered in `75da0b6c46f599472dca01d765c97e980eb9755d`, verified on
remote main. All 196 Float32 tests passed in an isolated run; lint, TypeScript,
70 uncached build tasks and the inspected real harness passed. Foundation scoped
run 34092258055 published `@poe-platform/safe-js@0.1.315` at
2026-09-07T06:49:35.0126561Z. Foundation CLI run 34092258379 was cancelled;
join scoped run 34092538018 and CLI run 34092537952 are active, not yet published.

Slice follow-up now has five native tests: four failed before implementation,
one growth control passed. The implementation preserves the requested result
length, revalidates storage after coercion only for nonempty slices, and copies
only currently available source bytes. Missing trailing values stay zero; empty
slices do not acquire an out-of-bounds byte view. Focused checks are recorded in
`/tmp/poe-safejs-slice-resize-red.log` and
`/tmp/poe-safejs-slice-resize-qualified.log`. This slice change is still local and
needs complete focused qualification and its actual harness before pushing.
