# SafeJS README contract update: author draft

## Status and authorized scope

**DRAFT CHECKPOINT: current-contract text prepared; feature facts pending.**
This is an author handoff, not independent approval or a publication instruction.
The user explicitly authorized README changes and put Float32Array and string
comparison support in scope. They are not accepted limitations. Boyle owns the
Float32Array implementation and Nash owns `String.prototype.localeCompare`.
Their frozen implementation contracts and independent reviews are still needed
before this draft can claim those features are supported.

Isolated main clone:
`/Users/kjopek/Workspace/poe-code-safejs-readme-contract-author`.
Cloned from the publisher origin and immediately pulled with `--ff-only`; base
`e6b70989225781249f2cf395b927186894fad7c2` contains published contract commit
`ca6b2957c604d8ce01a026b0d0e47b271ff06232` and final QA documentation commit
`398c2a019540fd0eb3e4646fd3ed4c5fa2982285`.

The publisher subsequently confirmed this same main base; intervening auth
changes do not modify SafeJS. This draft describes the pinned source contract,
not an assertion that 11.0.32 is the latest npm release. No registry query or
release watch is performed here.

Owned draft paths:

- `packages/safejs/README.md`: current-contract corrections and links to the
  already-published checkpoint contract; no feature-success claim yet.
- `docs/plans/safejs-readme-contract-update.md`: this plan, questions, provenance
  and validation status; absent at the base.

Root README and agent-harness README need no duplicate contract text at this
stage. No runtime source, tests, checkpoint contract, master ledger, SKILL,
installed files, or home files are changed. No commit or push is authorized.
Installed-skill synchronization remains unapproved and has not been invoked.

## Current-contract changes

1. Replace the blanket suspended-generator exclusion with source/history replay,
   distinct from serializing opaque iterators or native frames. Link current
   checkpoint timing rules rather than repeat an obsolete pending-dump example.
2. Name the structural receiver mutations rejected with `reentry`, without
   treating read-only array composition or direct Map/Set iteration as the same
   restriction. Do not claim general collection parity.
3. Separate supported regex flags `g/i/m/s`, rejected flags including `u/y`, and
   unsupported regex syntax. No regex expansion is proposed.
4. Document fulfilled API diagnostics and rejected application/API promises,
   separately from a guest returning an error-shaped record as application data.
5. Keep source-function property-write refusal separate from captured callable
   data and tested host-visible signature arity.
6. Name unsupported binary `in`; `Object.hasOwn` is an own-only alternative,
   not inherited membership or a promise that lint acceptance ensures support.
7. Link current replay contracts: shallow raw views versus serialized artifacts,
   scoped canonical preservation versus real legacy projection loss, v7 fresh
   runs versus genuine v6 continuation, active-invocation proof conversion,
   irrecoverable split Map aliases, and bounded old-object `toJSON` reset rules.

This intentionally does not copy the full audit census into the README, promise
universal compatibility, or provide a blanket security/non-invocation guarantee.
Old v6 failures and old lossy data do not become retroactively repaired.

## Current source and contract anchors

The held plan
`/Users/kjopek/Workspace/poe-code-safejs-contract-docs/docs/plans/safejs-doc-clarifications.md`
was inspected only as historical proposal context. Its old permission hold is
superseded for README work only; its suggested text is not treated as current
truth and no held candidate is applied. The published source-generator example
now uses `[1, 2, 3, 4]`, and current external replay-mode capture supersedes older
blanket host-wait capture statements.

Current references at the pinned base:

- `packages/safejs/CHECKPOINT_REPLAY.md`: external checkpoint modes; raw/canonical
  projections; source generators; proof context; callable arity; old Map and
  `toJSON` data; dual error channels; v7/v6 execution compatibility.
- `packages/safejs/src/interp/running-state.ts`: locked collection `reentry`.
- `packages/safejs/src/interp/methods/array.ts`: callback-depth handling and
  receiver mutation checks; not a ban on all nested read-only composition.
- `packages/safejs/src/interp/methods/map.ts`: `forEach` lock and mutation checks.
- `packages/safejs/src/interp/regex/parse.ts`: exact `g/i/m/s` flag parser.
- `packages/safejs/src/interp/interpreter.ts`: unsupported binary `in` and
  non-indexable callable property assignment refusal.
- `packages/safejs/src/interp/globals/object-array.ts`: own-only `Object.hasOwn`.
- `packages/safejs/src/run.ts`: built-in registration and rejected execution path.
- `packages/safejs/src/interp/methods/string.ts`: registered string method subset;
  it does not yet register `localeCompare` at this base.

No original audit archive payload was opened. Runtime evidence is the published
contract and existing reviewed receipts, not new executions by this author.

## Exact feature questions for implementation authors

Root should forward these questions; this author does not delegate or inspect
racing implementation clones. Frozen source/test manifests and exact receipt
selectors are sufficient answers. No request to broaden an author's current scope
is implied by asking whether a surface is supported or explicitly excluded.
No direct agent-messaging tool is exposed in this worker. Explicit Boyle/Nash
replies or frozen owner handoffs are required; no implementation facts are inferred
from the request being routed. Final feature text remains pending those replies.

### Boyle: Float32Array

1. What exact constructor forms ship: length, array/iterable, existing typed array,
   or ArrayBuffer/offset/length? Must callers use `new`? Which are rejected rather
   than coerced? Is `Float32Array` the only newly registered typed-array global?
2. Which indexed reads/writes, `length`/byte metadata, static factories, iteration,
   and instance methods are supported? Are `buffer`, shared subviews, `subarray`,
   `slice`, `set`, `BYTES_PER_ELEMENT`, and `ArrayBuffer.isView` available or absent?
3. What are the confirmed binary32 conversion, signed-zero, NaN/infinity, bounds,
   receiver-mutation and budget rules? Which rejected forms use which API channel?
4. Can native Float32Array values cross public bindings, host arguments/results,
   callbacks, and `structuredClone`? What identity or alias sharing survives,
   especially across shared buffers/views, and which surfaces are not supported?
5. Which constructor/method/input/result graphs have source, public built-API and
   fresh-process checkpoint coverage? What happens to old snapshots, including
   historical unsupported-global captures, without rewriting version markers?
6. Supply the frozen implementation/base hashes, public type scope and one minimal
   no-provider, no-I/O README example with exact expected output and receipt.
   Does the existing optional-fs statement about Buffer/Uint8Array remain accurate?

### Nash: String.prototype.localeCompare

1. What exact signature ships: `compareString` only, or also `locales` and `options`?
   Which locale/options fields are supported, rejected, or deliberately delegated?
   How are omitted/undefined/null and non-string arguments coerced?
2. Is ordering defined by a pinned deterministic algorithm or host locale/ICU?
   What is the contract across hosts/fresh processes? Should examples assert only
   negative/zero/positive ordering rather than literal `-1`/`1`?
3. Which case, accent, normalization, numeric and punctuation controls have been
   validated? Which are outside the delivered surface, without calling them
   accepted limitations or implying universal Intl/String support?
4. Is receiver behavior supported through ordinary calls, source callbacks and
   function extraction/`call`/`apply`? What error channel applies to refused forms?
5. Does this affect checkpoint compatibility/version markers or depend on ambient
   host state during replay? Supply exact source/public-built/fresh-process cases
   rather than assuming native host string comparison proves guest support.
6. Supply frozen implementation/base hashes, public type scope and a minimal
   no-provider, no-I/O README example with a stable expected result and receipt.

## Validation and finalization procedure

Current draft validation is documentation-only. All existing fenced code examples
remain unchanged in content; no new runnable snippet is introduced. Existing
examples are not newly executed or recertified. Any new feature example must be
checked against the actual frozen public implementation or have explicit author
execution evidence and independent-review feedback before a final handoff.

The base README fails configured Prettier. Preserve that initial result. Use the
repository's locked Prettier 3.8.3 and unchanged configuration to format only the
two owned Markdown paths, applying edits through `apply_patch`. Retain exact
preimages, the absent-plan identity, format output, strict-diff output, code-fence
identity comparison, current contract/source anchors, and full patch in an owned
immutable draft capsule. Formatting does not expand semantic scope.

Completed draft checks:

- Configured Prettier 3.8.3: both owned Markdown files pass. Initial README format
  failure (exit 1) is retained; formatting cleanup is confined to that README.
- All eight existing README code fences are byte-identical to the preimage;
  zero new snippets, runtime executions, test runs, builds or installs.
- All seven new checkpoint-anchor targets exist in the unchanged published
  contract. Root/agent-harness READMEs and formatting configuration are unchanged.
- Tracked `git diff --check` passes; the added-plan no-index check returns the
  expected new-file exit 1 with no whitespace diagnostics.
- Full patch passes forward `git apply --cached --check` against the unchanged
  base index and reverse `git apply --reverse --check` against the worktree.
  Both are dry-run checks; nothing is staged or applied by them.
- Exact commands and stdout/stderr are retained in the draft capsule. The
  existing locked formatter is used read-only from a prior owned clone; no
  dependencies, installed skills, home configuration or caches are written.

Before finalization after author facts arrive:

1. Intake only frozen manifests and verify actual implementation/base identities.
2. Add only the supported Float32Array and localeCompare surface and qualifications
   to the relevant README lists, restrictions and examples; reconcile any fs text
   only if the implementation facts actually change it.
3. Check new runnable examples through the unmodified public API with finite,
   deterministic, no-provider/no-I/O cases, or obtain exact author execution
   receipts plus independent-review feedback. No private bundle instrumentation.
4. Repeat owned Markdown formatting, links, strict whitespace, exact patch and
   preimage checks. Keep unsupported cases and prior failure evidence distinct.
5. Freeze a new candidate without mutating this draft capsule. A different agent
   reviews it; only root can authorize publication. No self-approval or skill sync.

**Current handoff:** README current-contract draft available now; final feature
documentation is pending the concrete Boyle/Nash facts above, not an idle runtime
slot or a decision to omit the user-authorized float/string work.
