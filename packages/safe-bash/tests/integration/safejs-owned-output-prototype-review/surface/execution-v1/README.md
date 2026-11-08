# Released execution runner v1

ROOT explicitly released the eight immutable inputs from `5645b4f5` plus
commit-check `c0d3cb8b`. `RELEASE.json` binds the different receipt verifier's
`07a7dae5` proof/verification and `db139ae9` report-only correction. This is a
TEMP prototype surface audit, not production promotion, installed-private-package
acceptance, or lifecycle/worker/regex acceptance.

Run from the repository with the pinned Node 22.22.2 binary:

`node tests/integration/safejs-owned-output-prototype-review/surface/execution-v1/run.mjs`

`RUNNER-FREEZE.json` and every runner file must already be committed before the
runner admits any guest. It verifies their committed bytes and all original
frozen case bytes first. No guest source, expectation, budget, or original
failure is changed. Native `node --check` applies only to these host scripts;
guest syntax has not been pre-executed or accepted by a stub.

The runner creates separate regular TMP copies of the full candidate, actual
public package, 264 freshly checked private source files, and previously copied
TypeScript tooling/loader. Both retained verifier routes and the original
prepared candidate are checked, never modified. Private Git reads set
`GIT_OPTIONAL_LOCKS=0` and disable fsmonitor per command without writing config.
The original lookup of `attempts/r2/verification.json` failed with ENOENT before
any runtime work; the correct released file is `receipt-review/verification.json`.
That lookup error is not a guest result and is not hidden as a passing attempt.

Each guest executes once in a separate Node child with an absolute 10-second
deadline, inside the 100-second cohort deadline. Natural exit, parent-alive
evidence, exact output/effects, genuine metadata/operation witnesses, host
descriptor identities, and every loaded module path/hash are recorded. There
are no expected native workers or esbuild services; any child requiring
deadline enforcement is blocked, never a pass. The pinned TS loader performs
in-memory source transpilation only, not an engine build.

The genuine Shell sink metadata backs the real `createOutputOperation` and the
unchanged SafeJS definition's stdio facade. Host positive callbacks are finite
and never granted to guests. Only case 04 adds the supported public shell
module; no privileged control module is injected. Field results retain the
allowed stdio `write` and function `call`/`apply` distinctions.

If the frozen exact `stdio.write.registerCleanup` path is both visible to the
guest and identical to the real host registration function, the runner writes
the immediate ROOT finding before the single predeclared case 09 callback.
Other observations stop with finite facts, without callback attempts. A
conditional observation is never counted as a passing unconditional case.

Fresh private after-state runs even when preflight or a guest fails. Complete
walks of all copied input roots and selected shared roots detect added entries
as well as changes/removals. Private engine walks detect new eligible source
entries but explicitly exclude `.git`, `node_modules`, `dist`, `.cache`, and
`.turbo`; no append-proof claim is made for those excluded private subtrees or
the entire private repository. Root-level TMP result files are outside immutable
input roots. The loader file is separately hash-checked. VFS comparisons cover
complete bounded namespace and file bytes, not timestamp parity.

Results are captured only to the unique TMP directory. No committed capture is
rewritten. Failures remain raw; corrections, if necessary, require another
version/commit and cannot silently change this cohort. Case 07/08 outcomes are
dialect profiles, not descriptor/prototype or universal non-leak passes.
