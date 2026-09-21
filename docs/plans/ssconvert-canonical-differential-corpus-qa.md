# Canonical command and workbook differential QA

This is an execution procedure, not a parity claim. The implementation remains
TypeScript ESM in `packages/ssconvert`; Safe Bash invokes the existing shared
command/SDK engine. Native Gnumeric is a separate, explicitly invoked QA oracle.
No native fallback, host capability, provider, export or realm policy is added.
Do not edit README files or push/publish for this task.

## Frozen inputs and admission

1. Work from the repository root. Keep primary source, extracted upstream tests,
   native builds, original QA inputs and generated captures under `out` only.
   Verify the official 1.12.61 archive against
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
2. Inspect `docs/ssconvert/canonical-reference-profile.json`. Its current native
   profile is **blocked**. The retained Linux ARM64 binary cannot run on Darwin;
   Docker is unavailable. Dependency/plugin files are not requalified. An empty
   dependency/plugin profile cannot produce a captured native case. Do not call
   upstream research or JavaScript unit passes native parity passes.
3. For a usable oracle, capture the exact executable hash, dependency files and
   hashes, plugin modules/manifests and hashes, loader configuration, build flags,
   locale data, environment, timezone, fonts, print/image loaders and optional
   solver executables. Preserve blocked profiles. Qualify a new immutable profile
   and register as a new evidence generation; do not retrofit old captures.
4. The register binds the pre-existing source census and parent profile by hash.
   Regenerating with `node packages/ssconvert/tools/register.mjs` creates an
   **unmeasured** register. Never regenerate it to erase measured results. Case
   reports are separate immutable files written with exclusive creation.

## Original cases and exact captures

1. Use original small CSV/workbook inputs. Unit fixtures use memfs, injected byte
   I/O, mocked capabilities and cancellation. They never write disk fixtures,
   spawn a native utility or query an LLM. Upstream licensed assets stay in `out`
   and are research inputs only.
2. Register entries are obligations, **not executable cases** or passes. Expand
   each obligation into concrete original input/expected-output cases. Account
   for hidden/inherited/debug options, short clusters, qualified group prefixes,
   missing/empty/repeated values, operand placement, invalid byte arguments,
   parser errors, help/version timing, action conflicts and ordering. A sampled
   grammar matrix is not exhaustive parser-state coverage.
3. Use every noninteractive opener/saver ID, including unavailable optional
   plugins as blocked cases. Separately qualify OOXML transitional/strict, ODF
   extended/strict and BIFF7/8; do not infer format support from a registry ID.
4. For every manifest/descriptor function, test argument/coercion errors, direct
   versus referenced values, evaluation order, recalculation, formulas/caches and
   serialization. Preserve builtin/debug-only descriptors. For solver/analysis
   properties, test defaults, writable/inherited properties, bad property values,
   status, warnings, updates and failure timing. Qualify each print/chart loader
   and target including unsupported target diagnostics.
5. A native specification JSON has `profile`, `archive`, `executable`, `cwd`
   paths; `argv` is an array of byte arrays, `stdin` a byte array, and `env` an
   ordered array of unique string key/value tuples. The working namespace must
   be owned and under `out`. For example:
   `node packages/ssconvert/tools/capture-native.mjs out/CASE/spec.json out/CASE/native.json`.
   This is an explicit capture primitive, not an automated QA acceptance script.
6. Capture the product using the existing `runCommand`/`createEngine` with the
   same original namespace and injected filesystem/stdin/stdout/stderr. Preserve
   argv bytes, input hash, env, cwd, source/profile hashes, exact status and all
   stdout/stderr bytes. Record directories, file bytes/modes, symlink targets,
   hardlink aliases and namespace order before/after. Do not translate exit
   statuses or collapse streamed warnings into a final error.
7. The native primitive preserves directory enumeration order. This is observable
   evidence, not a sorted namespace. Hardlink aliases identify the first observed
   path sharing dev/ino. No timestamp, process ID, XML node, warning, formula,
   cache, style, relationship, ordering or namespace normalization is authorized.
   Unknown observations require new cases; invalid UTF-8 native argv is currently
   blocked because the Node process API cannot transmit arbitrary argv bytes.

## Structured and interoperability gates

1. Exact CLI/text/file comparison remains independent of structured semantics.
   A ZIP/XML byte difference remains reported even if a semantic snapshot matches.
2. Create independent, complete semantic JSON snapshots for reference and product
   workbooks. Include formulas, cached values, styles, workbook/sheet order,
   names, relationships, namespace identities, charts, print settings, solver and
   analysis settings, unknown/lossy content and diagnostics. Arrays retain order.
   The report compares supplied JSON without projecting away fields. It does
   **not** manufacture or certify snapshot completeness.
3. Require separate artifacts for read-write-read round trips and native import
   of product output/product import of native output. Record both command captures
   and complete workbook snapshots. Include stable reserialization checks. Native
   import unavailable or missing output is blocked, never a successful round trip.
4. A cases JSON is an array of `{feature, reference, candidate, checks}`. Each
   check maps a register requirement to distinct `reference` and `candidate`
   JSON artifact paths. Use explicit evidence for every requirement, not booleans
   invented by a test runner. Run:
   `node packages/ssconvert/tools/report.mjs out/CASES.json out/REPORT.json`.
   The primitive authenticates register bindings, hashes capture/artifact bytes,
   rejects self-comparison and hardlink aliases, compares exact captures and
   independent semantic artifacts, and accounts for missing/blocked/mismatched
   requirements. Equal raw snapshots do not prove round-trip/interoperability
   execution: those procedural requirements remain unmeasured in this reporter,
   while raw artifact mismatches remain recorded. A reproducible recipe executor
   with action/input/output provenance is still required. Exit 1
   means the register is incomplete or mismatched. A missing dependency is not a
   skip/pass. Hashes establish byte identity, not oracle or snapshot authenticity;
   the executing reviewer must qualify those producers independently.
5. If nondeterministic fields need normalization, first capture repeated native
   runs proving the variation and define a narrow field-specific rule. Retain raw
   bytes, separately report normalized fields and their denominators, and keep
   independent semantic/round-trip gates. There are currently **zero** approved
   normalizations.

## Upstream research and maintained verification

1. Run source-relevant upstream tests only from the retained `out` extraction,
   with its matching native build and dependencies. Do not copy licensed test
   bodies/assets into original unit fixtures. `test/t9001-ssconvert-resize.pl`
   was attempted; its binary failed to execute on Darwin. That result is blocked
   research, not a product test result. All other upstream entries are unmeasured.
2. Use `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache`,
   `npm test --workspace=@poe-code/ssconvert`, and
   `npm run lint --workspace=@poe-code/ssconvert`. Workspace Vitest executes fresh;
   this is the maintained package test route, not root-only test substitution.
   Run additional maintained Safe Bash/shared infrastructure routes if integration
   changes are made. No Safe Bash product integration changes are made here.
3. Have a different agent stress/fix the tool with failing original memfs cases.
   Record repaired defects, actual check statuses and remaining unmeasured domains.
   Root owns exports, integration and Git. No push or publication is authorized.
4. Retain specifically requested immutable QA captures under `out`. Transfer check
   statuses/hashes to the verification record, then remove temporary local logs.
   Keep remaining obligations visible; passing unit evidence does not qualify
   the native command/workbook differential corpus.
