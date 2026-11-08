# Hidden errexit holdout: native preparation only

Prepared 2026-08-27 (UTC). **Do not disclose case contents, identifiers, or native
expectations to the implementation author before their first READY.** The root
handoff is metadata-only. This directory belongs to the independent verifier.
No new author implementation or author tests were inspected, and no product
module was imported while preparing this freeze.

## Frozen scope

- 54 unchanged native cases in each of four whole profiles: **216 observations**.
- Four injected host contracts are prepared but **unexecuted**. They are not
  native observations, accepted product tests, or passes at this checkpoint.
- Broad coverage: real stop-on-error and option toggles; conditional/list/function
  contexts; source, dot and eval; subshell and command substitution boundaries;
  pipelines/pipefail and compound stages; explicit return/exit; interpreter
  option, argument, current-shell and child-shell boundaries.
- Every declared effect file starts at mode 0644. Output, error output, status,
  and the complete relative file inventory/bytes/modes are authoritative, with
  no path, diagnostic, mode, flag, or output normalization.
- Native comparison uses the complete consistent profile, never a selected
  per-case oracle. Historical differences stay visible; they do not dictate
  modern design. No policy-unsupported result may become a passing test.

## Captured profiles and controls

The retained capture ran **2026-08-27T05:25:34.947Z through
2026-08-27T05:25:36.729Z**, on Darwin 25.4.0 arm64, Node v22.22.2.
The exact kernel description and Node executable are in `native-frozen.json`.

| Binary | Whole Bash cohort | Whole POSIX sh cohort | Actual version |
| --- | ---: | ---: | --- |
| pinned GNU | 54 | 54 | 5.3.0(1)-release, aarch64-apple-darwin25.4.0 |
| historical Apple | 54 | 54 | 3.2.57(1)-release, arm64-apple-darwin25 |

Pinned executable paths and SHA-256:

```text
/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash
8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c
/bin/bash
35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3
/bin/cat
580599dd318fa34bb0f91c29106894852c49c3a3df724b637113df95c6758fe6
```

Each profile has a successful launcher-control observation proving command
`$0`, actual version, POSIX option state, command-substitution option state,
both child roles/versions, and raw NUL/non-UTF-8 capture. `argv0` is explicitly
`bash` or `sh`; POSIX mode is established by the actual sh role, not inferred
from a file label. C locale and UTC are explicit. `--noprofile --norc` and a
scrubbed environment suppress user startup configuration. The environment is
exactly PATH, HOME, LANG, LC_ALL, TZ; no ambient ENV, BASH_ENV, SHELLOPTS or
POSIXLY_CORRECT is inherited.

Role fixtures outside the asserted working directory provide `bash` and `sh`
symlinks to the same profile binary and `cat` to the pinned `/bin/cat`. They do
not change the native optional-shebang-argument protocol. Every actual
executable, argv0, argument vector, command name, stdin, cwd and environment is
recorded. The `-c` forms uniformly use command name `shell`; stdin/file forms
retain their real distinct native identities and must not be relabeled during
product acceptance. `-ec`, `-e -c`, `-es` and file launchers are intentional
frozen inputs, not per-row oracle selection.

There are **3/54 exact historical tuple differences per role**, and **4/54
exact Bash-versus-sh tuple differences per binary**, including role-specific
command identities. These are reference differences, not product pass counts.
`freeze.json` pins these denominators and all evidence inputs. Each frozen
observation is retained verbatim; no later rerun overwrites it.

## Capture integrity and initial control correction

`native.mjs` reuses only `runChild` and `sha256` from the pre-existing read-only
`../current-shell/support.mjs`. Its SHA-256 is
`d7b278db709f869a03e5cce56c501011a1162465b03ecfc1663465b0163c6f8a`.
Each native group has a 3-second deadline and combined 1-MiB output cap; the
helper terminates/checks its detached process group without SIGSTOP. Temporary
working directories are removed in `finally`; all retained rows have clean
transport/cleanup results. Tool/helper hashes match before and after capture.
No ambient network commands or capability are used; this is not a claim of
an OS-level network sandbox. Host native tools are test oracles only.

The first capture attempt stopped on its historical launcher control with
status 2 after the two primary cohorts had run; its partial semantic rows were
not persisted and are not counted as retained evidence. An isolated four-role
long-option investigation and four-role exact control reproduction are saved
in `launcher-investigation.json` and `launcher-control-initial.json`. The
initial control used a case statement inside command substitution which the
historical parser rejected. Before freezing, only that **control** was changed
to capture `set -o` inside command substitution. No semantic case, fixture or
expected tuple was changed. The complete four-profile capture was then made
and retained; it is not represented as the first/only native execution.

No source snapshot, source lease assertion, product correctness, repository-wide
cleanliness, or source hash is inferred from these native-only observations.
Concurrent foreign edits and staging are outside this commit.

## Reuse after author READY

First verify `freeze.json` and all frozen inputs, then record READY, source
commit/inventory and before/import/after guards for the actual loaded product
and its dependencies. Add new acceptance artifacts; do not rewrite this freeze.
Replay every case in each whole profile, preserving literal invocation/source
identity and exact native tuple. Unsupported inputs, aborts, timeouts and
unmeasured rows are not passes. Report any helper correction separately with
the original evidence; never retry a product loss into a green claim.

`host.mjs` accepts injected `Shell`, `MemoryFileSystem` and `agentCommands`
exports; it adds no product API. The four independent contracts cover literal
nested invocation, shared command limits, cancellation with late rejection,
and awaited output drainage under stop-on-error. They use bounded small output,
not the accepted output-accounting cohort, quota-edge copies or head-zero custom
commands. `host-runner.mjs` isolates each contract in a 3-second/1-MiB detached
child group. Callers must provide source/import guards; the generic injected
module runner alone does not establish source provenance. Late host work is
observed before releasing listeners; the fixture does not pre-handle the tested
rejection on behalf of the product.

```sh
node --test tests/shell-stress/errexit-holdout/integrity.test.mjs
node --check tests/shell-stress/errexit-holdout/host.mjs
node --check tests/shell-stress/errexit-holdout/host-runner.mjs
# Optional future whole native replay, always to a NEW filename:
node tests/shell-stress/errexit-holdout/native.mjs native-replay-new.json
# Only after author READY, with a guarded injected module exporting the API:
node tests/shell-stress/errexit-holdout/host-runner.mjs /absolute/injected-module.mjs host-new.json
```

The existing native file is refused as an output target. Default native capture
must not be rerun over the freeze. Integrity checks inspect records and hashes,
not product modules, and do not rerun native cases.

## Limits and references

This bounded preparation is not implementation acceptance, a full Bash gate,
kernel parity, or superiority evidence. No broad arrays/special-parameter work,
ERR trap feature, `inherit_errexit` API, new grammar, env-S, or optional-shebang
argument decision is introduced. No Darwin `/usr/bin/env` behavior is silently
replaced with GNU env; env/shebang protocols are not measured here. The current
kernel replay belongs to a different verifier. Old nine diagnostic profiles,
five custom-first-read lifecycle cases, scalar C-byte fragments, creation masks,
and accepted accounting evidence are separate and untouched.

Primary GNU manual sections consulted during independent case design: *The Set
Builtin* and *Bash POSIX Mode*. The former documents ignored conditional/list
contexts, including their dynamic function/compound effect; the latter documents
POSIX command-substitution inheritance and sh invocation. These guide selection,
not hand-authored output oracles: the actual four native profiles are decisive.

```text
https://www.gnu.org/s/bash/manual/html_node/The-Set-Builtin.html
https://www.gnu.org/s/bash/manual/html_node/Bash-POSIX-Mode.html
```
