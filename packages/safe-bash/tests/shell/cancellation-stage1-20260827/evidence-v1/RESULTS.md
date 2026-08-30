# Stage 1 candidate results

Freeze commit: `7023c28229ecb7939aee5eb7ca0f52ac57c795bb`.

Private-helper source commit:
`6747227230cd770379148552d471621717b766d7`.

Candidate source SHA-256:
`cde614b830e11f2040db65d2347c5f430df4b353324684585b2dc242ac733960`.
Git blob: `d5ceafef56a9351bd77630db66d9acfdc19a38ee`.

The source commit adds only `src/shell/cancellation.ts`. It has no imports, no
barrel/package export, no Runtime/Shell/cleanup integration, no timer, no
`Promise.race`, no numeric result/status storage, and no timeout mapping. The
freeze commit adds only the nine files listed by its commit pathset. Concurrent
commits mean the source commit is not the direct child of the freeze commit;
their exact identities and pathsets, rather than ancestry adjacency, bind this
work.

## Private API shape

- `createRootCancellationLink(input)` creates a bounded root lineage from
  original root/control signals.
- `admitChildCancellation(parent, options, snapshot)` returns a borrowed no-op
  lease for absent/undefined signals or an owned descendant link for a valid
  local signal.
- `subscribeCancellation(boundary, callback)` provides bounded synchronous
  fanout whose failures are returned by idempotent close.
- `selectCancellationOutcome(boundary, captured)` is pure and returns an exact
  return/throw outcome plus optional per-boundary cancellation provenance.
- Origins retain original signal identity, role, and frame. Provenance reports
  contain no command result or status.

The sibling primitive-reason ambiguity is resolved with an explicit report from
the exact child boundary. A reason-only shared array would be unable to
distinguish concurrent siblings that both use `false`, `0`, undefined, or NaN.
Unreported or handled child cancellation therefore cannot poison a parent or
sibling selection.

## Exact precedence

Admission uses: already-aborted root caller, outermost invoke ancestor, first
control origin; then stable parent-closed failure; then staged container/getter/
brand/snapshot failure; then local pre-abort. The options property is read once,
and an ancestor aborted at entry skips it entirely.

Boundary selection uses: root caller; exact unrelated captured rejection;
outermost-to-innermost invoke cancellation; exact explicitly reported/local
cancellation; numeric return. Controls are propagated as cancellation
provenance but remain unrelated execution failures for invoke-deadline
replacement. Every reason comparison is `Object.is`; undefined is represented
by an explicit throw discriminant, never truthiness.

First delivery cannot change. Selection can improve while open. Close fixes the
boundary, detaches owned listeners/subscriptions, returns exact callback/
lifecycle failures, and is idempotent. Callback failures do not replace a child
outcome. Stage 2 must append them to the existing InvocationScope cleanup
accumulator; cleanup-only failures and 124 mapping are not implemented here.

## Results

- Scoped native-free runtime contract: 22/22 pass, exit 0.
- Focused strict source/test typecheck: exit 0.
- Negative signal type fixture: exit 0 with all four `@ts-expect-error` rows
  consumed.
- Isolated emitted ESM/declaration build: exit 0.
- Emitted ESM smoke: exact own reason and invoke-option provenance observed;
  child/root close failures 0; caller/local listener counts both 0 after close.
- Frozen fixture manifest: 8/8 pre-candidate hashes verified.
- Reserved `cleanup.ts`, `runtime.ts`, `shell.ts`, and `types.ts` working bytes
  match design commit `618d8967…`.
- No root export/package match for `cancellation`; no existing file was edited.

Build artifact hashes before owned scratch cleanup:

- JS: `a77d885824a0cfa4f454d9c574cc361aa9ea5507c7f62bd52f2ecc8a98254a28`
- declaration: `67b90043f40ef0c5a53ae0be912351cb05f51707523ca4a3ae4e7d8b9f432e65`

The isolated artifacts were generated from the live committed source only; no
repository or AGENTS archive/copy was made. They are validation products, not
committed product outputs, and are removed after evidence capture.

This is a private Stage 1 helper, not an actual invoke API or timeout command.
A different review is required before any Stage 2 Runtime/Shell/contracts/types/
cleanup/export integration.
