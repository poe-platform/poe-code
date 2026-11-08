# Canonical fraction migration: exactly two tests

New narrow TEST-ONLY migration author; not Curie or the independent semantics
reviewer. No delegation. Conditional user authorization follows independent
semantics acceptance at `c9b96263d1204bdf54e89324cc0c7d1ef6bd3f79` of
`f6406cd` plus `c782363`, qualified to supported calendar0000..9999 and the
documented virtual-clock policy. The unrestricted `%g` magnitude rationale was
rejected by that review and remains outside this author's ownership.

## Exact replacements and profiles

Only two entries leave the existing malformed-input rejection loop in
`tests/commands/time-env/date.test.ts`. Each becomes one separately named
positive test, retaining exactly its original argv:

| Exact argv | Status | stdout string / hex | stderr |
| --- | --- | --- | --- |
| `['-d@0', '+%12N']` | 0 | `000000000000\n` / `3030303030303030303030300a` | empty string and bytes |
| `['-d@0', '+%-N']` | 0 | `0\n` / `300a` | empty string and bytes |

Both assert exit status, the helper's stdout string and raw-byte-derived
`stdoutHex`, and empty stderr. Because the immutable helper does not return
stderr hex, each test supplies a sink that copies its actual stderr chunks,
then checks both their decoded string and concatenated bytes. The helper itself
is unchanged. No new helper, error relaxation, limit change, skip or TODO exists.
Every other malformed input and the original rejection assertions remain intact.

The `%12N` expectation agrees with the independently captured exact GNU9.7 input.
Padding zeros express format width, not a claim of additional clock precision.
The **bare `%-N` expectation is ordinary-formatter virtual-clock policy, NOT
strict GNU9.7/Darwin parity**. The immutable semantics capture records exact
native bare `%-N` as `000000\n` (`3030303030300a`), status0, empty stderr;
that mismatch remains. Ordinary native `%--N` records `0\n` (`300a`), status0,
empty stderr, backing the policy rather than making the bare inputs equivalent.
No product flag change or raw native-output rewrite is authorized or performed.

Those three native observations come from committed
`../semantics/canonical-native-proposals.json`, binary SHA256
`8d7c339a192d04e3de9768ebe4330d68bb541a4ed6c82f2bc3a807a270b156ff`.
This migration does not rerun those native probes. The unchanged native portion
of canonical223 uses the packed review's separately hashed cached binaries;
`FREEZE.json` records their distinct identities. GNU9.7 on Darwin is not a
GNU/Linux or universal-platform claim.

## Historical223 stays 221 + 2 failures

The original fixtures are pinned to
`d904ca986fa945df8aef6e11b4165e2c2a63f814`. Their complete six-file223 cohort
with full `c782363` source was independently captured by packed-review commit
`61c66bca1212ad511af2ce057f866c8839027b8a`: **221 pass, 2 fail**, no skips.
The failed names are exactly the original `%12N` and `%-N` rejection cases.
This historical result is not rewritten, reclassified or counted as223 passes.

Immutable raw references under `../packed/evidence-final/` at that commit:

- `source-original223.stdout`: SHA256 `3bbc41f8b6a97fbf8b7d46029ecd6537f2f56d549d4555126e909b6dc4ebd508`.
- `source-original223.json`: SHA256 `a8ad7b072fc21c25af902f6e8597e02dc201b6ac8b81da0fb74345112f138a90`.
- `source-original223.stderr`: SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

`BEFORE.json` also hashes the committed review README, SOURCE_PROOF, proposals
and packed manifest. The packed review's304/304 holdout remains separate prior
evidence, not a cohort rerun or additional passes by this migration author.

## Frozen candidate and actual result

The candidate uses the **entire committed archive** of
`c7823633ee99f711f1319ace59d4cf2b7f622ecc`, tree
`47b9a9d5763c036bdb8eab8ee25091ae5bd64a20`, not live or selectively overlaid
product source. Archive SHA256 is
`4ba2f44723111446087b45a56269492492b34fa88df21b007a50aabf38e21530`,
913,039,360 bytes,14,482 tracked paths. The whole extracted path/content digest
matches the immutable packed review before any overlay. All216 source/config/
package files are additionally checked individually against `git show`.

The sole tracked archive overlay is `date.test.ts`. All six original test files,
the helper, date vectors and existing scoped typeconfig match their original
committed identity before overlay. Full archive post-run guards find **only**
the owned date-test delta; every product source, protocol, config, root export,
other fixture and historical evidence byte stays unchanged in the candidate.
Existing development tools and existing pinned native-oracle binaries are copied
only into untracked archive prerequisite locations. No dependency install,
native build, private runtime, root fix or source build is performed.

`FREEZE.json` was written at2026-08-27T09:19:01.639Z, before either test command.
It records exact argv, environment, source and fixture hashes, prerequisite
identities and the before/after test hashes. `date.before.ts.txt`,
`date.after.ts.txt` and `date.patch` preserve the exact fixture migration; the
`.txt` snapshots are captured data, not TypeScript discovery inputs.

| Single execution | Actual result |
| --- | --- |
| Entire original six-file cohort, two authorized replacements | **223/223**, zero failures/cancellations/skips/TODOs |
| Existing `tests/commands/time-env/tsconfig.json --noEmit` | **exit0**, stdout/stderr empty |

Node22.22.2, TypeScript5.9.3, Darwin arm64, ICU78.2, tzdb2025c; exact runtime and
tool identities are retained. Execution uses source imports through tsx, not
a packed/public time-env export. Each command has a120-second supervisor limit;
the canonical Node test runner has30-second test limits and concurrency1.
Raw runner outputs and supervised command records are `canonical223.*` and
`scoped-types.*`; both processes close cleanly. Test output reports assertions,
not a separate per-command byte trace. No broader/live/package gate is claimed.

The capture runs2026-08-27T09:18:46.010Z–09:19:12.305Z. No72-hour duration,
performance conclusion, default integration, broad parity or superiority claim.

## Live ownership guards and cleanup

Before editing the test, the author hashes15,298 other tracked/indexed paths.
The live worktree is deliberately **not** called unchanged or tested: the guard
observes one concurrent foreign documentation change,
`tests/commands/tree/SORT-TEXT.md`, recorded with exact before/after hashes in
`RESULTS.json`. The foreign tree work was staged at freeze and independently
committed as `436bda3` during capture. The author neither stages nor edits that
work. All other guarded live bytes, including source and actual test fixtures,
match. Moving HEAD and foreign index state are recorded rather than hidden.

All archive, native scratch and tool copies live outside repository test trees.
The unchanged isolated-child fixture omits inherited cache controls, creating19
tsx cache entries. Cleanup identifies each by the unique owned scratch source
paths and checks identity/hash before removing it; foreign cache entries and
the shared cache directory remain. Owned scratch is removed and ENOENT-checked.

## Replay and evidence boundary

From the repository root, with the existing cached prerequisites present and
the committed two-test candidate in place, choose a fresh output directory:

```sh
node tests/commands/time-env-stress/fraction-independent/canonical/replay.mjs prepare /tmp/fraction-canonical-replay-unique
node tests/commands/time-env-stress/fraction-independent/canonical/replay.mjs replay /tmp/fraction-canonical-replay-unique
```

Generated evidence uses exclusive creation. Do not overwrite this first capture.
After capture, the driver's diff command was anchored explicitly to `c782363`
so it also works on a clean committed candidate; its output was checked to be
byte-identical to frozen `date.patch`. This is an offline capture adjustment,
not another product run or fixture change. `MANIFEST.json` seals this directory
except itself. A different verifier still owns candidate inspection/replay.
