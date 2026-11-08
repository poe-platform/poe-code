# Independent execution-guard scope review

## Decision

**YES, conditionally:** a separately committed, root-approved continuation of
only the eleven never-executed rows is faithful to the declared matrix, provided
the invariants below hold. **NO permission to execute is supplied by this review.**
The unchanged original runner must remain halted; its existing-record and
prior-failure guards also prevent simply rerunning it. Do not delete evidence,
overwrite its manifest, silently ignore errors, or retry a refused invocation.

This leaf performed text, JSON, Git and SHA-256 inspection only. No product,
regex, harness, syntax check, test, build, runtime-version probe or descendant
was executed; no delegation occurred. Ownership is this new report only.
The parent and repository AGENTS instructions were read; no additional scoped
AGENTS files were found under the reviewed test tree.

## Exact drift and historical classification

Reviewed freeze commit: `9653d91`; observed HEAD:
`98de827f9f8986f572532d750d3eb9d5ce1c0a86`. The working tree contains unrelated
concurrent changes, including additional uncommitted shell-runtime changes.
The index was empty when inspected. Original matrix evidence was untracked
while its owner finalized it. Before this report's commit, HEAD advanced to
`c116d637aa82e4b075460fc07088a5703a10e7b4`: that commit records the additional
shell changes, and `b0ff710b7177a4528d38aa3d92a531ada4f873ac` records the halted
matrix evidence. A final hash-only recheck still finds exactly the same single
drift and current digest below; the initially dirty shell bytes are now committed.

All 41 entries of `bounded-matrix/frozen.json` were independently byte-hashed:
**40 match; exactly one differs: `src/shell/runtime.ts`.** Here and below,
`bounded-matrix/` means `tests/stress/regex-execution/bounded-matrix/`.

| Observation | SHA-256 of `src/shell/runtime.ts` |
| --- | --- |
| Frozen manifest, 2026-08-27 04:00:00.473 UTC; also freeze-commit blob | `c7c9d02ddde5576b7810bfecbbd21b70c6eb2c0ea4fe1ee8bee92c21946d8449` |
| Owner's after-snapshot, 2026-08-27 04:01:11.011 UTC; also observed HEAD blob | `a2a10bb7b34c4bb9da74348753d51cc1ad316727b161840d6594073df8b02d38` |
| Working-tree bytes inspected for this review | `f307642e52c3bfeb5df64057fb26af6645135bb5bdc307f399de6ce1541c0ddb` |

Commit `22ca649` changes shell function/substitution diagnostic source names;
additional dirty changes propagate substitution diagnostic lines. These are
**real executable shell-code changes**, not merely comments or documentation
edits. However, that file is only a static source/contract observation in this
particular direct-command experiment: neither child imports or executes it.
Do not generalize this conclusion to Shell-based tests or whole-product parity.

The raw second parent attempt throws `Frozen source/runtime drift; stop` at
`run.mjs:23`, before the spawn at line 32. This is a legitimate prelaunch guard
halt, not a product stall, watchdog termination, or regex measurement.
The raw exception does not enumerate mismatches; its identification with the
shell file is supported by the owner's subsequent snapshot, not an invented
atomic failure-time snapshot. That snapshot retains the original Node/V8/path
identity and has exactly this one file mismatch.

Original ledger remains: 12 declared rows = 4 controls + 8 risky; two parent
attempts, one child, one completed benign matching grep control, one selected
native exec, zero risky executions, one prelaunch halt, ten explicit skips,
zero parent kills, and zero active owned children. The first child's five
cleanup fields are true. None of the halt/skips becomes a pass. Risky exposure
is still unmeasured and the original matrix is incomplete.

## Direct execution closure

Static import/re-export inspection establishes the following source-loading
closure (not a newly measured loader trace):

- Both tools load `src/contracts/index.ts`, whose ordinary `export *` edges
  load `command.ts`, `errors.ts`, `filesystem.ts`, `io.ts`, `path.ts`, and
  `plugin.ts` in that directory. **These contract TS modules stay hard-guarded**;
  do not demote them because their directory is named contracts or because
  some declarations erase during type stripping.
- Grep additionally loads `src/commands/grep.ts` and
  `src/commands/internal.ts`; the latter imports contract values. Its own
  type-only contract import does not eliminate that executable dependency.
- Rg additionally loads `src/commands/search/rg.ts`, `matcher.ts`, `options.ts`,
  `output.ts`, `shared.ts`, `walk.ts`, and `glob.ts`. It does not load grep or
  `internal.ts`. Thus grep's repository closure is 9 files, rg's is 14, and
  their union is exactly the 16 `productFiles` entries.
- Product builtin edges are `node:path`, `node:util`, `node:stream/web`,
  `node:buffer`, and `node:timers/promises`. The parent uses builtin
  child-process/fs/performance/url plus `cases.mjs` and `snapshot.mjs`;
  snapshot uses builtin crypto/fs/url and cases. The child uses builtin
  synchronous module hooks/performance plus cases.

The child resolves only those 16 TS paths (including `.js` aliases) and five
builtins during its fixed dynamic entry import. No shell, registry aggregate,
root `src/index.ts`, filesystem adapter, text-programs module, prior harness,
tsx/esbuild loader or package dependency appears in the closure. Inspection
found no product dynamic import, require, eval, Function constructor, process
spawn or worker edge. The parent has one explicit `spawn`, `shell:false` and
`detached:false`; no hidden source-loading descendant is present in the
reviewed source. Hooks deregister after setup, so their allowlist is **not**
a permanent sandbox: this finding depends on preserving the inspected code.
The inert injected FS and explicit stdin paths prevent reaching host FS hooks.

The 20 hard-guard source files should be the 16 product files plus
`bounded-matrix/{cases,child,run,snapshot}.mjs`. All 20 match their original
manifest hashes at inspection. Key unchanged identities:

| Path | SHA-256 |
| --- | --- |
| `src/commands/grep.ts` | `5e5255a1cce15bfa57f1ba4ffd46e5b4ff7810c37aba8522fd50cdb482edba3d` |
| `src/commands/search/rg.ts` | `c677f831e8e9dcc5051713d894d277ffa9646d2de358c1970b2dd0a9dfb44417` |
| `src/commands/search/matcher.ts` | `499848186cde72bd696cba1fc7d53af39354ba74ea63c42acd92d5eb1cda1cfb` |
| `bounded-matrix/cases.mjs` | `99a5392e48f0602599dc8da88400ff5f9c34781fe608b320250a0486178df7be` |
| `bounded-matrix/child.mjs` | `c2f3c0c9c0382260d10dbefe600f34c60d1746ac36fbb91b06e30acb2aa8428e` |
| `bounded-matrix/run.mjs` | `fd9ee1186344e94c907476f1f2d27493eb9cb7ade0cbee4a934f54ff510043c9` |
| `bounded-matrix/snapshot.mjs` | `4086ae716ee1d8c65c7ffeb38d573957bb543d4145c565efcdd8d69533dc0254` |

All remaining 21 manifest entries are non-loaded observations for this matrix:
the commands/search/text-programs READMEs; `src/contracts/command.md`;
`src/shell/{types,runtime}.ts`; `src/commands/text-programs/{regex,shared}.ts`;
the regex-execution `REPORT.md`, `RESEARCH.md`, `SOURCE_MAP.json`;
staged-controls `supervisor.mjs`, `README.md`, `REPORT.md`;
single-grep `fixed-case.mjs`, `child.mjs`, `run.mjs`, `README.md`, `REPORT.md`;
and bounded-matrix `README.md`, `commands.txt`. Prior harness code and unrelated
product TS here are source evidence, not literally documentation-only files.

## Runtime identity limits

The frozen and after manifests both record Node `v22.22.2`, V8
`12.4.254.21-node.39`, Darwin arm64, no NODE_OPTIONS, and executable
`/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node`. The current command path
matches and NODE_OPTIONS is unset. Without invoking Node, its present bytes
hash to `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
**No historical executable-binary digest was frozen**, so historical binary
identity cannot be proven from version/path strings. No runtime drift is
evidenced; retrospective binary stability is not established.

`package.json` is module-resolution metadata, not executed JS, but its
`type:module` affects TS loading. It is absent from the original manifest.
Its freeze-commit, observed HEAD and current bytes all hash to
`216554f6115e7254b471b1e3b91319e516a80682b59a0b7fe6d8df16b2cb164b`;
no nested package.json was found in src or the regex-execution tree. A new
manifest should hard-guard this package boundary and detect newly introduced
nested package boundaries, as well as pinning the executable digest. This
does not establish OS/shared-library immutability or an atomic filesystem snapshot.

## Fixture mapping checked without execution

`cases.mjs` uses grep `['-E', pattern]`; expression translation leaves these
two literal patterns unchanged, and construction uses flags `g`. Default stdin
is consumed as one unterminated ASCII line, converted to latin1 unchanged.
Normal non-`-o` matching returns after its first success; nonmatches make one
selected native exec. No file operand or pattern file is introduced.

Rg receives `[pattern, '-']`, default sensitive/nonfixed/nonword/nonwhole line
mode. Its matcher wraps the one pattern as `(?:${pattern})`, flags `gu`.
The walker yields explicit stdin before stat/ignore traversal. ASCII decoding
preserves the exact subject; the full fragment reuses the main regex.
`searchFile` requests `all:false` in this mode, so success returns immediately.
Thus the selected source/flags/subject tuple matches the current native call,
including for both controls; it is not accidentally waiting for a different
flag set or a newline-extended subject. Other incidental regex calls are not
counted as selected executions.

Preserve controls `^a+$` on `aaaa` / `aaaa!`, with status 0 / 1 and stdout
`aaaa\n` / empty, empty stderr, native match / null, one selected exec.
Preserve risky `^(a+)+$` on exactly 16/20/24/28 `a` bytes followed by `!`
(17/21/25/29 bytes, no newline), status 1, empty streams, native null, one
selected exec. The original shorter historical regex probe is not retried.

## Minimal guard split and required continuation invariant

1. Root must explicitly accept this scope classification and the separately
   committed continuation protocol/manifest; the owning leaf implements it,
   not this reviewer. Freeze original evidence first. Keep the original
   manifest, completed row, exact halt output and all ten skips byte-for-byte.
   A new namespace links them by hashes and records eleven new opportunities,
   not twelve reruns. Carry the first completed control as historical evidence,
   not a newly executed pass. No continuation after any new denial/refusal.
2. Separate `executionHashes` from `observationHashes`. The former includes
   the entire actual closure, all continuation guard/harness code and loading
   configuration; hard-fail missing, added-unreviewed or changed dependencies,
   Node/V8/path/binary identity, or fixed-flag/environment mismatch before
   spawning. Compare again after complete cleanup. Include any new continuation
   script in the manifest. Approved guard/evidence-selection edits are a new
   harness identity, never claimed identical to the original harness.
3. Keep all 21 observation hashes and report old/frozen/current values and
   drift separately before/after. Unrelated observation drift must not be
   called executable drift or a measured stall. Do not retain a misleading
   whole-source `sourceStable:true` when observations changed. Newly observed
   executable drift or a changed import/loading closure requires another stop
   and review, not automatic reclassification or rebasing.
4. The continuation ledger must bind original terminal records and allow only
   the unexecuted IDs, in original order: three remaining controls, then grep
   16/20/24/28, then rg 16/20/24/28. Reject any ID with a prior launched child,
   even if it failed or was killed. Original nonlaunch halt/skip records remain
   immutable and are explicitly superseded only for new scheduling. Never
   blanket-ignore arbitrary prior failure/drift, reset family stops, or erase
   the no-repetition check. All four controls must have completed evidence
   before any risky row. Retain eight total matrix risky invocations, already
   stricter than the user's twelve-risky ceiling; do not consume spare ceiling
   with extra rows, controls or repeats.
5. Keep timing and isolation unchanged: one child at a time; 1,000 ms startup;
   200 ms after-ready execution deadline armed before start and retained until
   the five-event closure barrier; exact child-handle SIGKILL only; 1,000 ms
   cleanup warning fails and continues waiting; family stop at its first
   execution watchdog; any setup/control/harness failure stops the cohort.
   No timeout extension, replacement child, process-group kill or new probe.
6. Preserve flags `--unhandled-rejections=strict`, `--max-old-space-size=64`,
   `--max-semi-space-size=1`, `--stack-size=512`, and child-only
   `--experimental-strip-types`, `--no-warnings`; clean LANG/LC_ALL C env;
   1,024-byte stream/product/observation bounds, 4,096-byte parent output cap,
   five 128-byte IPC tuples, strict protocol, child-local 5 ms abort timer,
   same-command Promise.race, exact fixtures/expectations and second-selected-
   exec rejection. Do not turn these limits into RSS or hard-real-time claims.

This is a justified guard-scope correction, not grounds to relabel the original
halt as a false failure or to claim whole-source stability, shell coverage,
regex safety, cancellation guarantees, parity, superiority or completion.

## Preserved evidence anchors

| Original artifact under bounded-matrix | SHA-256 at inspection |
| --- | --- |
| `frozen.json` | `26251cb53797f16bb87310d9d52a2ab763584b315032006bd8cdcaa0f1459aa1` |
| `evidence/after.json` | `d875e808b7f7bba2db8f48f89b2cfd672e051809170f3cdce0efbfde72ca0b82` |
| `evidence/grep-linear-match.json` | `9b31e3a617caa3e757382f44f93b3b05b43fc35fc81abab975f7e052ea9f2228` |
| `evidence/grep-linear-nonmatch.json` | `ff0d9c7d7a210029c537ed827bf24cdbfb0bfc2ad2ead8b809831cd7cca74921` |
| `evidence/grep-linear-nonmatch.tool.txt` | `34abeb7f34ab29d6c33acf4704129c038faa5d4cd3cb5f10f48ebec157635aac` |
| `evidence/summary.json` | `b14361a8294225e0ad25311e0ef2391d11c9007aa006ba053316548bcc6f57c1` |

All ten skip JSONs were also read and hashed; each has null pid and
`prior-source-drift-stop`. Sequential inspection cannot rule out intervening
concurrent edits. Recheck hard dependencies against the committed continuation
manifest immediately before any separately authorized execution.
