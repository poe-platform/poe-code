# Independent invocation-closure holdouts

**Post-READY result: red, 31/34 new holdouts.** See `POST_READY.md` and
`post-ready-summary.json` for the completed replay, fixed legacy targets,
separate precedence correction and foreign dependency drift. The preparation
record below remains historical evidence, not the latest acceptance status.

Preparation for three serialized groups only: truthful discovery/command
dispatch, read -N, and the explicit POSIX-sh assignment profile. No production
writes, author expectations copied, delegation, source/dot/eval or old fixture
edits. The 26 native rows and eight host rows were derived before inspecting
any new author tests. No source acceptance while the author writes.

## Frozen scope and actual preparation

- **26 rows × both complete pinned profiles = 52 native case captures**, plus
  four executable/version/bash-or-sh-mode checks. No case deadlines occurred.
- **34 new virtual holdouts prepared**, not yet accepted: eight discovery,
  ten read-N and eight POSIX native rows, plus eight host-boundary rows.
- Host checks cover registry/interpreter availability, literal command invoke,
  middleware/env/cwd/origin, shared budgets, revoked permissions/deleted lookup,
  no host path fallback, typed cancellation after a partial UTF-8 character,
  late query rejection, per-shell profile isolation and unknown permissions.
- Current author source is changing; no purported stable old-source baseline
  was run. Existing accepted failures remain in the unchanged old reports.
- `preparation-type-evidence.json` records a successful scoped typecheck with
  **198 compiler inputs**: a real starting `--listFilesOnly` enumeration, hashes
  before compilation and a fresh actual `--listFiles` comparison. Preparation
  typechecking is not product semantic acceptance.

Read -N payload NUL rows are new, explicitly requested byte-input checks, not
the paused command-substitution NUL cohort. Read cancellation occurs after an
actual leading UTF-8 byte, not one of the five pending first-read cases. Readonly
variable syntax is already unavailable and is not invented for this batch.
`type` flag combinations and invalid-option rejection remain visible probes;
unsupported outcomes must not become skips or xfails.

## Primary derivation and profile facts

GNU official primary manuals were browsed before writing cases: Bash Builtins
(command/type/read), Special Builtins, and Bash POSIX Mode. Source locators:
`https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html`,
`https://www.gnu.org/software/bash/manual/html_node/Special-Builtins.html`,
`https://www.gnu.org/software/bash/manual/html_node/Bash-POSIX-Mode.html`.
The pinned GNU 5.3 source's `builtins/read.def` was also inspected for multibyte,
delimiter and NUL handling. `preparation-audit.json` records its file hash.

The captured 5.3 behavior, not an inferred byte model, establishes that N=2
consumes `éX` under `en_US.UTF-8` but only `é` under `C`, leaving different cursor
remainders. Newline and -d do not truncate -N; -n honors its chosen delimiter.
Native 3.2 lacks -N, and its failures stay in the whole historical denominator.
Modern POSIX-sh function-prefix assignments restore their preceding value;
historical 3.2 persists the function prefix. Native `type -t` mixed-name status
also differs. No per-row oracle selection: 5.3 is the uniform primary target,
while all historical raw outcomes remain separately available.

| Profile | Executable SHA-256 |
| --- | --- |
| `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash` | `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c` |
| `/bin/bash` (3.2) | `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3` |

Every profile runs the identical complete cohort with explicit top-level argv0
bash/sh, scrubbed environment and isolated owned temporary directory. Nested
role tokens become symlinks to that profile; script shebangs also render to the
actual profile executable. No `/bin/sh` or 3.2 shebang child is mislabeled 5.3.
Exact args, environment, rendered bytes/hashes, stdout/stderr bytes and status
are in `native-preparation.json`. Four-second process-group deadlines are hard
failures, never cancellation rescue to PASS. Native input is one pipe write;
selected virtual rows deliberately partition input into one-byte chunks.

`command -V` prints an absolute native pathname. New semantic checks explicitly
map the isolated native cwd to virtual `/work` in stdout; raw comparisons do
not map it. No stderr normalization or byte-identical fixture claim is made.
The separately captured roots/role headers and all raw differences remain
visible; source syntax and expectations have not been rewritten to hide a red run.

## Prepared post-READY sequence

After the source author's closure READY marker, from the repository root:

```sh
node --import tsx tests/shell-stress/invocation-closure/native.ts legacy-native-fresh.json --legacy
node --import tsx tests/shell-stress/invocation-closure/verify.ts new-evidence.json new
node --import tsx tests/shell-stress/invocation-closure/verify.ts legacy-evidence.json legacy
node --import tsx tests/shell-stress/invocation-closure/compare.ts new new-evidence.json native-preparation.json new-comparison.json
node --import tsx tests/shell-stress/invocation-closure/compare.ts legacy legacy-evidence.json legacy-native-fresh.json legacy-comparison.json
node --import tsx tests/shell-stress/invocation-closure/verify.ts previous-evidence.json previous
node --import tsx tests/shell-stress/invocation-closure/verify.ts types-evidence.json types
```

This reruns the unchanged **72 + 132**, fresh whole **57 × both real native
profiles**, fresh virtual comparisons, previous file/read/selected regressions,
and global/build/focused benchmark noEmit. The raw comparison preserves the old
57 native snapshots and reports every old/fresh byte/status/effect change rather
than switching oracles. Strict file-policy raw losses remain in denominators.
The original fixed stdoutHex transport decoder is reused for old TAP captures;
new probes write direct JSON observations, not parsed escaped TAP diagnostics.

Runtime phases record all source changes plus actual imported `.ts` dependency
hashes before/after. Type phases enumerate actual inputs before compilation and
reject unknown newly included files; no missing hash is backfilled. Evidence
writes are immutable. Publish genuine in-scope failures to the coordinator,
stop acceptance and let the source owner fix them; do not retry whole cohorts
indefinitely. Nine historical-native/five custom-first-read findings, paused NUL,
frozen remote audit and full default suite remain separate, untouched work.

## Actual checkpoint disposition

The one readiness wait ran from **2026-08-27 00:45:18.343 UTC** to
**00:49:08.347 UTC** (230.004 seconds, within the requested 240-second cap).
READY was absent. The watcher exited; no second wait or product replay started.
This is a preparation checkpoint, **not acceptance of the author changes**.
All post-READY commands above remain unexecuted. Root can resume them after the
author handoff; no virtual success count is inferred from native or author runs.

`preparation-audit.json` records the observed HEAD, unchanged old-cohort hashes,
new input hashes, exact native source hash, raw cross-profile differences,
foreign worktree state and stopped-process/temporary-directory audit.
Generate that audit once with `node tests/shell-stress/invocation-closure/audit.mjs`;
its output is immutable. Native evidence and test expectations remain frozen.

The final scoped preparation rerun (`preparation-final-types.json`) also exited
0 with 198 starting-listed inputs and no relevant dependency drift. It does
not run product tests. `final-checks.json` seals the prepared files and records
cleanup of those additional compiler processes before the owned-only commit.
