# Hidden errexit: isolated committed-source acceptance

**Accepted for this frozen cohort against source commit
`6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a`, not against the moving live product.**
ROOT explicitly authorized one isolated recovery after the stopped initial
attempt. The recovery ran once on 2026-08-27, with no product/source changes,
case changes, oracle changes, output normalization, or further retries.

## Counts and immutable history

| Complete comparison profile | Exact and guard-valid | Retained losses |
| --- | ---: | ---: |
| GNU 5.3, Bash role, C | 54/54 | 0 |
| GNU 5.3, POSIX sh role, C | 54/54 | 0 |
| Apple Bash 3.2, Bash role, C | 51/54 | 3 |
| Apple Bash 3.2, POSIX sh role, C | 51/54 | 3 |
| Independent host contracts | 4/4 | 0 |

**108 unique product executions** (54 per role) were compared to both complete
frozen reference profiles: **216 comparisons, not 216 product executions**.
Four host contracts ran once each. All **112/112** execution/import guards are
valid. GNU primary is **108/108**; historical is **102/108**, with six exact
losses retained. There were no missing observations, skips or unsupported-as-pass
classifications. Primary success here is not a claim of historical equivalence.

The original ten files at `aef76d0cede4804513200ec71d572ca99240ca0f` and six
initial files at `17bbd47d3b7d1c372312ab45bb0f250fef68e0d9` are byte-immutable.
The initial foreign-drift/import failure remains exactly as reported in
`ACCEPTANCE_INITIAL.md:10`: six guard-valid successes, one drift-invalid raw
success, and 105 import-blocked attempts. Those first six successes are **not
added to these new scores**. Initial findings were not overwritten or reclassified
as a source defect. This is a disclosed separate archive profile, not a green
rewrite of the live-source attempt.

## Full committed archive and isolation proof

Capture interval: **2026-08-27T05:58:15.769Z–2026-08-27T05:58:54.221Z**.
The archive contained **all 173 committed source files**, plus the unchanged
committed `package.json`, `package-lock.json`, `tsconfig.json`, and
`tsconfig.build.json`: **177 extracted Git files**. Every extracted path was
checked against its Git blob ID and SHA-256 inventory; committed file modes are
also retained. No live source file was copied or overlaid. The exact extraction
inputs were:

```sh
git archive --format=tar 6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a src package.json package-lock.json tsconfig.json tsconfig.build.json
```

Tar SHA-256:
`a8397a9a7fa3d9a3b4480e1469a6b894cc89cd93b58f668e761505812bf3ab33`.
The temporary project was
`/private/tmp/safe-bash-errexit-committed-n6rj77/project`; it is now removed.
Git commit/blob IDs and all archive hashes remain in the durable evidence, so
reproduction does not depend on preserving a mutable temporary project.

The **broad archived `src/index.ts`** was imported via tsx and used with the
actual public `Shell`, `MemoryFileSystem`, `agentCommands` and registry. The
archive did not narrow exports to avoid the search dependency. Every execution
loaded **142 product files**, including the archived root export, command
aggregate, `src/commands/search/rg.ts` and `src/fs/webdav/webdav.ts`.
Each child has **166 actual file-module load records**, checked before and after
loading against its own phase endpoints and the archive/toolchain policy.

The added loader rejects live `src` paths/realpath aliases, out-of-archive
product modules and hash mismatches **before loading**, then rechecks each file
after load. No live-source alias or unlisted import was observed. All product
load URLs and resolved paths are inside the archive and match committed Git
blobs. Per-phase inventories cover **183 archive files** (177 extracted files,
five needed fixture/guard copies, one isolation policy) plus **314 existing
development-toolchain files**. Both inventories and the toolchain symlink
identity stayed unchanged across every before/load/after phase and the full run.

Only these test inputs were copied, each with commit/current/copy hash proof:
frozen `cases.mjs`, `host.mjs`, `native-frozen.json`; the **unchanged initial
`acceptance-product.mjs`** from `17bbd47`; and the new isolation-only loader.
The bounded process helper was reused read-only with pinned before/after hash
`d7b278db709f869a03e5cce56c501011a1162465b03ecfc1663465b0163c6f8a`.

The archive's `node_modules` symlink resolved to the existing
`/Users/kjopek/Workspace/safe-bash/node_modules`. No install, dependency, package
manifest or export change was made. Node **v22.22.2**, Apple Git **2.50.1** and
bsdtar **3.5.3** paths, versions and binary hashes are recorded. The symlink is
a disclosed development-toolchain dependency, not a source overlay.

Key source SHA-256 values:

```text
src/shell/runtime.ts
5589f60a1db983538d37168e3b9276555ef71a2bc67446783535e47789f9d6eb
src/shell/parser.ts
10d015eb62fd4e4f964666c04e5869ea78afdb76d930181760adecbcf16ab65e
src/index.ts
2257a1ce3acc146ca7a3c1867e8a23153a5a968c96899a533b45cea69a446237
src/commands/search/rg.ts
c677f831e8e9dcc5051713d894d277ffa9646d2de358c1970b2dd0a9dfb44417
```

The last hash is the valid **committed** rg dependency, not the later dirty
revision that broke the initial live import. Live HEAD changed from
`b8fe3a33be656489dc070ecc096992e4c5fd3bc3` to
`98a28f18f44b9170c81d97a88bf06f423674e143` during this run, with foreign source
edits also recorded. Those changes were **not imported** and do not invalidate
the isolated result; equally, this result does not verify those newer changes.

## Unchanged invocation and native references

All **216 native observations are reused**, with zero fresh native executions.
Their original capture dates, GNU 5.3/Apple 3.2 versions, actual Bash/sh roles,
C locale, role fixtures, hashes and control correction remain in the immutable
README/native evidence. Both native binaries, cat and the helper still matched
their frozen hashes before this recovery.

The product actor is byte-identical to the initial actor. It retains the same
primary cwd/environment mapping, stdin, source bytes, semantic flags, command
names and positionals, and records the real interpreter argv through middleware.
The uniform omission of native-only `--noprofile --norc` startup suppression is
the **same disclosed rendering as the initial attempt**, not a new adjustment.
Historical native temporary roots remain recorded in the frozen references;
they are not rewritten into the primary roots. Every relative effect file is
precreated 0644 and compared with exact bytes/modes/inventory, alongside exact
stdout, stderr and shell status. No builtin-role distortion is involved.

## Six retained historical differences

Each of the following three cases differs from Apple 3.2 **in both roles**.
Current archived results exactly match the corresponding GNU 5.3 reference.
The table renders raw bytes with escaped newlines; it does not normalize them.
All stderr streams are empty and all file modes remain 0644. Source fixture
files themselves are unchanged; complete tuples are retained in the artifact.

| Case | Historical status / stdout / trace bytes | GNU and archived current status / stdout / trace bytes |
| --- | --- | --- |
| E26, conditional dot enabling e | `1 / "" / ""` | `1 / "then\n" / "dot-ignored\n"` |
| E29, conditional eval enabling e | `1 / "" / ""` | `1 / "then\n" / "eval-ignored\n"` |
| E30, conditional source and return | `1 / "" / ""` | `0 / "returned=6\n" / "source-ignored\nafter\n"` |

These are exact historical losses, not waived tests or parser failures invented
to excuse an implementation bug. The uniform modern design profile does not
require reproducing those older source/eval behaviors.

## Independent execution and source review

The exact author source diff and matching committed implementation were reviewed
independently, after the original native freeze and first author READY. The
source audit in `ACCEPTANCE_INITIAL.md:124` remains historical; the previously
blocked hidden rows now supply independent execution evidence for the same
source identities, without treating author test counts as an oracle.

- All 54 cases per role match the modern exact tuple, covering stored option
  state versus dynamic ignored context, conditional functions including body
  `set -e`, AND/OR/negation, source/dot/eval and current-shell option changes.
- Subshell/group and pipeline-stage isolation are distinguished from aggregate
  last-status/pipefail handling. Both role-specific command-substitution
  behaviors, explicit return/exit, literal interpreter arguments and fresh-child
  option boundaries pass their frozen nearby cases. This is not arbitrary
  untested grammar coverage or an interactive persistent-session claim.
- H01 returns literal `<literal; false>\n` and status 1 through nested invoke,
  with no inner/outer trailing markers: no source-string reinterpretation.
- H02 retains its original `maxCommands:6` contract, records exactly **three**
  successful ticks, then `ShellLimitError(maxCommands)`, with no output or later
  marker. The author's separate source-budget threshold correction was not
  copied, applied or used to weaken this independent test.
- H03 records the original caller cancellation reason by identity, entered
  nested host work, delivered/observed the late rejection, no unhandled
  rejection, no output, and no subsequent marker.
- H04 returns pipeline status 7 after draining all **17 bytes**, including NUL.
  Both asynchronous sink writes completed before execution returned; buffered
  and external output match, with no stderr or trailing marker. This is the
  frozen bounded drainage contract, not an accounting-cohort rerun.

No new functional blocker was observed in this entire scoped modern cohort.
The source/loader guards validate these results against the committed archive,
not against the moving live source tree.

## Evidence, checks and limits

Raw report: `isolated-6e3e316-once.json`, SHA-256
`b557e56358903a1fe2557c2118540433a5128c2eb5e2bdcd167f05c750cd5b8d`.
It was saved **before cleanup**. `isolated-6e3e316-once-cleanup.json` binds that
hash to the cleanup receipt: all 112 bounded child groups absent, owned temporary
project removed. No timeouts, output overflow, SIGSTOP or surviving watchers.

Record-only integrity checks: **24/24** (original nine, initial seven, isolated
eight). Two new runner/loader syntax checks pass. These checks do not import
product code or repeat the native/product cohort:

```sh
node --test tests/shell-stress/errexit-holdout/integrity.test.mjs tests/shell-stress/errexit-holdout/acceptance-integrity.test.mjs tests/shell-stress/errexit-holdout/isolated-integrity.test.mjs
```

Reproduction requires explicit ROOT authorization for another run and a **new**
output path; the driver refuses existing evidence targets. It recreates the
full source archive from the pinned commit rather than reusing live source:

```sh
node tests/shell-stress/errexit-holdout/isolated-acceptance.mjs isolated-new-authorized.json
```

No original kernel36/72, public built consumer, legacy-policy tests, accepted
accounting, old-nine diagnostics, custom-five lifecycle or scalar C-byte cohort
was rerun. No creation-mask/lifecycle API, ERR traps, shopt/inherit_errexit,
SHELLOPTS startup, nounset, job control or full Bash claim is made. Shebang policy
is unchanged: existing direct Bash allowlist, zero/one literal optional argument,
no new direct sh allowlist, env-S explicitly unsupported, and the original
Darwin env-single protocol loss retained elsewhere. Scope acceptance is not a
full-product, latest-live, kernel-parity or superiority claim.
