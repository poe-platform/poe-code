# Independent error String coercion review

## Scope and disposition

Reviewer: Aquinas, independent of Turing's authoring lane. Review date: August 30,
2026 UTC. **READY for the scoped four-file intake**: the three unchanged author
files plus this report. Independent native/source/public-built checks, fresh
completed replays, genuine RED/GREEN, configured build, full SafeJS and default
root suites, source/test types, lint, and publication-file formatting pass.
Historical failures and setup corrections remain visible below.

This review concerns the three-file frozen error-coercion candidate, not universal
JavaScript coercion, full Error prototype compatibility, Float32Array,
String.prototype.localeCompare, or the final README. Ordinary guest object
conversion and guest-defined conversion hooks remain **OPEN compatibility
followups**, not accepted limitations. Publication and any later composite gate
remain the coordinator/publisher's responsibility.

## Exact intake

The fresh isolated main clone is
`/Users/kjopek/Workspace/poe-code-safejs-error-coercion-independent`. Its explicit
fast-forward pull from `git@github.com:poe-platform/poe-code.git main` completed
successfully with “Already up to date.” HEAD is
`e6b70989225781249f2cf395b927186894fad7c2`.

Author input:
`/Users/kjopek/Workspace/poe-code-safejs-error-coercion-author/out/safejs-error-coercion-author/candidate/manifest.json`,
SHA-256 `9d73942e676a7625ea9c4b0387e9c7da80c4f1eb0c945c240068e2163d415820`.
All 50 indexed author artifacts were independently byte-counted and hashed before
the exact overlay was applied with `apply_patch`. No author file or assertion was
edited. Historical author failures remain in the copied input capsule.

| Publication path                                                   | Preimage              | Exact author postimage SHA-256                                     |  Bytes |
| ------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------ | -----: |
| `packages/safejs/src/interp/globals/object-array.ts`               | Present, 12,297 bytes | `4bf66fa629da1ee5b171bb8b5c5815f1d5672c90be02eaffba5850c6d7b1ed5c` | 12,597 |
| `packages/safejs/src/interp/globals/error-string-coercion.test.ts` | Absent                | `0cb512d636373e825f3cbb6148c01a4e62553fd27243937481b8235ec5fc2865` |  6,526 |
| `docs/plans/safejs-error-string-coercion.md`                       | Absent                | `4e7cfd17bf92a66597d4e851dc279be4884d3ef4fe07ef9224fa1cca64a59c85` |  8,743 |

The production preimage SHA-256 is
`b5d296fb4f0267cae87b13724f3e2894f07cebc50616f3686720b4303ebd190c`.
It matches both pulled main and the author's retained preimage. The only tracked
production delta is ten added lines and one removed line. This independent report
is the fourth proposed publication path; its preimage is absent. No independent
test file or additional production delta is proposed.

Evidence paths below are relative to
`out/safejs-error-coercion-independent/`. The final manifest separates the four
publication files from author input, independent observations, build artifacts,
and mutable install/work directories. None of those evidence or dependency files
is an additional publication prerequisite or source delta.

## Root cause and boundary inspection

The old String factory calls native `String(value)` on the interpreter's branded
plain error records. That produces `[object Object]` rather than the built-in
Error string. The candidate uses the existing `sandboxErrorTypes` WeakMap only
when the value is a non-null object without an own `toString`, then calls
`Error.prototype.toString.call(value)` internally. It retains the original
fallback otherwise and retains `options.budget.allocateString` around the result.

Relevant unchanged anchors are `error/shape.ts` for the brand,
`interp/exceptions.ts` for `createSubsetErrorValue`, `interp/globals/error.ts` for
the six supported factories, `interp/values.ts` for descriptor-based data copying
and brand preservation, and `interp/host-bridge.ts` for legitimate native Error
normalization. The host bridge recognizes actual Errors and creates branded
subset errors; the review never inserts a guessed brand into the WeakMap or
manufactures a native capability. There are twenty exact source/configuration
pins in `evidence/source-built-identities.json`; only `object-array.ts` differs
from HEAD among them.

The candidate does not install `toString`, `constructor`, getters, or any other
native function on guest errors. An explicit ordinary inspection control returns
the same result on baseline, candidate source, and the real public build:
`["undefined", "undefined", ["name", "message", "stack"]]` for the two `typeof`
observations and own keys. Native Error objects instead expose prototype methods
and have different own keys. That difference is disclosed, not described as full
prototype parity or newly accepted under this fix.

The allocation control creates a legitimate branded error under a separate
unlimited factory budget, then invokes the candidate String factory under a
20-character budget. It throws `SandboxError`, `code: "budgetExceeded"`,
`budget: "stringLength"`, `current: 26`, `limit: 20`. Thus this check charges the
conversion itself, rather than merely failing earlier in the Error constructor.
No general resource-safety proof or new security campaign is inferred.

## Original fixture and independent TDD

The exact prior README-review source is retained, not reconstructed from a label:

```js
try {
  throw new TypeError("example failure");
} catch (error) {
  return {
    receiver: typeof error,
    errorName: error.name,
    errorMessage: error.message,
    errorString: String(error)
  };
}
```

The byte-exact one-line source lives in `evidence/public-inputs.json`; the code
block is its formatted presentation. Native, candidate source, and the actual
public build return all four values in the original key order:

```json
{
  "receiver": "object",
  "errorName": "TypeError",
  "errorMessage": "example failure",
  "errorString": "TypeError: example failure"
}
```

The genuine baseline returns the same first three values and
`errorString: "[object Object]"`. The original fixture, inputs, and expected values
are not weakened. Returned record prototypes are explicitly recorded as native
`Object.prototype` versus SafeJS `null`; data equality is not claimed to prove
prototype identity.

The unchanged final author test file was first added to the untouched production
preimage: **23 failed, 7 passed**. After applying the exact final production
postimage, the same **30 tests passed**. `evidence/baseline-red.json` and
`evidence/green.json` retain the exact argv, timestamps, exit status, stdout, and
stderr. A separately archived HEAD source run reproduces the original full-value
mismatch; the baseline code is not simulated by replacing an expected string.

## Native, source, public build, and replay

`evidence/public-inputs.json` defines nineteen bounded cases: the original
four-field result; six supported Error factories; seven current name/message
combinations (empty, undefined, null, numeric, boolean, and Unicode); deleted Error
message and deleted Error name/message; a field whose ordinary coercion throws;
and two legitimate host Error alias cases, including safe field getters.

The agent executed exact inline JavaScript, not a standalone QA runner. The final
command is fully preserved in
`evidence/public-runtime-correct-policy.json#/argv`: `node --import tsx
--input-type=module -e <captured inline program>`. It imports the public source
barrel and `poe-code/safejs` through the package's actual export. The latter
resolves to this clone's freshly built `packages/safejs/dist/index.js`, not an old
candidate or source alias. Its entry and all three relative imported JS chunks
are captured byte-for-byte under `evidence/built/` and hashed in
`evidence/source-built-identities.json`. No private bundle instrumentation is
used. Fresh local `npm ci` installed 548 packages; the exact package-lock and
Node version are pinned.

The completed run records **19 native outcomes, 38 source/public-built current
outcomes, 38 fresh public replays, and 76 completed captures**. All expected own
data values, primitive types, key order, and observed aliases match. The result
observation records prototypes separately rather than normalizing them away.
Public replay uses `dump(current)`, JSON decoding, public `restore` with the same
source, and a new `run` with newly supplied host bindings. Both host and resume
provider counters remain zero on every completed replay.

For both host cases, the returned array contains the same actual Error twice;
the guest observes `same: true`. The retained replay graph has two array
references to one branded Error node, and the journal records a consumed host
call. The fresh replay keeps that alias and error string without calling the
replacement host. Across all 38 current/replay pairs, **the complete dump text,
heap, and journal are each exactly equal**. The per-case output locator, data
hash, dump hash/bytes, heap hash, journal hash, and trace are indexed in
`evidence/public-observation-index.json`. Cross-run random/run identifiers and
native stack identities are not falsely asserted equal.

## Additional bounded coercion checks

`evidence/bounded-boundary.json` records seven internal cases and four separate
native/baseline/source/public-built observations. Internal inputs come from the
legitimate error factory, not WeakMap manipulation:

- Removing both own name and message exercises the intrinsic's missing-field
  defaults and returns `Error`; this is not a claim about every Error subclass's
  inherited prototype fields.
- Safe own getters return numeric name `42` and boolean message `false`;
  conversion returns `42: false` and reads `name` then `message`, once each, just
  like native `Error.prototype.toString.call` on that record.
- Throwing name and message getters preserve the exact thrown sentinel identity
  and read order. A name getter failure never reads message.
- A name value containing non-callable `toString` and `valueOf` throws the native
  TypeError, rather than silently formatting or swallowing the failure.
- The conversion budget failure is checked independently, as described above.
- A plain native record with error-shaped fields stays unbranded and uses the
  unchanged ordinary String fallback.

These are bounded host-side intrinsic checks; they do not introduce or certify
guest accessor syntax or arbitrary guest coercion hooks. The separate public host
getter witness materializes the two Error fields once at the existing boundary.
Native reads each getter twice in that witness (explicit field observation plus
String), whereas baseline, candidate source, and public build read each once and
then use copied data. `evidence/baseline-host-getters.json` confirms this unchanged
trace. Live host-accessor invocation-count parity is not claimed. No getter or
native function is exposed by this production delta.

## Gates and retained failures

| Independent gate                                  | Result                                                     |
| ------------------------------------------------- | ---------------------------------------------------------- |
| Exact final test on baseline                      | 23 failed / 7 passed, genuine RED                          |
| Same test after exact overlay                     | 30 passed                                                  |
| Full SafeJS source/test selection                 | 8,594 passed / 39 skipped; 214 files passed / 1 skipped    |
| Default root retry                                | 25,971 passed / 41 skipped; 1,005 files passed / 3 skipped |
| Configured root build                             | Passed; 67 workspace tasks successful                      |
| SafeJS configured source types                    | Passed                                                     |
| Strict author-test-root type check                | Passed                                                     |
| Configured root `lint:types`                      | Passed                                                     |
| Configured root ESLint after work-copy isolation  | Passed                                                     |
| All four publication files' configured formatting | Passed                                                     |
| Tracked strict whitespace check                   | Passed                                                     |

The package selection is not called the full root suite. Full original command
outputs and exact environment overrides are retained for each gate. No timeout,
worker, test exclusion, lint rule, assertion, source, or test-file workaround is
used.

Failures and corrections are explicit:

1. An initial patch-application tool call inherited stdin instead of piping its
   input and exited before editing. The exact `apply_patch` overlay then
   succeeded. `evidence/setup-corrections.json` records the tool failure.
2. The first configured build completed all 67 workspace builds, then tsx's IPC
   listener failed at an overlong clone-local temporary socket path. The full
   failure is in `evidence/build.json`. A shorter owned temp path allowed the
   same build to finish; 65 workspace results were cached and two reran. This is
   not described as a second all-forced build.
3. The first public replay program used the invalid policy string `reissue`.
   It failed with `Invalid replay call state`. The supported literal is
   `re-issue`. Only the two policy literals changed for the successful run; all
   sources, expected values, and assertions stayed exact. The failed run remains
   in `evidence/public-runtime.json`. This is a reviewer harness error, not a
   candidate replay defect or an unresolved product finding.
4. The first default root run recorded **25,970 passed, one failed, 41 skipped**.
   The failure was the unchanged nested Vitest integration case in
   `packages/agent-eval/src/run/vitest-runner.integration.test.ts`. Its generated
   fixtures used an in-repository TMPDIR, consistent with ancestor config discovery.
   An isolated worker-owned temp directory outside the repository makes the
   unchanged focused case pass. The full original failure remains in
   `evidence/root-default.json`; the final default-root retry passes all 25,971
   tests, with 41 skipped, in `evidence/root-default-owned-tmp.json`. Nested
   runner stderr was drained by the existing helper, so the exact config-discovery
   diagnosis is an inference from the path change and focused/full passes. An
   initial progress message misread normal OTel listener output as an error;
   that preliminary diagnosis was withdrawn, not used as evidence.
5. The first root ESLint invocation also scanned the review's archived HEAD tree;
   its relocated `arguments.ts` did not match the repo's path-specific rule
   exception. That nonpublication working copy was moved byte-for-byte to this
   install's default-ignored `node_modules/.cache/error-coercion-baseline`.
   The full inventory and original failure are retained; the unchanged configured
   root ESLint command then passed. No production file is excluded or modified.

The final worker-owned TMPDIR is
`/Users/kjopek/Workspace/.safejs-error-coercion-independent-tmp`, not another clone
or the user's home configuration. HOME, npm/XDG caches, and config directories
remain in this clone's output workspace; TERM is unset. `SKIP_SYNC_SKILLS=1`,
`HUSKY=0`, and snapshot playback/error-on-miss are explicit. Existing root tests
include their configured disk-backed integration fixtures; no new unit test
creates files, and all new guest witnesses use only bounded data and pure hosts.

## Open followups and publication boundary

`evidence/bounded-boundary.json` independently rechecks the two author-reported
open cases on native, baseline, candidate source, and public build:

- `return String({});`: native returns `[object Object]`; all three SafeJS
  executions reject with `TypeError: Cannot convert object to primitive value`.
- `const error = new Error("before"); error.toString = () => "custom"; return
String(error);`: native returns `custom`; all three SafeJS executions reject
  with the same TypeError. The own-property guard preserves the old path; it
  does not implement or justify omitting guest hooks.

These are supported-compatibility followups under the user's current feature
authorization. Neither is closed by this candidate or relabeled an accepted
restriction. The author plan states that disposition explicitly. Error prototype
reflection and live host accessor parity are also not certified by this scoped
change. The observed prototype/method/key differences remain visible; they are
not counted as new fixes or new accepted limitations.

No original archive payload was read. The retained prior provenance guard is
copied as metadata; no excluded payload, security probe, LLM, network-capable
guest, or old audit runner was executed. The original mismatch source comes only
from the hash-bound prior review/author copies. No original initial-audit read
chronology is newly certified. No README, SKILL, master ledger, other clone,
author capsule, branch, commit, or publication was changed. Build-generated
untracked working assets and install/cache files are not publication inputs.

Before publication, require the exact production preimage or a fresh ordered
integration review, all three author postimages unchanged, and this report's
captured bytes. The frozen review is an intake decision for this pinned scope,
not proof of a future composite main tree or an npm release.
