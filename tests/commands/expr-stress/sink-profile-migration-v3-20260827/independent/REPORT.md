# Independent sink-profile migration v3 verification

## Result and boundary

Independent delegated leaf; no redelegation, product edits, canonical edits, author edits,
old-fixture edits, broad shared cohorts, or native-oracle recapture. All owned changes
are new evidence under this directory. This is a scoped migration verification, not
universal bug absence, parity, superiority, public-export acceptance, or completion.

The accepted replay is **run-02**, using one exact compiled/installed c3 package:

| Cohort | Original retained | Separate revised overlay |
| --- | ---: | ---: |
| Exact beba legacyNoNative canonical scope | 236/237 | 237/237 |
| Old core | 145/146 | 146/146 |
| Frozen quota | 46/47 | 47/47 |
| Nearby encounter-order | 15/16 | 16/16 |

The four original failures are respectively the legacy canonical sink-status test,
`sink-rejection`, `stdout-rejection-normal-quota`, and `stdout-failure-no-regex-replay`.
Raw results remain in `run-02/original/` and the original canonical process record;
revised results have distinct paths. No original result was rescored. The historical
beba raw bodies are also Git-authenticated and unchanged (`PRESERVATION.json`).

**No unresolved demonstrated core defect in this scoped review.** The demonstrated
failures remaining in original profiles are the explicitly approved expectation
mismatches. No product-issue file was published because no genuine product flaw was
established. The unsupported nullable-repeat/backreference guard remains unchanged;
this review does not revisit that feature limitation or unmeasured cases.

## Exact bindings

- Product: `c3e40f8bd721da5e496f3b3abfd51aee45db5a84` only, never live HEAD.
- c3 source tree: `8be381b8970f76df3e290acd330417403219b82c`.
- Prior independent evidence: `beba7b00d5ba277d2ac6770968d8e4b15c846171`.
- Author canonical test-only commit: `860967af44b20918e3096230f6c7445d4c9cf133`.
- Independent control freeze commit: `c2d6b7c3`.
- Selected source archive SHA-256: `66d53b29c609957e3f5b7ee27c7734c72a959771b68e3b9b6417df0dd379b97f`.
- Packed artifact SHA-256: `8331e853455f295dfda24ff53d612514212067ca2075df09e8b60339bda58a5e`.
- c3 expr entry source SHA-256: `e7cf6a0077a291578f4c669fe41da37188be8cebcb19bdb574838fd7fae2eb8e`.
- Compiled worker entry SHA-256: `46479e6d87bd5d20371a2e523310b2275c74d32d15105fcc9678ec73410efe4f`.

Archive selection is exactly the previously validated beba core selection: `src`,
`package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`. Its archive
hash and every emitted file hash match beba. Product/root bytes are authenticated
against c3 before and after; live dirty files never enter the archive.

The package was actually packed and installed offline, using empty task-specific npm
caches, `--ignore-scripts`, zero runtime dependencies, and no global/private install.
The entire consumer directory was physically renamed before replay. Tests use actual
installed `dist/commands/expr/index.js`, not a nonexistent public expr export. There
is no installed `src`, no shared dist, and no source/runtime dependency symlink.
Only TypeScript and Node types from existing development tooling were used to compile
and strictly check the exact six canonical files and their imported helpers/source.

The canonical TypeScript was emitted, then only its source import specifiers were
relocated to the physical installed dist. Every transformation is reversible to the
original emitted JS, preserving all assertion bytes (`binding-only-deltas.json`).
Both profiles pass strict typechecks with `skipLibCheck:false`; no casts, suppression,
new exclusions, or budget increases are introduced. The local config explicitly
selects the requested six-file scope; it is not an all-repository typecheck claim.

## Migration audit

`audit-03/audit.json` authenticates exact old/new paths and hashes against Git and the
author's frozen manifest. Every source change must equal one independently specified
replacement; unrelated changes, callback changes, or comparator weakening fail audit.

| Profile | Original SHA-256 | Revised SHA-256 |
| --- | --- | --- |
| Canonical contracts | `6b03867e5349278eb5e6562b8ab14b12da6b03be9d26ebf48a0c645aa1f56197` | `ce900757c3d61c85e76960260f54e90fa4ae1edb0d71b070b8bf639b9a2326b7` |
| Core runtime driver | `5ae25ca13f47fcf2715ca0336149b41faf3d70fafa83ef42c667c9be054ca686` | `1ecb6e435f0fd42956836b593de9c4015a94e90788d7a832e9504449586a94f5` |
| Quota cases | `5b3a3fbffdd25eaaa9bb931d680b0da19be61e2e2335dc45ac4a664691879086` | `95b43097e3d7685504fc11db5b90f6fa59988b34daf5ee236e679ca8b8b3ea40` |
| Nearby controls | `055ec3d97e09ac77bbc97c0534175a02bf886ac8c6dea2454bf2d4ffb0e5e764` | `8842bd8d8542757a64cca37306491903233cb43e41fe9b37d0801feba6816fda` |

- Canonical retains argv `["1"]` and `{}` options; captures the same thrown Error
  identity in `stdoutReason`, uses an explicit stderr-write counter, and requires zero
  diagnostics. The later `run([])` diagnostic-sink identity assertions are byte-identical.
  The captured Error and added counter/override are the exact assertion-support delta.
- Core retains argv `["41","+","1"]`, both sink callbacks and both sentinels; only
  the asserted reason changes from second to first and writes from two channels to stdout.
- Quota retains argv `["1"]`, cap 2, mode, sink callback, job and cleanup checks; only
  expected status/stderr/rejection changes. Existing exact `=== sinkReason` comparison
  remains, with no emergency diagnostic and one stdout attempt in the actual result.
- Nearby retains argv `["a",":","a"]`, sink callback, one submitted job, shared
  budget assertions, and cleanup. Only the expected object becomes `{rejected:"sink"}`;
  the existing exact identity/output comparator is unchanged.
- Three author core-binding replacements affect only root/profile/hash-manifest paths;
  each is disclosed and independently reconstructed. Core-bound scenario code is unchanged.

## Negative sensitivity

The control protocol was committed before author receipt/diff/overlay review. Initial
discovery included an attempted live canonical read in truncated output; the freeze
discloses this, so this is not represented as perfectly blinded discovery. Executable
controls were subsequently frozen before execution, separately from immutable product.

Four actual c3 positive controls pass. **Twenty behavior mutants are detected**: for
each of the four profiles, success swallowing, diagnostic/status recast, copied Error
with the same message, another sentinel, and duplicate diagnostics fail the relevant
original migrated assertion. The test-only wrapper waits for real c3 execute to reject
and finish cooperative cleanup, then mutates settlement/output; product files are not
modified. Exact original sink callbacks still run. Selection is one target per profile,
not a new broad cohort. Wrapper/seam and selection deltas are frozen and disclosed.

`run-02/final-integrity.json` verifies named failure reasons: missing rejection,
reference-identity validation, diagnostic count 2 versus 0, exact writes, or the original
identity/output comparator. Import/setup failure is not accepted as sensitivity.
Five additional structural mutants (argv, cap, callback, job expectation, cleanup
assertion removal) fail the exact minimal-delta audit, with valid positive inputs.

## Integrity, cleanup, and attempts

Both canonical profiles record 174 worker starts and 174 exits. Runtime import guards
restrict product dependencies to the installed package/builtins; actual worker URLs
bind to the c3 compiled worker. Its four-module static closure is exhaustively parsed
and bound to pre-execution compiled hashes. Quota has zero safety terminations; nearby
has zero active workers; core reports removed real-VFS scratch and no outer timeout.

Append-aware inventory comparisons cover complete selected source, compiled dist, and
installed package trees. Generated dist is checked separately, not silently ignored.
All task-root temporary resources are removed; both `/var` and `/private/var` aliases
are absent. No SIGSTOP or broad process cleanup was used. Timeout containment is scoped
to owned child process groups. This does not certify unrelated live repository state.

Two auditor setup attempts are retained: redundant canonical hash metadata was absent,
and generated support manifests required structural rather than Git-path authentication.
Neither was a candidate flaw. Initial replay `run-01` is also retained, rejected as
binding evidence: macOS `/var` aliases differed from Node's `/private/var` URLs, causing
worker rejection and incomplete canonical results. A single confirmed task child was
terminated; all raw results remain. The guard correction became visible to that first
attempt's later canonical phase; **no run-01 cohort certifies this result**. Its initial
drivers are retained with matching frozen hashes. Fresh `run-02` uses consistent real
paths and the same c3 compiled package, without changing callbacks, inputs or assertions.

Author overlays were hash-frozen and ready at handoff; their evidence commit was still
pending at the end of this independent execution. The canonical change is committed,
and copies of every inspected author input are preserved here, so verification does
not depend on a mutable author working directory.

Run `node tests/commands/expr-stress/sink-profile-migration-v3-20260827/independent/verify.mjs`
for read-only evidence authentication. Capture drivers are explicit opt-in, use unique
directories and do not belong to canonical test discovery. This report is not a claim
that 72 hours elapsed or that broader product acceptance is complete.
