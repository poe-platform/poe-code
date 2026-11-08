# Three expanded shell gaps — author checkpoint

This is bounded author implementation, not independent acceptance or full Bash
parity. Original expanded-seven0/7 and subsequent3/7 artifacts are untouched;
the different verifier will replay them after this source freeze. Registry
classification differences are not parser defects and have not been changed.

## Supported increment

- Headerless executable VFS text uses the existing isolated script process
  path. It preserves arguments/argv0, exported environment, cwd and shared
  execution resources; parent private variables/functions do not become child
  interpreter state. Parent Bash/sh profile carries into headerless fallback;
  shell options reset as in existing script startup. Native controls establish
  these state rules. This is not source/dot execution in the current shell.
- Direct `#!/usr/bin/env bash` and `#!/usr/bin/env sh` select the existing
  virtual interpreters, including sh special-assignment policy. Leading/trailing
  horizontal whitespace is accepted; CR is not silently removed. The interpreter
  operand is recognized as a whole, not split into arbitrary words. No host
  process, host PATH search, ambient network or environment is used. These are
  explicit virtual interpreter bindings, not a general emulation of env/execvp.
  A registry override of the requested interpreter is explicitly rejected
  rather than silently bypassed. Explicit `bash script` retains its own profile.
- Scalar `${value/pattern/replacement}`, `//`, `/#`, `/%` support first/all and
  anchored replacement, longest matches, glob stars/question marks/classes,
  escaped slashes, quoted patterns/replacements, nested words and substitution.
  Unquoted replacement ampersands use the selected GNU5.3 default semantics;
  explicitly quoted ampersands remain literal. Existing `#`, `##`, `%`, `%%`
  removals now use the same private bounded pattern matcher instead of building
  an unbounded regex. Match work, copied ranges and output bytes are capped by
  the existing expansion limit, with cooperative cancellation checks/yields.

No Budget.sink/invoke output accounting change, contract/API expansion, exports
by name, manifests, dependencies, filesystem or core command edits. Source and
command budgets remain shared; no new Shell or fresh runtime Budget is created.

## Deliberate limits

Existing script permission/capability checks, fatal UTF8 decoding, binary/NUL
rejection and whole-file parse-before-effects policy remain. These are not full
native executable-format heuristics or race-free filesystem execution leases.
Only the recognized env interpreter forms above are supported: `-S`, `-i`,
assignments, arbitrary interpreters, multiargument tails and interpreter flags
are explicitly rejected126, not ignored. Native kernel/env argument behavior
varies by platform; this does not claim a universal kernel/env implementation.

Pattern processing is bounded scalar/code-point matching with the existing
ASCII POSIX character-class table, not full locale collation, byte-oriented
non-UTF8 parameter values, arrays, extglob, or full `$@` elementwise operations.
No shopt option interface or patsub_replacement toggle is added. Heavy otherwise
valid patterns may exhaust maxExpansionBytes rather than consume unbounded
work. Existing syntax/startup/environment limitations remain visible.

## Native evidence

`expanded-gaps-native.json` contains all45 cases under BOTH complete profiles:
15 headerless,10 env-shebang,20 parameter. Each has exact base64 stdout/stderr
and status; the same primary profile is used throughout. Author product results
match45/45 GNU5.3,43/45 historical3.2. The two retained historical differences
are quoted and unquoted replacement ampersands (new differences, distinct from
earlier historical cohorts). No stderr/path/output normalization was performed.

Actual primary: GNU Bash5.3.0(1), aarch64-apple-darwin25.4.0, SHA256
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
Actual historical: /bin/bash3.2.57(1), SHA256
`35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
Each real env-shebang child uses Darwin `/usr/bin/env` (hash recorded), with
isolated PATH bash/sh symlinks to that profile's actual executable. Thus the
GNU5.3 parent is not falsely credited for an implicit /bin/bash3.2 child.
Headerless files run through each parent Bash's genuine fallback. Native argv0
is shell; startup files disabled; environment scrubbed; canonical isolated cwd;
en_US.UTF-8 locale; three-second process-group deadline and256KiB output bound.
There are no fixed /tmp-only expected outputs: raw evidence is committed.

Primary source references inspected: GNU Bash5.3 `doc/bashref.texi` Command
Search/Execution and Shell Parameter Expansion (lines3695 and2620), and
`execute_cmd.c` shell_execve/initialize_subshell; GNU coreutils9.7
`doc/coreutils.texi` env split-string/shebang explanation (lines18147 onward).
Official GNU manual pages were requested; local pinned primary sources supply
the inspected definitions. Source hashes respectively:
`f3d37d57a1061e24d266051de9bd47ffa43dc86584afea11576c535ad2be32d5`,
`edca6ab242353ca928d2d991eb5cd92d6267b6be39f990aac6532263bfe0548d`,
`39b126752866fff675e462bd44d76f3e034abafe462a069cebd53ef39fc53eca`.

## Validation and preserved failures

- New58/58 TAP tests:45 native-backed cases plus13 host tests. One bounded
  host child contains10 safety assertions, not10 additional TAP cases.
- Existing env31/31, current-shell43/43 leaves (44 with parent), source/eval86/86.
- Legacy415:414 pass,1 preserved failure. The unchanged independent72 holdout
  `path-headerless-policy` expects former intentional126 rejection; actual is
  native-backed0 and `native-fallback\n`. Thus71/72 +132/132 +211/211. This
  needs a separately authorized expectation review, not a weakened assertion.
  Separately inspected old `script-entrypoint.test.ts` plain/env rejection
  expectations also conflict with newly authorized behavior; not edited or run.
- Final global/build/benchmark noEmit exit0 on guarded1055/296/411 input
  snapshots, no source drift/import mismatches or unlisted compiler paths.
  Initial owned optional-profile type error is retained; the final fallback
  defaults an absent internal profile to bash. No foreign type fixes/retries.
- Initial fallback15/15 red and env/parameter29/30 red are retained in compact
  validation evidence. Initial parameter19/20 had one author harness duplicate
  name lookup (`empty` across groups), fixed by using group+name, without native
  changes. All old/independent tests and native evidence remain untouched.

Reproduction from repo root:

```sh
node --import tsx tests/shell/expanded-gaps-harness.ts capture > /tmp/new-expanded-native.json
node tests/shell/expanded-gaps-verify.mjs /tmp/new-expanded-validation.json
```

Verifier output filename must be fresh. Snapshots are worktree-qualified, not
whole-product acceptance. Original9 historical, custom5 first-read, env-output
double-accounting, BOM/jq and frozen expanded-seven were not rerun or waived.
No independent `tests/shell-stress/expanded-gaps` expectations were inspected.
Source freeze and exact three commits are reported to root in the READY file.
