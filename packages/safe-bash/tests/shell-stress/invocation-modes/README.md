# Independent invocation-mode checkpoint

**Resumed result (August 27, 2026 UTC): RED FINAL SOURCE GUARD, no current-tree
acceptance.** Imported `src/commands/filesystem.ts` changed after the stable runs
(commit `37e19b7`); root must coordinate a fresh dependency freeze/replay.
Recorded frozen-source `21a6b91` results: holdouts **69/72**, author **130/132**, prior file cohorts **58/58**,
selected regressions **121/121**, global/build noEmit both exit 0. All failures
remain visible; no new bounded invocation defect was observed. Raw whole-profile
matches are **48/57** and **46/57**, not universal compatibility. See
`POST_READY.md` and immutable `post-ready-*.json` for exact counts, losses, source
guards, actual imports and reproduction. The preparation record below remains
historical evidence, not the current readiness state.

**Status: preparation delivered, NOT independently accepted.** The author did
not publish READY during the single readiness wait. It started at
2026-08-26 23:51:05.236 UTC and ended at 23:55:05.592 UTC: 240.356 seconds
(240-second target plus 0.356-second polling/scheduling overshoot). The watcher
exited. No additional wait, native rerun or runtime acceptance attempt followed.

| Checkpoint work | Actual result |
| --- | --- |
| Corrected whole native cohort | 57/57 captured per profile; 114 total, no timeout |
| Native cross-profile semantics | 57/57 identical stdout/status/effects; 6 raw diagnostic differences |
| Preparatory old-source controls | 3/3 expected red virtual semantics, source guards stable |
| Scoped non-emitting TypeScript check | Passed; exact command/output in preparation audit |
| Prepared holdouts | 72 rows; post-READY execution NOT RUN |
| Unmodified author/new and previous-file cohorts | NOT RUN; waiting for READY |
| Targeted regressions, global/build noEmit | NOT RUN; waiting for READY |

Resume with `verify.ts` only after a stable READY handoff. Confirm the author's
actual cohort filename matches its recorded handoff before running the prepared
regression command list. Any in-scope failure must go to the source author, not
be fixed by editing expectations. The three broader-scope/introspection
rows and four retained policy rows must remain separately identified in totals.

Fresh leaf verifier; no production edits, author expectation copying, delegation,
shared fixture edits or comparator runs. Prepared August 26, 2026 against the
accepted limited file checkpoint (`f4d9d2d` / prior verifier `b2d202a`), not full
Bash. Author readiness is required for acceptance; preparation is not acceptance.

## Independently derived cohort

`cases.ts` was written before reading author expectations. The corrected frozen
cohort has **57 rows**, run in its entirety on both profiles: **114 native runs**.
`holdout.test.ts` adds **15 host-only boundary rows**, for **72 virtual rows**.
There are no skips, xfails, TODO rows, per-case profile choices or diagnostic
normalization. Raw diagnostic bytes remain in evidence. Six diagnostic rows
use predeclared meaning fragments instead of asserting identical line labels;
all other differential stderr, all stdout and recorded effects compare as bytes.

Four rows explicitly test retained strict execution policy, not native parity:
headerless executable, unsupported interpreter, binary and invalid UTF-8 source.
One row records a known broader POSIX difference (special-builtin assignment
persistence). Two rows examine `type`/`command -v`; these are not established
builtins in the earlier checkpoint. Unsupported rows must remain visible in the
whole-cohort result and must not be reported as compatibility passes.

The cohort covers command names/empty and metacharacter arguments, shift/function
restoration, bash/sh invocation, stdin variants, same-cursor/same-chunk command
data including binary cat input, split UTF-8, heredoc and compound units, escaped
newline, incremental syntax failure after file effects, nested stdin children,
parent residual input, environment/cwd/options/fds, and VFS PATH search including
permissions, directory candidates, symlinks, relative/empty/unset components and
precedence. Host rows add literal invoke, middleware, stdin provenance, missing
permission capability, startup/host fallback denial, typed caller reasons with
late rejection, and cumulative source/commands/output/loops/recursion limits.

## Primary sources and native provenance

GNU's primary manual was browsed before derivation:

- `https://www.gnu.org/software/bash/manual/html_node/Invoking-Bash.html`
- `https://www.gnu.org/software/bash/manual/html_node/Command-Search-and-Execution.html`
- `https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html`
- `https://www.gnu.org/software/bash/manual/html_node/Bash-Startup-Files.html`
- `https://www.gnu.org/s/bash/manual/html_node/Bash-POSIX-Mode.html`

The manuals motivate argument/source selection, PATH and execution status, and
the distinction between a shell named sh and general POSIX conformance. Actual
native captures, not inferred manual behavior, establish command/data cursor
behavior and effects preceding stdin EOF syntax failure.

| Profile | Executable | SHA-256 |
| --- | --- | --- |
| GNU 5.3 | `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash` | `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c` |
| Historical 3.2 | `/bin/bash` | `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3` |

Each profile's exact version and `argv0=sh` / `posix on` proof are captured.
The native parent supplies non-exported bash/sh adapter functions which exec the
selected binary with literal argv0 bash/sh. Nested interpreter names resolve
isolated `base/bash` and `base/sh` symlinks to that same profile. No `/bin/sh`
invocation is mislabeled as GNU 5.3. `base/cat` points to hashed `/bin/cat`;
virtual cat uses the shipped standard command definition.

Fixtures use a role-templated shebang: `{{bash}}` renders to the pinned native
executable, versus virtual `/bin/bash`. **Rendered fixtures are not byte-identical
across profiles or adapters.** Every rendered file's bytes, mode and hash, actual
argv, environment, isolated cwd, input bytes, stdout/stderr bytes, exit status
and process deadline result are recorded. Native stdin uses one pipe write;
the UTF-8 row additionally partitions virtual transport into one-byte chunks.
OS delivery chunk boundaries are not claimed to be controllable.

## Evidence and reproducibility

Run from `/Users/kjopek/Workspace/safe-bash`:

```sh
node --import tsx tests/shell-stress/invocation-modes/capture-native.ts native-new-evidence.json
node --import tsx tests/shell-stress/invocation-modes/verify.ts baseline-new-evidence.json baseline
node --import tsx tests/shell-stress/invocation-modes/audit-preparation.ts preparation-audit-new.json
node --import tsx tests/shell-stress/invocation-modes/verify.ts ready-holdouts-new-evidence.json holdouts
node --import tsx tests/shell-stress/invocation-modes/verify.ts ready-regression-new-evidence.json regression
```

Capture and verification evidence writers refuse to overwrite existing JSON.
Ordinary tests read durable frozen captures and do not rerun native probes:

```sh
node --unhandled-rejections=strict --import tsx --test tests/shell-stress/invocation-modes/holdout.test.ts
```

Each native or virtual probe has a four-second hard process-group deadline and
2-MiB capture ceiling. Every process group is killed on completion or failure;
a deadline is failure, never successful caller rescue. Validation batches have
120-second outer deadlines. Sanitized environments omit startup variables and
host PATH for probes. Temporary artifacts stay under this owned directory and
are removed. Strict unhandled rejection mode is used for virtual probes.

`trace.mjs` records actual source loads; verification guards hashes before/after
for those imports, rejecting generated JavaScript or missing runtime.ts loads.
All-source changes are also reported separately from imported-source changes.
Global and build typechecking are non-emitting. No global runtime/default suite,
head-zero pending case, first-read lifecycle case, remote audit, paused NUL cohort
or Curie comparator is invoked by this harness.

### Preserved preparatory fixture error

`native-evidence.json` is the immutable first capture, not the oracle used by
tests. Eight -c positional rows accidentally nested single-quoted printf formats
inside an outer single-quoted command. Both profiles rejected the malformed
fixture before reaching its intended child. The corrected format quoting keeps
exactly the same positional/name assertions; original source, bytes and red
results remain in that first capture. This is a verifier error, not a product
bug or unsupported syntax workaround. `native-corrected-evidence.json` records
the corrected **whole cohort on both profiles**, with no timeouts. Its source
hash is `788539627f6f5d8a8b31702ec3b9c7a6477efe8878fa88fa7fd0ae955553ed3b`.
The unset-PATH row's misleading preparatory name/diagnostic assumption was also
corrected after both native profiles actually found the cwd executable; the
source and fixture behavior were not weakened or changed.

Actual native work includes the preserved initial 114 case captures plus 114
corrected captures, and two sh-provenance processes per capture pass: **232 native
processes total**. Only the corrected 114 case results form the frozen oracle.

Observed profile differences are diagnostic bytes, including line labels,
GNU 5.3's extra EOF compound-command context and binary/invalid-UTF-8 diagnostic
wording. The corrected captures have identical stdout, status and namespace
effects across all 57 rows. This is not universal dialect compatibility.

### Stable preparatory baseline

`baseline-evidence.json` records **three pre-implementation controls**, not
acceptance: empty-name literal `bash -c` arguments and stdin `read` each return
virtual status 2 (unsupported option), while PATH first-usable dispatch returns
127. Both native profiles return 0 with the intended exact output. The probe
processes themselves exit 0 because they successfully captured these red shell
results; that is not a semantic pass. Source HEAD was
`4fa4ba9502dac843bd13aa5031d128a3171f597d`, with 27 actual `.ts` imports recorded,
no generated JS import and no source changes before/after. Runtime hash remains
`dabbb60ffc499a7e64fae8071f12b465b5845e7246510e19da15b406f8481d10`.
`preparation-audit.json` independently checks all rendered/source hashes, whole
profile row sets, diagnostic fragments, executable identities, process-group
cleanup and the exact scoped non-emitting TypeScript command/result. It does not
substitute for post-READY author, old-file-entrypoint or global/build validation.

## Open limits

This bounded checkpoint does not cover full Bash, general POSIX sh, source/dot/
eval, broad unsupported grammar, interactive/job control, remote providers,
life-cycle API design, first-read custom cases, direct sh/env shebang admission,
or host execution. Those remain separate work; the five known first-read cases
are not an acceptance blocker for this invocation-only checkpoint. Runtime fixes
belong exclusively to the source author. No superiority, 72-hour completion or
product-completion claim follows from these tests.
