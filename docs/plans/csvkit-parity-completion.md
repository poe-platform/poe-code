---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
readiness: draft
---

# csvkit parity completion

Complete and qualify the existing TypeScript ESM csvkit engine and safe-bash integration against released csvkit 2.2.0.

## 1. What we're building

Implement a JavaScript csvkit-compatible command suite for safe-bash in packages/csvkit, registered through packages/safe-bash. Preserve csvclean, csvcut, csvformat, csvgrep, csvjoin, csvjson, csvlook, csvpy, csvsort, csvsql, csvstack, csvstat, in2csv and sql2csv with original argv syntax. Match source archive SHA-256 `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b` under explicitly frozen runtime and capability profiles.

This execution scope is planning and documentation only. Implementation, builds, runtime tests, screenshots and parity qualification below are pending. No staging, commits, pushes, publication or README additions are authorized.

### Current read-only audit

The existing engine is substantial; do not replace it with a scaffold or repeat historical work. `src/commands.ts` imports fourteen declarative descriptors; `src/formats.ts` imports CSV, DBF, fixed, GeoJSON, JSON, NDJSON, XLS and XLSX. `src/commands/csvstat.ts` enumerates thirteen metrics; count is a separate operation. `src/index.ts` exports actual CLI/SDK engines, generated SDK types, typed tables, Decimal, workbook, interpreter and SQLite APIs. Safe-bash registers the family explicitly and routes execution into the domain engine.

The audited `coverage.json` input hashes match all five referenced inputs. It has 415 effective command/action records, 323 source branches, 159 parser declarations, 394 upstream files, 14,817 test declarations and 52 static assignments. All effective action, branch and parser records are unresolved. Its zero qualified passes are authoritative for that ledger; historical test totals are not its missing attribution.

| Dimension | Implemented in source | Failed | Unmeasured/unresolved | Capability-divergent |
| --- | --- | --- | --- | --- |
| Executable descriptor inventory | 14 present; complete implementations not counted | Not freshly measured | 14 complete-command qualifications pending | Operation/profile census pending |
| Effective actions | Not attributed | Not freshly measured | 415 | Not attributed |
| Parser declarations | Not attributed | Not freshly measured | 159 | Not attributed |
| Source branches | Not attributed | Not freshly measured | 323 | Not attributed |
| Input format inventory | 8 descriptors present; complete formats not counted | Not freshly measured | 8 complete-format qualifications pending | Operation/profile census pending |
| csvstat inventory | 13 metrics plus count present; full metric qualification pending | Not freshly measured | Complete per-type/serializer census pending | Not attributed |

These are distinct denominators; do not add them together or report absent measurement as zero failures/divergences. `qualifiedPasses=0` and `fullSupport=false`. A fresh exact current-candidate census is required for implemented/failed/unmeasured/divergent totals and unknown omission count. Zero unknown omissions has not been established.

The parser register contains 23 declarations in `csvkit/cli.py` and 136 in utility files, with 159 unique path/line records and no duplicates. The requested 135 local declarations conflicts with that inventory. Resolve by authenticating source and classifying every declaration, including conditional/replaced positional operands and version; preserve both raw and semantic denominators. Implicit argparse help must be separately audited per executable. Never delete a record to obtain the requested number.

`optional-profile-interoperability-verified-20260919.json` has 43 heterogeneous result records: 35 marked exact true, three exact false and five without an exact field. Those five are not automatically unmeasured or passes. The three recorded mismatches include bzip2, xz and Agate interaction. Its frozenProfileQualified is false. This is historical evidence, not fresh current qualification.

## 2. User-facing shape

Use original names directly, for example `csvcut -c name input.csv | csvgrep -c name -m Alice | csvformat -T`. No replacement csvkit subcommands, invented flags, prompts, colors or spinner output inside the compatibility commands.

Public imports remain `poe-code/csvkit` and `poe-code/safe-bash/commands/csvkit`; validate emitted artifacts through those exports. Preserve opt-in `csvkitCommands(options)` and `createCsvkitCommands(options)` collision preflight/replacement behavior. Fourteen registered names are distinct from operational capability availability. Help/version and ordinary parser exits require no database/interpreter/input acquisition.

CLI `execute(command, context)` and SDK `run(request, invocation)` share `perform` and the same descriptor operation. Generated settings retain command-specific destination types and applicability, including operands and overrides. Grammar-only help/version actions need explicit crosswalk treatment rather than fake SDK settings.

Missing or unsupported capabilities remain explicit operation-stage refusals, normally status 78, distinct from native-compatible parse/application errors. Preserve exact output-budget behavior when diagnostics cannot fit. Host failure and cancellation retain their original thrown reasons.

The concrete config/env/usage candidate is `docs/csvkit/usage-draft.md`. README incorporation requires separate user approval and remains a delivery prerequisite; no README content is added by this plan.

## 3. Implementation details and technical decisions

### Autonomous execution prerequisites

Repository source, descriptors, reference manifests and historical captures are available. Do not assume installed native comparators, exact installed Python manifests, terminal provenance, service endpoints or credentials are available. Before each optional QA profile, provision its hash-pinned reference environment and authorized fixture service, record versions/content hashes and verify the frozen environment before/after. Unavailable setup is a named unmeasured blocker; it never becomes a passing stub. No product native process, Python csvkit fallback, ambient credentials or automatic host filesystem/network/engine discovery.

Use CPython 3.14.2 / Agate 1.14.2 / SQLAlchemy 2.0.54 / Babel 2.18.0 / CLDR 47 / Unicode 16 / C locale / UTC / UTF-8 / 80-column primary profile already recorded in reference-profile.json. Preserve CPython 3.9.6 as a separate reference profile with 0–3 quoting choices; the current product is not a selectable dual-runtime implementation. Freeze Decimal context, clock, input/output encoding/error handling, warning/frame identities, linked compression libraries and drivers independently. Resolve optional installed-manifest drift before calling that profile frozen.

### Coverage and source reconciliation

Audit authenticated source, `docs/specs/csvkit.md`, `reference-profile.json`, `feature-register.json`, `coverage.json`, flow/disposition registers and compiled public consumers. Inventory every source-shipped SQL dialect/driver, stdlib SQLite, external dialect entry point, interpreter/IPython mode, encoding and compression path, including absent optional dependencies. Source-shipped unsupported features block full parity even when absent in the minimal reference environment.

Give each declaration, branch, source test, assignment, applicability/default rule and known quirk a stable source identity and explicit disposition. Cases must bind source/profile hashes, current candidate identity, original inputs, stdout/stderr/status and file/database effects. Classify implementation presence separately from exact qualification. Retain implemented, failed, unmeasured and capability-divergent counts, with explicit unknown-omission census. Never turn refusal assertions, TODOs, skips or preparation inventories into native passes.

### Architecture and lifecycle

Keep domain logic in packages/csvkit; safe-bash adapts contracts and registers names. Provider and format discovery stays generated from one declarative file per provider, without provider-name branching or proxy-only functions. Root owns integration, exports and Git; the independent agent owns only explicitly assigned stress/fix files.

Preserve owned argv/settings admission, streaming UTF-8/CSV semantics, borrowed-chunk copying before producer advancement, awaited writes and shared resource bounds. Register idempotent cooperative cleanup before acquisition; close admission and await admitted acquisition, iterator/result return, rollback, session/file close and cleanup barriers. Test real VFS effects and DB effects, not counters alone. Distinguish owned named input from borrowed opaque stdin: public cancellation may settle before uncooperative borrowed return. Cleanup cannot undo published effects or forcibly preempt opaque host work.

Preserve source quirks: FileType eager match opening; LazyFile line NUL stripping versus bulk reads; common encoding env default; sql2csv's query encoding/header overrides; regex/file/string precedence and Python rstrip; csvformat typed quoting 2 and ASV precedence; runtime quoting 4/5; greedy/repeated null values; raw/typed separation; repeated stdin/reopen effects; csvclean physical lines/side output; JSON surrogate/number/null behavior; SQL literal/options, transaction and driver diagnostics; clock-sensitive temporal inference and warning order.

## 4. Interfaces and test plan

Preserve `CsvkitContext`, `InvocationContext`, `CsvkitRequest`, `CsvkitCommandsOptions`, `CsvkitFileSystem`, `ByteSource`, `ByteSink`, `DatabaseProvider/Session/Result`, `InterpreterProvider/Session`, `CompressionProvider`, `CodecProvider` and `InvocationCleanup` contracts. Extend only for a reproduced source requirement; CLI and SDK parity is required for every extension.

For every code fix, first add an original failing in-memory differential/regression case. Canonical tests use memory/memfs and injected fast capabilities, never disk creation, native programs, network, LLMs or slow databases. Compare exact bytes/status/effects and preserve original expected observations. Native reference acquisition, actual service QA and screenshots are separate agent-executed markdown procedures under docs/plans.

Independent read-only review found no newly reproduced defect. Proposed additional stress cases: concurrent invocations with isolated cancellation and disposal; overlapping cleanup during pending DB/file acquisition; stdout close with sibling header/side-file work still pending; full CLI/SDK destination parity; all-name help/version/errors with throwing acquisition hooks; absent driver/interpreter/compression operational refusals. Preserve existing late-read/probe/commit/MSSQL cleanup regressions rather than duplicating them. Register integration-authored safe-bash tests literally in its maintained integration-inputs assertions as scoped instructions require.

Narrow development routes:

```sh
npm run build:workspaces -- --workspace=@poe-code/csvkit
npm run test --workspace=@poe-code/csvkit
npm run lint --workspace=@poe-code/csvkit
npm run build:workspaces -- --workspace=@poe-platform/safe-bash
SAFE_BASH_TEST_RG=csvkit npm run test --workspace=@poe-platform/safe-bash
npm run typecheck:all --workspace=@poe-platform/safe-bash
```

Confirm the safe-bash test selector includes all relevant command-specific files, not only filenames containing csvkit, and widen it accordingly. Builds and unit execution remain uncached and derive dependency closure from maintained declarations. Integration acceptance runs `npm run build`, `npm test` and `npm run lint`; do not substitute root-only unit tests. Respect workspace-local optional profile env scoping and clear Git local hook variables only in unit child environments. Workflow changes use `npm run lint:workflows`, without workflow unit tests. Full gate failures/timeouts require validation and resolution, never dismissal as unrelated.

Real-world proof runs the sample pipeline above through compiled public Shell imports over a memory filesystem containing `name\nAlice\nBob\n`; expect stdout `name\nAlice\n`, empty stderr, status 0 and unchanged input. Compare the same operation through SDK settings and native reference under the frozen profile. For SQL, qualify file bytes and independently reopened committed/rollback rows; for workbook/DBF, inspect side/memo effects; for csvpy, qualify actual guest objects and interaction.

Capture and visually inspect all fourteen help/version/error paths and every output family: clean diagnostics, cut/grep/format/stack CSV, join/sort CSV, JSON/GeoJSON, Markdown look, every stat metric plus full reports and CSV/JSON serializers, DDL/query output, all eight conversions and interpreter prompts/banner/tracebacks. Include Unicode/wide characters, empty/null/numeric/date data, redirected channels and long fields. Use `npm run screenshot-poe-code -- <command>` where applicable; safe-bash public-consumer terminal captures must exercise actual registered commands. Screenshots are ad hoc evidence, not canonical screenshot tests. Temporary captures/logs belong in out and are purged after conclusions are recorded.

- [ ] Exact 14 source/descriptor/registry/compiled-public names, proven with independently declared expected names.
- [ ] Reconciled declaration denominators and implicit help, proven by source-to-action-to-SDK crosswalk.
- [ ] Eight formats and thirteen stat metrics plus count, proven by per-operation/profile/type/serializer cases.
- [ ] Every shipped optional feature and quirk explicitly classified; unknown omissions zero, proven by source/documentation/test discovery reconciliation.
- [ ] VFS/database/result/interpreter cleanup and byte effects match, proven by actual Shell/SDK execution and owned-resource drain tests.
- [ ] Fresh uncached narrow and broad gates pass without counted skips/TODOs/refusals; exact scope and limitations recorded.
- [ ] Complete visual corpus inspected and channel/Unicode/layout defects resolved.
- [ ] Usage/config/env draft checked against compiled public consumers; README approval remains separately required.

## 5. Code plan

1. Reconcile the frozen reference and source denominators in docs/csvkit and docs/specs before product changes. Preserve historical captures and sealed fixtures. Update coverage by parsed structured records, not string replacement or regex rewriting.
2. Port/attribute current original regressions to `coverage.json`; do not rerun captures and infer unattributed source coverage. Rewrite stale specification and draft claims around current measured scopes, preserving reference-only qualification.
3. For each validated gap, own the smallest `packages/csvkit/src/commands`, `formats`, `table`, `types`, `io`, `sql`, `cli` or provider module plus original tests. Build/test/lint narrowly after failing-then-passing evidence.
4. Assign a different agent concrete independent safe-bash stress/fix scope. Root integrates `packages/safe-bash/src/commands/csvkit/index.ts`, public exports, integration declarations and maintained workspace boundaries. Verify `execute` and `run` reach the actual same operation.
5. Rebuild compiled consumers, execute full cross-workspace gates and visual/manual profile procedures. Resolve every failure or report the remaining blockers; do not mark full parity with unsupported shipped features.
6. Finish audited counts, specifications, capability availability and usage draft. Leave README approval and all Git/release actions pending.

If later separately authorized, use atomic owned-file Conventional Commits on main, manually run appropriate pre-push checks, verify remote-main delivery and monitor GitHub publication to success. Report local commits, verified remote-main delivery and release publication separately. Never revert unrelated edits/staging or publish locally.
