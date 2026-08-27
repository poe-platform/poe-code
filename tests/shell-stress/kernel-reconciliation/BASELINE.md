# Current kernel/invocation reconciliation — frozen baseline

Measured August27,2026,04:29:26–04:30:37 UTC. Source writer remains read-only
through this freeze. No production file, original test, oracle, benchmark or
expectation was edited. Product cohorts each ran ONCE; this is not an inferred
reuse of earlier scores and not a full kernel/Bash parity claim.

## Current results

| Frozen cohort | GNU5.3 primary | Bash3.2 historical | Qualification |
| --- | --- | --- | --- |
| Expanded36 raw tuples |29/36|28/36|All36 actual observations unchanged from prior0f5dbb3 capture|
| Expanded10 host contracts |10/10|not native assertions|All10 current import guards valid|
| CORRECTED invocation72 |72/72|same tests assert both references|57 differential rows plus15 host rows; not72 raw native matches|
| Invocation57 raw tuples |52/57|50/57|All57 compared, including policy and diagnostic rows|
| Fresh expanded36 native vs frozen |36/36|36/36|No raw tuple drift|
| Fresh invocation57 native vs frozen |57/57|57/57|No raw tuple, source, stdin or rendered-fixture drift|

There are **seven primary expanded losses** and **five primary invocation
losses**, plus one and two respective historical-only losses. Every current
unresolved row, exact source/fixture, stdout/stderr/status and complete original
effect observation is in `unresolved-rows.json`; `RAW_ROWS.md` renders the
15-row union with BOTH profile tuples and byte-exact effect-map references.
No loss is waived, normalized, skipped, reclassified as a pass or removed.

## Functional handoff, not a request for cosmetic repairs

1. **Scalar substring expansion is a concrete missing capability.** Unchanged
   `parameter-existing-controls` runs
   `VALUE=abcabc; printf "%s:%s:%s:%s" "${#VALUE}" "${VALUE:1:3}" "${MISSING:-default}" "${VALUE:+set}"`.
   Both natives produce `6:bca:default:set`, status0, empty stderr, no new
   effects. Current emits no stdout, status2,
   `shell: Unterminated or unsupported parameter expansion at offset 55\n`.
   Parser435–455 lacks the substring operator. This is not a newly demonstrated
   regression in removal/replacement; it is a useful preexisting gap, not a
   warning-coordinate issue. `functional-handoff.json` freezes the exact case.
2. **Optional env-shebang arguments remain an actual capability gap with an
   explicit platform/policy boundary.** Darwin's `#!/usr/bin/env bash -e`
   executes the existing body and creates `marker=should-not-run`, mode0644;
   current rejects126 before effects. The fixture name/body do not override
   actual native evidence. Current runtime1106–1112 intentionally recognizes
   only exact `env bash`/`env sh`. ROOT must decide bounded optional-argument
   scope; neither ambient host execution nor Linux kernel equivalence follows.
3. **Two env error statuses differ observably:** missing target and literal
   `bash;touch marker` return native127 but virtual allowlist rejection126.
   This can affect caller control flow, so it is not dismissed as bytes-only.
   Both sides have empty stdout/no new effects; no injected command executes.
   These are unsupported-interpreter/error-policy decisions, not successful
   dispatch or environment leaks. Full tuples remain red for ROOT to route.
4. Remaining expanded losses are unreadable-file diagnostic context, missing
   absolute-interpreter wording, and creation mode0666 versus0644. The latter
   has exact `XbX` output and `patternreplacement` marker bytes/order: it is a
   filesystem creation/umask profile, **not an expansion semantics repair**.

The invocation57 primary losses are `path-only-denied-126`, `path-missing-127`,
`path-unsupported-shebang-policy`, `path-binary-policy`, and
`path-invalid-utf8-policy`. The first two preserve correct statuses/effects but
native uses `$0=outer` with a one-line role-function prelude; product uses
default `shell` with the original unprefixed source. The next two preserve126
and no effects, differing in explicit containment diagnostics. Invalid UTF-8
is an intentional source policy:126 rejection versus native byte-command
lookup127; it remains a real raw loss, not permission to run host binaries.

Historical-only losses are expanded `header-noexecute`, invocation
`stdin-eof-syntax-prior-effects`, and `child-environment-isolation`. Primary
matches all three; historical diagnostic dialect differs while effects/status
agree. The latter retains proper parent locals/exports and child function
isolation. No per-row alternate source/profile was run to make these green.

**No current36/57 raw loss is a registry-kind mismatch.** The distinct frozen
seven's truthful `command` versus native `builtin/file` classification remains
separate, unrerun and unaltered. Do not relabel registered commands as builtins.
Its historical progression0/7→3/7→6/7 is not assigned a new score here.

## Native profiles and original launch roles

- GNU5.3.0(1)-release, aarch64-apple-darwin25.4.0:
  `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`, SHA256
  `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
- Historical `/bin/bash`,3.2.57(1)-release, arm64-apple-darwin25, SHA256
  `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
- Actual `/usr/bin/env` is Apple's Darwin tool, SHA256
  `9eb7c5aed7f3c7fe07b77d9a84d0a7c6a8c68c17a15aa3dace0d8ff02d352776`.
  It is not relabeled GNU env or GNU/Linux. Exact tool hashes, versions and
  launch environments are retained in `native36-current.json` and
  `native57-current.json`. Host is Darwin25.4.0/arm64, Node22.22.2, umask022.

Expanded36 preserves OS argv0=`bash`, shell `$0=shell`, the original scrubbed
PATH/HOME/LC_ALL=C/LANG=C/TZ=UTC, canonical isolated temp fixtures, and original
role symlinks. Only declared canonical native cwd→`/fixture` projection is
applied; raw bytes/cwd remain alongside tuples. Snapshot modes are not changed
to green. Fresh controls prove primary parent5.3/env-child5.3/**direct-child3.2**;
historical parent/env/direct children are3.2. Direct `/bin/bash` is never called
a5.3 child. The explicit env role resolves the selected profile binary.

Invocation57 preserves OS argv0=`bash`, shell `$0=outer`, and original literal
one-line `bash`/`sh` function prelude using `exec -a bash/sh` with the selected
profile. `sh` version controls verify POSIX mode. PATH is literal `base`, HOME
`/nonexistent`, C locale and UTC. `{{bash}}` fixtures render the selected native
binary, while the virtual fixture uses `/bin/bash`; this preexisting mapping
is retained, not described as identical shebang bytes. Role cat is `/bin/cat`.
The only harness relocation is isolated native temp directories from the old
owned test directory to system temp; no cwd projection or output adjustment is
used for57. Every native raw tuple and fixture/source/input hash matches frozen.

Each native child has the original hard process-group deadline/output bound
and cleanup. Product uses unchanged VFS/registry runners and never spawns a
native oracle. The36 product runner records forbidden host calls; none occur.

## Guarded source and input integrity

All10 committed/current shell modules match anchor
`c116d637aa82e4b075460fc07088a5703a10e7b4`, including the preceding name fix
`22ca649492275aed151193986d6956a95ff7f3f7`.

- Runtime SHA256
  `f307642e52c3bfeb5df64057fb26af6645135bb5bdc307f399de6ce1541c0ddb`.
- Parser SHA256
  `f8a76103ccc3e0f981bdb8cf391f48a8864dbf895c39e459d5f5da7b6ec77b0c`.
- **49/49 successful-capture phase guards valid:**2 native capture parents,
  46 independent product rows,1 unchanged CORRECTED72 phase. Actual source
  imports135 per expanded row and34 for invocation, logged per child PID and
  compared against pre-enumerated before/after hashes. Compact manifests are
  reused by digest, not repeated per load.
- During native36, an unimported foreign SafeJS runner changed; during
  `parameter-quoted-fields`, two unimported S3 test files appeared. Exact paths
  and inventories are preserved. No imported source/input drift or original
  hook failure occurred. These foreign additions do not erase productive
  observations under ROOT's current rule, and are not called clean-tree proof.
- Archive extract/format source was already foreign-dirty, loaded and stable.
  This is a committed-shell/stable-import checkpoint, **not a clean committed
  aggregate**. Stage/index observations remain recorded; foreign work preserved.

Original dba5df8/70065f1 inputs, original57 native captures and corrected72's
pinned7d329e0 integrity migration remain untouched. Original native cohort hash
still pins the original cases file; corrected cases hash remains
`fdc22c27541f4f29334274e35238c22fa4645730dbe5239134a585ee8e03f83c`.
Both original native artifacts are pinned by their full hashes before capture.

## Harness failure and explicit bounded recovery

`baseline-current.json` is the **failed initial harness attempt**, not a
product baseline: both native loops completed but their final savers could
not find `apply_patch`/`git` under the scrubbed harness PATH. Their stderr,
launch-phase source/import guards and partial stdout are immutable there.
Per-row tuples were lost at the saver boundary; do not pretend they survived.
No product case ran in that attempt.

One explicit recovery supplies host PATH **only to the native capture harness**
so it can save evidence. Each actual oracle still gets its original scrubbed
environment, unchanged. Both whole native cohorts/profiles were repeated once;
thus there were two native attempts, not one. This was a harness-save recovery,
not a source change, foreign-drift retry or per-case retry for green. Current
product46 and CORRECTED72 ran only once, in `baseline-recovered.json`. No
artifacts were overwritten and no further retries occurred.

## Reproduction and scope retained

- Exact current46 child entry: `node --import tsx
  tests/shell-stress/expanded-gaps/product.mjs CASE_ID`.
- Exact holdout entry: `node --unhandled-rejections=strict --import tsx --test
  --test-concurrency=1 tests/shell-stress/invocation-modes/holdout.test.ts`.
- New `native36.mjs` and `native57.ts` adapt only original imports/output/temp
  locations; fixtures, native execution and assertions are not rewritten.
  `capture.mjs` wraps actual imports and raw comparisons; immutable output
  savers intentionally refuse overwrites. ROOT must use new artifact names
  for later acceptance rather than replacing this freeze.

Primary semantic references inspected: official GNU Bash manual *Shell Parameter
Expansion* and *Shell Scripts*, plus the pinned5.3 distribution's
`doc/bashref.texi` (hash in audit). The manual specifies substring offset/length
semantics and explicitly makes shebang argument splitting OS-dependent. Native
captures, not a guessed cross-platform rule, determine these frozen expectations.
Official pages: `https://www.gnu.org/s/bash/manual/html_node/Shell-Parameter-Expansion.html`
and `https://www.gnu.org/s/bash/manual/html_node/Shell-Scripts.html`.

The historical29/36+28/36,52/57+50/57, earlier51/57+49/57, original72/72 then
71/72 and separately CORRECTED72/72 remain intact. Prior expanded host guard
invalidation remains historical; current10/10 does not erase it. Accepted
accounting, old9 diagnostic/profile reconciliation, five CUSTOM firstread
requirements, original seven, BOM/jq and global/full-suite gates were NOT
rerun here. No lifecycle/API changes or global/FS/core fixes are authorized.
All312 recorded successful-capture child process groups are absent; initial
harness groups also exited, with native per-child cleanup in the reused helper.
Scoped native-capture TypeScript validation exits0 with175 pre-enumerated
compiler inputs and zero input drift (`scoped-typecheck.json`); this is not a
global/build/benchmark check. No watcher, SIGSTOP, remaining owned child or source write. Baseline frozen;
stop and relinquish for ROOT's next source decision, not an indefinite watch.
