# Independent current-shell cohort: frozen before acceptance

This leaf owns only this directory. No implementation-author source/dot/eval
tests or expectations were inspected before defining and freezing this cohort.
No product source, shared contract, manifest, benchmark, or foreign test is edited.
This is a bounded 43-row gate: 32 native semantic rows and 11 separate host-contract
rows. It is not full Bash support, overall kernel parity, or superiority evidence.

## Profiles and references

PRIMARY is the real GNU Bash 5.3.0 binary at
`/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`. HISTORICAL is the Apple
`/bin/bash` GNU Bash 3.2.57 binary. Both run the entire identical 32-row native
cohort. No case selects whichever oracle happens to agree. Every outer process
has `argv0=bash`, `--noprofile --norc -c SCRIPT shell`, C locale and a scrubbed
environment. The two `sh-profile-*` rows intentionally execute each same Bash
binary through a `sh` symlink: Bash's sh invocation profile, not a claim about
dash, a separate system sh, or a POSIX conformance certification.

Official semantic references, consulted August 27, 2026:

- GNU Bash manual, Bourne Shell Builtins, dot/source, eval and return:
  https://www.gnu.org/software/bash/manual/html_node/Bourne-Shell-Builtins.html
- POSIX.1-2024 Shell Command Language, dot and eval special built-ins:
  https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html

The manuals motivate current-environment evaluation, argument concatenation,
source argument handling and return context. Exact expected bytes, statuses and
effects come from the whole PRIMARY capture, not hand-edited manual deductions.
POSIX describes a distinct language profile; it does not override GNU Bash rows.

## Frozen evidence and coordinates

`cases.mjs` defines the independent recipes and the host-contract requirements.
`native-frozen.json` retains exact raw base64 stdout/stderr, exit status, signals,
executable versions/hashes, launch argv/env, temporary paths, fixture hash, all
regular-file bytes and directory names, and source-import guards for each run.
Fixtures are fresh per process; native files are mode-default, non-executable
source files. `work/` and `search/` exist at entry. The harness-owned `bin/`
contains only symlinks for the selected bash/sh and `/bin/cat` (hash recorded).
Product commands are in-process virtual commands, never these native tools.

Native temporary root text is mapped to `/fixture` in stdout/stderr, and only
there; raw bytes remain alongside it. Paths in filesystem snapshots are relative
to each root. There is no diagnostic, line-number, whitespace or status mapping.
All files (including unchanged script inputs) and directories are compared;
native-only launcher `bin/` is excluded. UTF-8 fixtures contain valid UTF-8 only;
base64 preserves their exact bytes. Mode/mtime/inode equality is not asserted.
The virtual cwd is `/fixture`; `PATH=/fixture/bin` is a conceptual launcher
coordinate, with native `bash`/`sh` represented by kernel dispatch and `cat` by
the standard virtual registry. Top-level `$0` uses `shell` in native diagnostics;
the explicit child `$0` row uses `cohort-zero` identically on both sides.

Every native child has an 8-second hard process-group deadline and 1 MiB capture
ceiling. The process group is killed on timeout, overflow and normal completion;
remaining group visibility is recorded and must be false. Product executions
also run in individually guarded deadline-bound child groups. The guard hashes
the local static transitive source imports of shell, memory FS, standard commands
and contracts before and after each run. This is not a clean-tree guard and says
nothing about unrelated concurrent writes. Changed guards invalidate evidence.

## Host-only requirements, not native parity

These 11 rows are independently specified before product acceptance:

- `source-provenance-cursor` and `eval-provenance-cursor`: an injected `take`
  command receives true for implicit stdin and false for explicitly supplied,
  redirected and piped stdin. With a two-chunk supplied source it consumes one
  chunk in the current-shell operation and the next afterward; both see false.
  EOF does not change provenance. No stream probing may infer the flag.
- `source-acquisition-cancellation`: cancellation reaches the VFS source read,
  rejects execution with the caller's exact reason, and executes no later marker.
- `eval-command-cancellation`: cancellation reaches the injected awaited command
  under eval, rejects with the caller's exact reason and executes no later marker.
- Six byte/command/loop/output/source-depth/eval-depth budget rows, plus the
  separate eval-byte row: shared limits must reject with `ShellLimitError` and
  the exact configured `limit`; nested evaluation never receives a reset budget.
  Limits and finite prefixes are literal fixture data. Depth uses the existing
  `maxSubstitutionDepth` contract; no new production API is requested.

The output-budget driver additionally records dispatch of all three intended
printf commands. A missing-eval diagnostic can itself overflow the same output
budget, so matching the error type alone is not an evaluation-budget pass.
The initial pre-READY artifact preserves that false-positive classification;
the strengthened witness is a harness correction, not a recipe/expectation edit.

Known exclusions: no new read builtin, general trap/job-control syntax, arbitrary
invalid encoding policy, descriptor persistence via exec, sourcepath/shopt
configuration or Bash 5.3 `source -p` option coverage. The cursor host rows use an
injected byte consumer rather than requiring unrelated read-builtin support.
The old nine historical diagnostics and five custom first-read lifecycle cases
are not rerun or closed here. Expanded7 belongs to the other leaf.

Stop at frozen expectations and red evidence. Repeat the unchanged cohort only
after root provides the exact source-author READY revision; retain the original
red artifact. Never skip, xfail or weaken expectations to bless missing features.

## Reproduction

- `node tests/shell-stress/current-shell/capture-native.mjs native-replay-NAME.json`
  reruns both entire pinned native profiles. It cannot overwrite existing evidence.
- `node tests/shell-stress/current-shell/run-product.mjs ready-NAME.json` runs all
  43 rows, saves exact results and guards, and exits nonzero for any failing row.
- `node --import tsx --test tests/shell-stress/current-shell/current-shell.test.ts`
  exposes the same 43 rows as actual failing/passing node:test subtests.
- `node tests/shell-stress/current-shell/validate.mjs validation-NAME.json`
  records focused/global typechecks and the owned test command with source guards.

No dependency or package script is added. Product children use the repository's
existing development-only tsx loader; oracle and harness utilities use Node
builtins. Read `REPORT.md` before interpreting any pre-READY checkpoint.
