# Why the b494 gate ran the prospective env-S tests

Thursday, August 27, 2026. Additive clarification of accepted classification
`106e2951da6c8a0ea033eb7626e167400c5b19da`; its six files remain byte-identical.
**D84 and zero fixture migration stand. No product/native execution is added.**

## Exact cause: the selected commit predates implementation

| Commit | Full Git parent |
| --- | --- |
| Preparation `db3680fcfa91a7fff6ca0dad332c297094d14783` | `862fdc544a0daa663735bfbe1dc965c495e17a67` |
| Selected gate `b494675c34dc289f4ad4b10a9201e1211eb0a7d8` | `5356008419940cf5b3a1e67a0812df803ef32e6c` |
| Feature `84ab66ca717e0dff21abf57051b41cb553f3c7f3` | **`b494675c34dc289f4ad4b10a9201e1211eb0a7d8`** |

`git merge-base --is-ancestor` returns **1** for feature→gate and **0** for
gate→feature and preparation→gate. Thus 84ab is absent from b494 ancestry;
b494 is its immediate parent. The prospective tests were committed earlier,
not introduced by the feature commit.

At evidence commit `954406871fae381b1c69441b34946a224201d7ad`, the actual
`combined-b494675c/run.mjs:18` explicitly asserts that b494 is the handoff.
Lines 98–109 archive the **entire selected Git commit**, extract it, and check
each file's size and Git blob before recording `sourceHashes`. This is not a
source-only archive followed by live-test copying. The raw report records:

- Source root: `/private/tmp/full-gate-execution-BtyW8C/source`.
- Archive SHA256: `a86aa83232e4693ca91410042520bcad9f97197486adedf8a46a263aee93a78c`.
- Live HEAD at launch: `bb0647619e73085f1c9bfe5dccefcdba6522e81c`; it is not the
  selected source. Its untracked work is not evidence of a test/source overlay.

The raw report's discovery blobs **and actual extracted-file hashes** match
the following files in b494. Each is also byte-equal at db3680fc and 84ab:

| Input | SHA256 in Git and actual copied input |
| --- | --- |
| `tests/shell/env-split-native.test.ts` | `20191b28aaeb2abf249814f709722f9812840d2faef2afd46a7a29382487b433` |
| `tests/shell/env-split-host.test.ts` | `f0a9ff72bb7a9565b6441c5a1126d8f4d4719ccbbaa3e31a67ccaec679ff227a` |
| `env-split-author/resume-fixtures.ts` | `80b3ee0109c6cd60245594b5f84325ae92b601c7f9b45dcee9d34d3adc173f8c` |
| `env-split-author/resume-host.ts` | `c22482b06a27a6883bf1d6f6dac98e8a83795495c452772869e3b5a03b3135ce` |
| `env-split-author/native-frozen.json` | `78454386eeddec592bbdd79128696434fac3c19b862866b89684a2e3747c4a21` |
| `env-split-author/resume-native.json` | `f0d9a0c1f6c984f0b2d172fd8d938ec5af3910e624468ab67eedead0f4204416` |
| `env-split-author/resume-cases.json` | `d6e0ea65b61eb91d873103455824a4fbb57ddf1564909f71819d7ae05c755ea2` |

The shortened helper paths are under `tests/shell-stress/`.
`binding-machine-proof.json.fileBindings` retains full paths, all three Git
profiles, blob IDs, sizes, copied-file metadata and post-test change checks.
Neither canonical file was omitted from actual discovery.

Old execution SHA256 is
`1d084ab203dc59a510e39e5c71743b755ba9bdb5d4b018658398ed96c3dff700`;
84ab execution is
`61940d3b86593243c13cab716be87f84647e42b69476757482dfebafc7d693a6`.
The old command accepts `iu:0C:`, not S. `src/commands/env-split.ts` is absent
from db3680fc/b494 and their copied gate inventory; at 84ab its SHA256 is
`b005331bff0dd207a65b9001d235020f005eed45b813cca912851502c3f9dcf4`.
The full b494→84ab source diff is only that new parser and `execution.ts`.

## Actual loader evidence, distinct from archive proof

Both helpers statically import `../../../src/index.js` relative to the archived
helper. Neither reads `process.env` or selects a snapshot root. The host parent
spawns its adjacent `resume-host.ts` with `--import tsx`, preserving inherited
`NODE_OPTIONS`; it does not call the historical `resume-verify.mjs` replay driver.
The adjacent native JSON files supply **expectations**, not product code.

The actual runner installs a hash-bound `NODE_OPTIONS` import guard for the test
phase. The committed, losslessly encoded resolution logs provide these witnesses:

- Native test **PID6593**: resolves `env-split-native.test.ts`,
  `resume-fixtures.ts`, scratch `src/index.ts`, `src/commands/execution.ts`, and
  `src/shell/runtime.ts`, with the b494 hashes.
- Host test parent **PID6588**: resolves `env-split-host.test.ts`.
- **All 25 host processes**: resolve the adjacent `resume-host.ts` and that same
  scratch index/execution/runtime. Each PID is also present in the recorded
  process supervisor with its literal scenario argv and parent PID6588.
  Example: PID6639 runs `resume-host.ts real-nested-pipeline`.

The machine proof authenticates all 716 test-phase import logs against the
committed evidence manifest/Git blobs, examines 50,230 resolution records, and
retains the relevant records and process observations for all 27 cohort PIDs.
No `dist/` product path or env-split parser appears in those cohort logs.
The canonical actual-TypeScript import assertion also passes in original TAP.
An earlier successful build therefore does **not** mean these tests used dist.

The actual old index hash is
`05af12d657d7d485958ffe22499181993de98c729dadbb9dac347a822fca863e`.
Runtime is unchanged at
`2223ef9e02565d163ded042d933553a1efae502ce7531fe83bba5611d959c84b`.
The source chain is index→plugins/commands→`executionCommands`, and
index→shell→runtime, not a second old-source loader hidden in a fixture.

**Proof boundary:** this gate's `registerHooks({ resolve(...) })` records actual
resolved realpaths and on-disk hashes. It does not record parent-specifier edges,
transformed tsx JavaScript, a load-hook/evaluation trace, or an immutable execution
lease. Archive/input bindings and actual resolution/process/TAP evidence support
the source-selection conclusion; they do not certify every runtime instruction.
The gate remains **UNQUALIFIED: 16,520 pass, 307 fail, 13 skip**. Its recorded
post-test mutation is the unrelated direct-curl artifact, not any of these inputs;
missing native prerequisites likewise remain a harness qualification failure.

| Suggested cause | Evidence-bound disposition |
| --- | --- |
| Feature absent from selected ancestry | **Confirmed; decisive selection cause.** |
| Dirty/new tests overlaid on old source | **Not this cohort:** all seven actual copied inputs match b494 Git. |
| Helpers silently load a historical snapshot | **No:** fixed candidate-relative imports, no env-root selector, actual b494 TS resolutions. |
| Built/stale dist used by these tests | **Not observed:** all product witnesses are scratch `.ts`; no cohort dist resolutions. |
| Expectation migration required | **No:** original D84/zero-migration classification remains unchanged. |

## Exact accepted core integration: a different reviewer and execution

The authority is committed **`8ab677479e0094ec0c6cdf90d1f0e87883b2f8dc`**,
`env-split-validity-review/V2_REVIEW.md`, not this clarification or author scores.
Product is exact **84ab**; author fixture commit is
`8b6bcf83745727a45232c96de79a030fe98fb388`; independent pre-execution freeze is
`fbd4a2c4c8c8215bbc04a1ab923af47e1bd64d22`.
Reviewer `01a042ef-2082-7a20-a1b5-c3ba7235ff76` differs from the recorded
versioned-fixture author `01a042ee-bfce-7b80-b667-af14bd426f64`. These are the
roles identified by the committed v2 review; they do not separately identify
the original source implementation's thread. This clarification author neither
implemented source84ab nor performed that independent acceptance.

| Fresh independent v2 partition | Exact result, without pooling |
| --- | --- |
| Hidden GNU env9.7 / Darwin / Bash5.3 commands | **39/42 strict native**, plus **3/3 separate virtual-diagnostic checks**; not 42 native passes |
| Same entire hidden profile | **40/48**: commands39/42 + protocol1/6 |
| Hidden Apple-env / Bash3.2 entire historical profile | **23/48**: commands22/42 + protocol1/6 |
| Revised hidden hosts | **7/7** |
| Packed supported core, each complete reference profile | **7/7** |
| Packed entire native cohort, each profile | **7/10**, retaining all three protocol losses |
| Packed hosts | **5/5 executions in three IDs** |
| Additional author-defined policy/input controls, executed by reviewer | **12/12** |
| Different reviewer's predeclared C1–C6 controls | **6/6 groups; 14/14 runtime variants** (2,3,4,2,1,2) |

Packed profiles use **GNU env9.7 in both**; only Bash parent changes between
GNU5.3 and Apple3.2. Packed “historical” does not mean Apple env. Hidden historical
does use Apple env. No per-row oracle switch or merged profile is applied.

The author v2 run has **117 product /121 total children**. The distinct fresh
independent run has **191 product /195 total children**, August27
11:53:45.811–11:54:30.838 UTC. These are not extra passing-test denominators and
are not the canonical89 replay. The machine proof rechecks all 220 archived
source/root hashes against 84ab and all 191 loaded manifests: **174 compiled JS
files each, 33,234 loads**, matching emitted/packed/installed hashes. Actual
consumer `load` hooks admit only the physically moved package's `dist/*.js`;
there is no source/tsx fallback in this independent profile.

The original genuine tarball SHA256 remains
`3ac9f899fbabb14e0473a9345113642fbfd2d12ac6e957659695b6b9e2fbac8c`
(630766 bytes). There are 708 emitted and 710 installed package files; the old
installation path is absent. Raw independent acceptance SHA256 is
`c3d8d510ccddfd0457b506e0741507000b1fe4bdb49f80c5edebe955667ce81d`.
All 195 groups are absent at post-audit, scratch is removed, and watchdogs,
timeouts and overflows are zero. The new proof records exact public resolution
URLs and compiled index/runtime/execution/parser hashes separately from TS hashes.

## Three retained strict diagnostic losses

The following are literal argv arrays. `\n` denotes exactly one LF. stdout is
empty throughout. Native and virtual status/effects match; stderr does not.

1. **`packed-non-s-single-operand`**, `['env', 'argvprobe two words']`, status127:
   native `env: 'argvprobe two words': No such file or directory\nenv: use -[v]S to pass options in shebang lines\n`;
   virtual `shell: line 1: argvprobe two words: command not found\n`.
2. **`missing-command-negative`**, `['env', '-S', 'env-split-never-a-real-command argument']`, status127:
   native `env: 'env-split-never-a-real-command': No such file or directory\n`;
   virtual `shell: line 1: env-split-never-a-real-command: command not found\n`.
3. **`nonexecutable-command-negative`**, `['env', '-S', './nonexec argument']`, status126:
   native `env: './nonexec': Permission denied\n`;
   virtual `shell: line 1: ./nonexec: Permission denied\n`.

All retain file `effect` = `original`, mode0644. The third also retains
`nonexec` = `not executable\n`, mode0644. No target succeeds and no new effect is
credited. Raw base64 tuples, input hashes and decoded text are in the machine
proof; these remain three **strict native losses**, not grammar failures or
builtin-equivalence claims.

## Protocol limits: five hidden and three packed losses

Hidden primary is the original **single-optional-argument** reference:

| Hidden ID | Literal env header suffix | Current / native status |
| --- | --- | --- |
| `non-s-packed-bash-option` | `bash -e` | **126 /127** |
| `split-errexit` | `-S bash -e` | **126 /1** |
| `split-assignment-and-clear` | `-S -i MARK=kept bash -e` | **126 /1** |
| `split-long-plus-option` | `--split-string=bash +e` | **126 /0** |
| `split-quoted-marker` | `-S MARK="two words" bash -e` | **126 /1** |
| `plain-bash` (binding control) | `bash` | **0 /0**, **zero feature credit** |

All five losses have current empty stdout, an unsupported-interpreter diagnostic,
and unchanged `effect=original`/0644. Exact absolute commands, both full byte
tuples and native effects are retained in `hiddenProtocolRows`; no failing row
is dropped. The plain binding control accounts for protocol1/6, not env-S support.

Packed references retain actual Darwin-kernel semantics, with their explicit
single-optional controls kept separate. In **both** whole packed profiles:

| Packed ID / original command | Native `(status, stdout, stderr, phase)` |
| --- | --- |
| `shebang-split-bash-errexit` / `./script "a b"` | `(1, '', '', 'before')` |
| `shebang-long-split-sh-argv` / `./script "a b"` | `(0, '<./script>\|<1>\|<a b>\n', '', 'kept')` |
| `non-split-header-one-argument` / `./script` | `(0, '', '', 'reached')` |

Every current packed tuple is `(126, '', diagnostic, phase='seed')`; phase mode
is0644 in every native/current tuple. Diagnostics are exactly
`shell: line 1: ./script: unsupported interpreter: /usr/bin/env HEADER\n`, with
HEADER respectively `-S bash -e`, `--split-string=sh -e`, and `bash -e`.
The machine proof preserves original and parent-check-expanded command strings
and both native/current hex tuples. The packed non-S native0 and hidden non-S
native127 have **different recorded protocol profiles**; neither replaces the
other. All three packed protocol rows receive zero supported-core credit.

Original bad-fixture results remain separate: hidden40/48 + hosts6/7; original
packed assertions0/10 in each profile and0/5 hosts despite raw7/10 each. The
earlier independent v1 refusal retains172 product processes, its first revised
packed tuple failure (0/1 attempted), six unexecuted core rows, three unexecuted
protocol rows, and all five hosts/12 author controls/14 reviewer variants then
unexecuted. None is added to the current accepted denominator or rewritten.

## Prevent repetition without changing product APIs

Before a separately authorized gate, ROOT can use existing Git/harness mechanisms:

1. Assert the requested feature commit is an ancestor of the exact candidate;
   assert the feature file exists there with the accepted hash. b494 fails both.
2. Authenticate the full selected archive and source/test/helper/data bindings,
   plus actual discovery; refuse live overlays or changed tracked inputs.
3. Bind the executed harness and inherited loader guard. Check actual cohort
   resolutions against the chosen archive. If load-level proof is required,
   use a harness load hook; the old resolve-only guard must not be relabeled.
4. Keep TS-source and moved-package compiled-JS profiles distinct. Preserve
   native-profile identity, input hashes, diagnostics and original failures.
5. Enforce native-prerequisite and artifact-immutability preflight separately.
   An ancestry/hash check is necessary here, not sufficient broad acceptance.

No shared source/configuration patch is proposed or implemented. The first
handoff is `/tmp/safe-bash-env-gate-binding-clarification.txt`; the sealed handoff
is `/tmp/safe-bash-env-gate-binding-final.txt`.

Verification: `node tests/shell-stress/env-split-gate-routing/binding-proof.mjs`.
It compares the published proof deterministically, reads only committed evidence
and bounded Git results, and refuses replacement. No scratch, native oracle,
product child, dependency install or original file change occurs. Its first
generation completed all checks and wrote the proof, then hit a final console
alias typo; fixing only that alias produced a successful byte-identical proof
comparison. That metadata-only display failure is not a product failure or rerun.
