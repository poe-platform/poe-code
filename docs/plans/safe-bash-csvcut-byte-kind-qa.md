# csvcut behavior byte-kind review and manual QA

Scope: `behavior-csvcut`, on the existing private command implementation. The
selected compatibility identity remains csvkit 2.2.0 / agate 1.14.2 / Python 3.9.
Source-main flags are not admitted. The existing acceptance matrix and behavior
review remain authoritative; this increment does not close their open cells.

## Procedure

1. Before implementation, run the workspace tests with independent non-byte
   typed-array fixtures. Verify `Int8Array([97,10])` is erroneously accepted,
   despite its forged public `Uint8Array` tag. After implementation, reject signed,
   clamped, wide, floating-point, bigint and foreign-realm non-byte arrays with
   canonical `CsvError`, `INPUT`, no output and exactly one input retirement.
2. Verify local and foreign-realm `Uint8Array` and Node Buffer inputs still work.
   Give their public `Symbol.toStringTag` a throwing getter. Projection must not
   consult that property and must preserve literal repeated-column order.
3. Run literal controls for duplicate blank headers, comma-bearing header output,
   exact colon/hyphen names before range parsing, exclusion of all matching
   positions and unrecognized individual exclusions. Retain all existing chunk,
   malformed input, cancellation, producer reuse and budget regressions.
4. Run maintained csvcut workspace tests and lint (including source/test types),
   then the maintained selected safe-bash workspace build closure.
5. Stage public artifacts through `scripts/package-safe.mjs`, pack with scripts
   disabled and install offline in an external consumer. Execute the maintained
   private-command runtime fixture and strict csvcut declaration consumer.
   Through the installed public subpath repeat positive/negative byte-kind
   controls, UTF-8 input with conflicting host encoding, falsey pre-abort with no
   acquired authority, exact/one-over output budgets and recovery after failure.
   Verify command/engine/contracts packages are absent from installed dependencies.
6. Record source/artifact hashes, runtime, results and unavailable matrix cells.
   Purge only task-owned staging and consumer evidence after recording results.

This procedure uses memory producers only. Native executables are never unit-test
dependencies. No new CLI surface is introduced; the separately planned CLI wiring,
screenshots and CLI/SDK parity remain open. Actual browser/workerd runtimes and
checkpoint/replay remain unverified. No performance measurement or publication
is part of this procedure.

## Review

The pre-fix test failed with `Missing expected rejection`; 76 other tests passed.
The repair uses the intrinsic typed-array kind getter rather than `instanceof`,
public properties or a display tag. The existing intrinsic extent/buffer/offset
checks still validate detached storage, admit actual input length and ignore
producer accessors. Type rejection occurs before parser/output admission.
The existing view reservation covers the borrowed input view; the kind check
does not allocate input storage or acquire host capabilities.

All existing algorithms remain iterative and use the invocation's shared ledger:
input bytes, decoded UTF-16 bytes, conservative retained allocations, exact UTF-8
output, parser/selector/writer work, cells, projection scans and argument storage.
No recursion, external runtime dependency, command registration or shared engine
change was introduced. Existing registered cleanup and failure precedence remain.

## Results

Executed on Node 22.22.2. Candidate is the working tree based on
`ab1fa8d34101e1e7f61272973f3bc28a842043d8`, identified by these SHA256 values:

| Source | SHA256 |
| --- | --- |
| csvcut `src/behavior.ts` | `5fc5ee46410fbaa6b8cb83fcb219ace03a888e4e17a4e573a87993ce3d227911` |
| csvcut `src/behavior.test.ts` | `7e2da080e8d89a56a6ac548088188c208fe0f5ad6ce4866d87a5b9509cc9070f` |
| csvcut `src/index.ts` | `62120c7c1b77e8efd26c2a51917332007ed2a9a148991d14fb4d5aaa15190275` |
| unchanged CSV engine `src/index.ts` | `bfb710ddffb6cd7463ab024127e109c1c1f35e4d6ead33de068ef9b8a1c7e5a3` |

Passes:

- `npm test --workspace=safe-bash-command-csvcut`: 77 passed, zero failures,
  skips, cancellations or TODOs after the repair. The initial expected TDD
  failure is described above; it was investigated and fixed.
- `npm run lint --workspace=safe-bash-command-csvcut`: ESLint plus both maintained
  source/test typechecks passed.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: selected
  maintained dependency build closure passed, including the private command and
  safe-bash guarded compiler/optional CLI suffix.
- `git diff --check` for task-owned paths passed.
- Procedure 5 passed: maintained public staging at
  `0.0.0-csvcut-byte-kind-qa`, packing with scripts disabled, offline installation
  outside the checkout, `verifyPrivateCommand()` from the maintained runtime
  fixture and strict NodeNext csvcut declaration compilation with exact optional
  properties and unchecked indexed access. No private csvcut/engine/contracts
  workspace was installed. Canonical CSV error identity passed.
- Installed negative/positive byte-kind and foreign-realm fixtures passed,
  including forged and throwing public tags. Every negative input retired once
  with no output. Installed UTF-8/BOM/emoji input ignored the conflicting
  `PYTHONIOENCODING=latin-1`; exact nine-byte output passed, eight-byte output
  failed with canonical `LIMIT`, and a subsequent fresh invocation passed.
  Pre-abort reason `false` propagated unchanged without calling the source.

| Public tarball | SHA256 |
| --- | --- |
| Safe Bash | `65b2eec23c67ef749e4b3e54eac51e40fc851d0f7e8bd76f9202ac84c4a590f8` |
| SafeFS | `adee38da43371d0d354936b6b642eaea80dfcd218860ee247dbebdf63327557f` |
| SafeJS | `fd98a8971962ceafc97055ecfce0b09355590fd857bd31a18f0a4f7d9b09cae3` |

Failures remaining: none in executed final-candidate checks. Skips in the focused
unit route: none. Incomplete verification: full compatibility remains open,
including codec/NONNUMERIC profiles, Python integer grammar, exact native CLI
diagnostics, sink/VFS command wiring and advertised-runtime/replay cells. Native
versioned controls were not executed; no authenticated Python 3.9 oracle is
claimed. Foreign-realm fixtures qualify Node VM typed-array admission only,
not actual browser/workerd execution. There is no CLI registration yet, so
CLI/SDK equivalence and CLI screenshots remain unverified rather than passes.

Repository-wide lint/test/build were not run for this command-local change;
no shared runtime, workflow, manifest, publication machinery or registration was
edited. No generated finding needs a random seed: all fixtures are deterministic
and the minimized failure is `Int8Array([97,10])`. These results are semantic
checks, not performance measurements or complete upstream compatibility.

Absolute `/out` is unavailable on this host. Task staging used ignored
`out/csvcut-byte-kind-qa`, with the installed consumer in an external temporary
directory. Task-owned staging and consumer files were purged after capture.
Unrelated edits were preserved. Local commits: none. Verified remote-main
delivery: none. Successful releases: none. No private package was published.
