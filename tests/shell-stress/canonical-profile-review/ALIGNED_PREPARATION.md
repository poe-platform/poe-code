# Aligned native preparation — August 27, 2026

This additive, root-approved preparation does **not** accept the candidate.
The author is still writing; no live candidate, modified canonical test, or new
author helper was read or executed. Only immutable proposal README at `ab02ed8`
was consulted. All twenty files of the independent `a48b1e9` checkpoint remain
byte-immutable. No product execution, source edit, typecheck or full gate occurs
in this phase.

## Uniform profile, actual captures

All **88** original frozen inputs are selected unchanged from `inputs.json`:
72 differential, five syntax, eleven current-gaps. Every row, in each complete
pinned native profile, uses exactly:

```text
OS argv0: bash
argv: --noprofile --norc -c ORIGINAL_SOURCE shell
```

There is no source rendering, diagnostic prefix replacement, status rewriting,
per-case oracle selection or virtual `bash -c` wrapper. This uniform name is
ROOT's declared canonical invocation profile, not a selected per-row repair.
The native subprocess environment is scrubbed: PATH `/usr/bin:/bin`, HOME and
TMPDIR the isolated native cwd, LANG/LC_ALL `C`, TZ `UTC`, original row env
(empty for these88). Original stdin bytes and fixtures are unchanged. Each row
records exact source/hash, args, executable, cwd, env, stdin, initial files and
final relative effects including modes and all raw stdout/stderr bytes/status.
Native cwd corresponds to original virtual `/`; no output paths are normalized.

Pinned binaries:

| Whole profile | Executable | SHA-256 |
| --- | --- | --- |
| GNU5.3 primary | `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash` | `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c` |
| Apple3.2 historical | `/bin/bash` | `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3` |

Full actual `--version` bytes and executable realpaths/hashes are recorded, as
are `/bin/cat`, `/usr/bin/head` and Node identities. This is Darwin native
evidence, not GNU/Linux environment-order evidence. Native umask is checked
as022; the process does not change it. Each child is a detached process group,
with a five-second deadline and combined one-MiB output cap; the existing pinned
helper kills remaining group members on close and verifies group absence.
All scratch directories are removed. All176 rows complete without timeout,
overflow, signal or surviving group.

The existing frozen `control/name-line` is also run once on each profile with
the same `shell` name: **two separate controls**, not two additional cohort rows.
Its actual stdout proves `$0=shell`; raw line/diagnostic differences are retained.
The phase executes **176 native cohort observations +2 existing controls**, plus
two version calls; **zero product runs**. An initial driver attempt failed at
Git-blob preflight (`ENOBUFS`, default one-MiB Git capture limit), before any native
case, tool-version call or product execution. Increasing that evidence-reading
buffer to64MiB was the only driver correction; no native-result retry occurred.

## Reused product, exact counts

The **same88** original DIRECT `Shell.exec` observations from
`baseline-6e3e316.json` are reused, producing176 comparisons. They are not88 fresh
runs or a new product denominator. The complete archived product source remains
`6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a`, broad `src/index.ts`, real standard
registry, with original per-run before/load/after guards. No live source overlay
or current live-product claim is made. The saved `launch.args` field includes
unused rendering metadata `shell-stress`; the actual original actor runs
`shell.exec(row.source, ...)`, not those args. Actual source and empty invocation
call records are checked. Old named-wrapper status127→1 findings are untouched.

| Cohort | Rows | GNU original fields | Historical strict fields | GNU complete tuple | Historical complete tuple | Mode-loss rows, each profile |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Differential | 72 | 72 | 67 | 38 | 33 | 34 |
| Syntax | 5 | 5 | 0 | 5 | 0 | 0 |
| Current-gaps | 11 | 11 | 7 | 5 | 4 | 6 |
| **Total** | **88** | **88** | **74** | **48** | **37** | **40** |

Original differential/gap assertions compare complete stdout, stderr, status
and relative file bytes/types, not modes. Syntax originals require status2,
empty stdout, nonempty stderr and no effects; these five assertions pass on the
saved product while their historical strict diagnostic bytes differ. Thus
historical **original assertion shape is79/88**, whereas strict captured tuples
excluding modes are74/88. No loss is silently converted to an exact native pass.
All40 supplementary mode-loss rows remain visible (34 differential,6 gaps);
GNU full-mode exact parity is only48/88. This is not an FS waiver or FS fix.

The two prior wrapper-finding programs now match actual GNU status127 and exact
diagnostics under the unchanged direct product entrypoint. No source/status
change was made. Both the earlier native338 capture and role-corrected338 capture,
their protocol distinction, and all257 prior product observations remain intact.
These new aligned176 native observations do not overwrite either native history.

## Candidate review criteria — deferred until ROOT relay

- Preserve the routed **27 total =25 historical-profile +2 truthful-label**
  inventory. Canonical discovery is52 GNU comparisons +8 hosts, with strict
  historical52 separately executable at its preserved36/52 baseline, not folded
  into a misleading235 canonical denominator. ROOT's canonical total is183.
- Compare all88 source/stdin/fixture/env identities with frozen originals and
  this uniform `shell` native protocol. Keep direct public `Shell.exec`, complete
  stdout/stderr/status/file assertions and existing syntax controls; no wrapper,
  source mutation, status allowance, stderr discard or broad golden rewrite.
- Keep the two safe-plugin rows' full explicit truthful tuples distinct from
  actual native builtin tuples. Retain native raw classification losses. Do not
  spoof registry commands as native builtins or normalize arbitrary labels.
- Inspect exact candidate commits only after ROOT relay. Then execute the four
  canonical files, separately execute strict historical52, and inject negative
  controls into actual candidate assertion paths: status-only/stderr-discard,
  byte/file/mode loss, source/name/profile switching, mass-golden mutation and
  label spoofing. Earlier12 independent checker mutants are not candidate proof.
- Later scoped TS and one qualified global check are still pending; none ran
  here. Separate unrelated failures and live dependency drift from this frozen
  source baseline. No cold-build workaround or Linux-env-order profile switch.

OLD9, custom-first-read five1200ms requirements, old30/36 and52/57, accepted
errexit/accounting, broad kernel/public-consumer/fullgate remain separate and
unrerun. No native parity, superiority, full Bash or current global-green claim.

## Evidence and reproduction

`aligned-native-20260827.json` holds raw native captures, before/after frozen
input proofs, tool hashes and cleanup. `aligned-comparison-20260827.json` binds
those captures and unchanged saved product evidence and retains every comparison.
`aligned-freeze.json` binds all new phase files. The capture driver rejects an
existing output path rather than replacing evidence.

```sh
node tests/shell-stress/canonical-profile-review/aligned-native.mjs aligned-native-new-run.json
node --test tests/shell-stress/canonical-profile-review/aligned-integrity.test.mjs
```

The first command is an explicit future native replay, not needed for candidate
review; it never runs product. The committed comparator uses the fixed dated
capture and refuses to replace its existing result. Preparation ends with an
atomic owned-files-only commit and ROOT handoff; no candidate polling follows.
