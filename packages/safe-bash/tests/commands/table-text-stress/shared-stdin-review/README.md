# Independent final shared-stdin review

## Scope and status

Different-agent verification of table source commit
`6ef0d8ddd76b430737cc9158c9c3c509fe197097`. No production, old tests,
helpers, oracle inputs, benchmark, filesystem, or root configuration changes.
Only this new evidence/driver subtree is owned by this reviewer.

**The bounded corrected-alias final gate passes.** A post-run archive audit found
four unused `.bin` launcher symlinks into the live checkout. Root authorized
correcting only those aliases to contained relative links and one complete
replay. All570 regular input files stay read-only and byte-identical. Runtime
resolution and before/after containment checks pass. The initial audit failure,
first-pass results, root ruling, and corrected final replay remain separate;
there is no claim of a wholly symlink-free tree or an erased first-pass limitation.

## Results — keep denominators separate

| Cohort | Historical observation | Current observation |
| --- | --- | --- |
| Original GNU216 selected profile | 215/216 | **216/216** |
| Original GNU216 exact native recapture | unchanged frozen expectations | **216/216 exact** |
| Product216 exact stdout/stderr/status | not newly measured on old source | **195/216**, 21 existing diagnostic differences |
| Unmodified independent104 | 104/104 characterizations; 70/71 native profile | **103 pass / 1 obsolete assertion fails** |
| Unmodified311, current frozen helper | prior current-helper311/311 characterizations | **310 pass / 1 obsolete assertion fails** |
| Separate selected-GNU311 driver | author result remains separate | **311/311** |
| Author-fix controls | focused9/17; native fixture profile5/12 | **234/234** =216 inputs +1 native216 batch +17 focused tests |
| Metadata author tests | **42/43 retained** | **43/43** |
| Public built package, pipelines | prior selected70/71 | **71/71 selected**, 67/71 exact diagnostics |
| Public built package, redirection | prior selected70/71 | **71/71 selected**, 67/71 exact diagnostics |
| Scoped `--noEmit` / isolated build | separate prior results | exit0 / exit0 |
| Actual two-file prior-source control | original shared-stdin bug | typecheck0, then **one semantic assertion failure** |

The original104 and311 failures are exactly their intentionally preserved
status0 shared-stdin assertions, not load errors or additional product failures.
The old strict-helper observation remains **291 passes, 3 load-failed files,
20 unexecuted cases**; it was not rerun, substituted, or declared passing.
Selected311 replaces only the old differential driver with the separately named
GNU driver, retaining the exact216 case hashes and expected native bytes.

The ordinary selected profile preserves the original policy: exact stdout and
status, plus stderr presence. It is **not exact diagnostic parity**. This review
additionally requires exact shared-stdin stderr. Every observed byte is archived;
the 21 direct-corpus and four-per-built-mode diagnostic differences remain visible.
Counts overlap and must not be added into a purported independent case total.

## Exact shared-stdin correction

Original input: `comm - -`, stdin hex `610a610a620a620a630a`.

- GNU and fixed product stdout: `0909610a0909620a630a`.
- GNU and fixed product status: `1`.
- GNU and fixed product stderr: `comm: -: Bad file descriptor\n`.
- Prior source: identical stdout, status `0`, empty stderr.

The implementation performs logical operand closes in GNU order, before totals.
Repeated stdin aliases one reader; physical iterator cleanup is idempotent.
Same-path VFS operands remain separate opens. Existing cursor, byte ownership,
order, positive pipeline, cancellation, producer-error, EPIPE, and backpressure
controls all execute. The focused12 fixtures run direct, piped, and redirected;
the additional five controls assert lifecycle/error precedence explicitly.
This is not a refusal to read repeated stdin or a native product fallback.

The separate prior-source clone reverses only `comm.ts` and `internal.ts` to the
source commit's parent. All other recorded files and the original case hash are
unchanged. Its source `--noEmit` succeeds; the shared-case failure is
`ERR_ASSERTION` with the old exact observation, not compiler/loader failure.
The four older semantic mutants and their logs are hash-verified only, **not rerun**.

## Provenance

Root release and both closed worker handoffs are bound in `snapshot-manifest.json`.
One actual-current regular-file snapshot contains source, tests, the current
WebDAV helper, development dependencies, and pinned native executable/source
files. All recorded files are read-only and have zero post-run hash drift.
It is copied-worktree evidence, not a clean committed-HEAD assertion.

- Full `src/` tree digest: `e796b3ca1b3cc3582b40e8fac18877aa93e3d1203dcd08e82ffccc6e61eb81af`.
- Table tree digest: `e4315fd33a56aa30ec9c390115c714ca958e60f13cb3f0f39a5d52592e77c7e6`.
- `comm.ts`: `34df22e9b6e1ca23ec14e83003aa9758c7d9fc1b1473828429e2ae713e4219cd`.
- `internal.ts`: `544935927754e228711318a299c20d95b3954bc756e14785722d0eac67a436d9`.
- Current helper: `177f79ee640460822cfe0486c87f7cc61ac7c8b84389abe32b48ef27f4b4ef36`.

The initial native capture stopped on an argv0 pathname difference in GNU option
diagnostics. Its raw failure is retained. The corrected capture uses the pinned
metadata GNU9.7 binary with the original author argv0, without normalizing output
or changing fixture inputs; all216 original observations then match exactly.
Binary, native source, archive, manual, Node, dependency and input hashes are
recorded. `source-audit.json` verifies the table map and18 author artifacts, and
records four broader author-context differences (three FS documents plus
`webdav/resource-id.ts`). Final archival observation records five later live
changes: `streams.ts`, `text.ts`, shell runtime, and two README files. None enters
the frozen acceptance snapshot. This is not validation of that newer live tree.

## Stat-only assertion audit

Commit `bdaaf50b3eccdd261349c1f32c19407fa348a64f` changes exactly one assertion in
`tests/commands/metadata/stat.test.ts`: `%x`/`%y` display nine fractional digits.
Independent pinned GNU stat/touch execution reproduces the full expected string
for unchanged bytes `00ff0d0a`, mode0751, atime−1ms and mtime946684800123ms.
The nine digits zero-pad integral millisecond values; no missing precision or
remote permission capability is fabricated. No SGID cohort is rerun.

## Reproduction and exclusions

`native.ts` captures only the existing216 native inputs before the gate.
`freeze.mjs` requires root READY and closed author handoff; `run.mjs` executes the
recorded bounded cohorts. `selected-gnu.ts` also reuses the existing71 cases in
both built-package modes. `prior-source.mjs` is a separately labeled negative
control. `corrected-alias.mjs` requires the additional explicit root ruling,
repairs only the four snapshot aliases, and performs the one final replay.
Exact argv, cwd, environment overrides, exit statuses and stream hashes belong
to `results.json`; `first-pass.json` preserves the earlier cohort.
`dependency-audit.json` records the failed archive assertion and precise alias
delta. Raw nonempty streams belong to `logs/`; byte-identical streams share one
hash-verified file. An explicitly null log path denotes a zero-byte stream,
not a missing run.
Use a new uniquely owned temporary directory when reproducing; do not overwrite
this checkpoint or its historical inputs.

The original six author built checks remain **unavailable, not executed**; the
142-mode reviewer replay is not their replacement or a claimed rerun. No old-five,
revised3758, global,224-case or SGID run; no new corpus breadth, universal GNU/BSD
or Bash parity, superiority, or72-hour completion claim. Cancellation cannot
forcibly stop uncooperative host operations. Existing backend, timestamp precision,
permission and shell lifecycle limits are not expanded by this result.

Native execution is test-only in attributed temporary fixtures. Each run's71
retained fixture directories from the old independent helper were checked against
exact existing bytes/names/sentinels and removed (142 directories over two runs,
not142 unique native cases). All validation children exited
normally; no delegates, stopped/dormant workers, or native fixtures remain.
Only source/dependency snapshots and reports are retained under the unique `/tmp`
work directory. No binaries, dependency packages, native fixtures, or copied source
trees are committed in this evidence subtree.
