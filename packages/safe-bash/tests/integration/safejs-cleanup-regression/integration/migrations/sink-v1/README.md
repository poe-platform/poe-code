# Authorized single sink-fixture migration v1 — BLOCKED

Original reviewer acting as **test-only migration author**. Separate review is
still required. Exactly one assertion branch has changed, but the full run is
blocked before guest execution. **No 19/19 result and no migration commit.**

## Semantics checked before editing

All citations here refer to pinned public
`f44958bf48778737a58535e2bc9b37c292ac28c4`, not subsequent live source:

- `src/commands/grep.ts:77` rechecks cancellation, diagnoses ordinary errors,
  sets `failed`, and returns status 2 at line 84; its outer catch also returns 2.
- `src/commands/internal.ts:96` awaits output, including the empty filename/line
  prefix. `src/commands/internal.ts:101` emits exactly
  `${context.command}: ${error.message}\n` for an Error.
- `src/contracts/command.md:99` retains the selected result after drains, with
  caller abort, selected execution rejection, and cleanup failure precedence.
  It does not convert a utility's caught error into a new rejection contract.
- Existing `tests/commands/regex-execution/cleanup-registration/controls.test.ts:171`
  has a different rejection control: **stderr throws too** (line 182).
  That is not this fixture's stdout-only error with functioning stderr.
- Original `5009ba8` already contains a separately passing exact sink-status
  control. It is unchanged. No native Bash or guest-exception oracle is invented.

## Sole fixture edit

Only the `selected.sinkError && !selected.statusControl` assertion branch in
`child.mjs` changes, guarded explicitly by ID `literal-grep-caller-sink-error`.
It now requires **no rejection** and exactly:

```json
{"exitCode":2,"stdout":"","stderr":"grep: sink:literal-grep-caller-sink-error\n"}
```

The same existing `assertOwnedDone(atSettlement)`, native exit/termination flags,
pre-acquisition registration ordering, non-rescue check, and public-disposal
ownership assertions remain intact. There is no new case, delay, runtime hook,
relaxed diagnostic regex, or altered caller-abort expectation.

`FIXTURE.patch` records the exact diff. `PROVENANCE.json` proves the current child
equals the original child with **only that literal assertion-block replacement**.
Guest source, shell input/argv, all VFS input bytes, Error construction/message,
throw point, runtime injection, budgets, cleanup/native probes, all other cases,
and the runner/guards therefore remain unchanged.

## Actual blocker

The unchanged runner was invoked with all 19 cases and new evidence destination:

```sh
node tests/integration/safejs-cleanup-regression/integration/run.mjs \
  tests/integration/safejs-cleanup-regression/integration/evidence/sink-migration-v1
```

At **10:10:54–10:11:04 UTC, August 27, 2026**, the full pinned archive was
authenticated and extracted, then the existing guard failed:

```text
Live source/config differs at capture; refuse hidden overlay
```

Concurrent live changes to `src/commands/internal.ts` and
`src/commands/streams.ts` differ from the required pin. Initial pre-edit source
comparison had matched; this capture records the later disagreement. Exact
hashes and before/after public HEADs are in `PROVENANCE.json` and the raw report.
The migration author does not reset production, substitute current code, weaken
the guard, or reinterpret an infrastructure failure as a case failure or pass.

**Zero guests, native regex workers, or esbuild service children were started.**
Private engine copying and the public build/pack phases had not begun. The owned
archive tree is removed, both Git/tar child commands exited normally, and private
HEAD/index/status/264 regular engine files remain unchanged. No rescue occurred.

Root must resolve or explicitly re-authorize the guard prerequisite before a
new capture can run. This candidate is left **uncommitted**, because the required
passing 19-case validation has not occurred. No source or environment code fix
is attempted. Any retry needs a new evidence directory; do not overwrite v1.

## Original failure remains reproducible

Original review: `5009ba8146c73bd5628147707e733384e5cd4aee`.
Immutable original full capture: `../../evidence/attempt-08/report.json`, **18/19**.
Its raw sink result remains status 2 with the exact output above, while its
original raw-rejection assertion fails.

The original child and all supporting exact harness versions remain in
`../../evidence/attempt-08/harness/*.fixture` and in Git at `5009ba8`. The original
child hash is `70708a7d07fd61595933b08f5ec852f6b8cc5d60f15724239023775318b71ee7`.
The original input-byte constructors are part of those unchanged source bytes.
All **572 other original owned files**, including every prior attempt, fixture,
and original audit report, are byte-identical to `5009ba8` at sealing.

A separate reviewer can replay that immutable original child against the same
public/private pair; the current candidate child must not be substituted for it.
The historical `verify-evidence.mjs` intentionally checks the original live
child hash, so it is not a verifier for this uncommitted migration candidate.

This is only one fixture migration and its blocker provenance. No generic
surface/architecture cohort is duplicated, and no full-engine parity, broad
acceptance, or completed migration is claimed. Stop after this handoff.
