---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
readiness: draft
---

# Resolve remaining ssconvert gaps

Tracking: hey-boss #1748; release repairs: #3360. All 19 families remain open.
This compact current plan replaces the removed historical gap plan. Detailed
current findings and source receipts belong in [the case ledger](../ssconvert/gap-resolution.json).
A delivered partial fix does not close its family.

## 1. What we're building

Resolve all reported ssconvert gaps: encrypted formats, legacy BIFF formulas,
Lotus named ranges, optional functions/services, Unicode PY_CAPWORDS, numerical
mismatches, PWD diagnostics, format preservation, rendering, solver accuracy and
optional/public artifact qualification. Preserve deliberate host-authority,
resource, cancellation and cleanup contracts. Commit improvements periodically,
deliver to remote main and verify publication. Keep the repository small.

## 2. User-facing shape

The SDK and `runCommand` must expose the same conversion, editing, recalculation,
solver and diagnostic behavior. Built-in portable code implements the requested
semantics; native applications are independent QA references. Optional services
remain explicit host capabilities. Passwords, databases, external links and FIFO
watchers never acquire authority from ambient configuration or guest arguments.

Support text must distinguish implemented behavior, verified profiles, deliberate
loss warnings and unresolved requirements. Preserve original formula/name/label
identity through copies, moves, edits and applicable transports; a cache, generated
name or fabricated function cannot stand in for an unsupported live reference.
No claim of full support from registrations, test counts or release success alone.

## 3. Implementation details and technical decisions

Source investigation comes first. The package, pinned sources and compact receipts
are available in this checkout. Native application and optional service availability
must be verified from the exact retained profile before each qualification run.
Provision missing authenticated environments through the existing host/container
routes documented in the reference procedures. Record unavailable dependencies
as blockers, never as passes, and continue independent work.

Implementation owners: `packages/spreadsheet-ast/src` holds the shared workbook
model; `packages/spreadsheet-engine/src` holds formulas, orchestration and shared
utilities; `packages/xlsx-ast/src` owns XLSX parsing/writing and the XLSX format
package supplies compatible registration/reexports. The CSV/ODS/XLS codecs remain
in `packages/spreadsheet-format-{csv,ods,xls}/src`.
The remaining codecs, rendering and command composition still live in
`packages/safe-bash-command-ssconvert/src`. Old paths for extracted implementations
are compatibility reexports; apply fixes at the new owners. Keep the
Safe Bash adapter thin. Use structured parser/model nodes and vetted cryptographic
primitives. Each code fix needs a current failing original memory test or other
concrete evidence, neighboring controls and narrowly maintained verification.

CSVKit now uses owned cached-value XLSX and BIFF readers, shared coordinates and
local format classification. SheetJS remains only a CSVKit test dependency.
The namespace-aware parser belongs to `xml-ast`; `safe-fs/xml` retains parser/error
identity. Pandoc and ssconvert use the owned JPEG implementation. Preserve these
boundaries while qualifying further workbook and rendering profiles.

XLSX imports preserve raw ISO dates, declared/reset dimensions, formats, epoch and
active sheet. BIFF imports skip formula/name translation and formatting-only blanks,
preserve raw errors and empty string caches, and use populated-cell extents.
CFB, record, string and cell allocations share caller work/storage counters.
Pinned xlrd 2.0.2 (`3a19d22014d7b3f3041b7188d21a653c18c709bf`) supplies the
cached profile: legacy encoding overrides beat CODEPAGE, the missing-encoding
fallback is ISO-8859-1, and BIFF8 ignores legacy overrides. BIFF4 workbook containers
reset per-sheet formats; BOUNDSHEET order controls sheet selection. Keep the
Gnumeric editing reader's separate formula, font and encoding semantics.
The library and adapter are delivered as `265df71418` and `daf450b6a8`; current
registry artifact qualification and the broader format-family scope remain open.

The incoming synchronous XLSX shortcut dropped sparse row positions. Fix
`52134c3627` delegates non-dense coordinates before output; dense conversion and
actual Shell substitutions pass the 95-test command cohort. Broader shortcut
format/resource equivalence remains unqualified and part of this plan.

Live Lotus name references are delivered in `2f95e87916` and `7aa2721cff`.
Definition edits and deletion now affect imported formulas; per-use copy modes
preserve relative/absolute axes and existing qualified-sheet behavior. Native
XML/XLSX/BIFF transport remains unfinished and refuses these tokens rather than
silently dropping identity or relocation. Complete native copy/move qualification
before closing this family. The ledger records focused and compiled evidence.

The current release follow-up includes Pandoc registry lookup (`683adeb82b`) and
public runtime ownership. A workspace rebuild deletes root-consumed filesystem
runtime files in `packages/safe-js/dist` and restores bare workspace imports in
public declarations (including `@poe-code/xml-ast`). Move public runtime and
declaration ownership out of rebuildable workspace output; do not relax the
consumer guard to accept leaking private imports. Verify compiled imports and
strict consumers after the maintained workspace rebuild route.

Complete the standard singular/plural/plugin command exports in that package.
Keep file-output budget and cancellation ownership in `safe-bash-contracts`.
The root SDK and Shell use the declared shared-workspace contracts runtime for
both Node and browser profiles. Preserve that canonical identity through the
root bundler and scoped packaging. Emit the public ssconvert SDK under
`dist/ssconvert` and shared runtime under `dist/shared`, separately from private
workspace output. Verify that workspace rebuilds preserve public runtime imports. Verify cross-bundle
raw arguments, file budgets, cancellation and installed consumers before claiming
extraction complete.

| Family | Required completion scope |
| --- | --- |
| PWD/resource identity | Actual cwd and logical aliases, symlink identity, GETENV preservation, paths, input/export/write diagnostics, staging/split/graph outputs, cancellation, supported platforms and public consumers. |
| Lotus names/formulas | WK1/WK3 and applicable modern records; global/local names, duplicate/case/scope rules, relative/absolute/sheet references, encodings, invalid records, edits, recalculation and XML/XLSX/BIFF/native transport. Native absence does not cancel requested functionality. |
| BIFF formulas | Every applicable token/version; external and detached bindings, missing/deleted targets, namespaces, shared/array/name contexts, indexes/spans, metadata and native roundtrips. Live labels retain ordered pairs, orientation, cell identity, reference class, quoting/relativity, copy/move and dependency effects; qualify scalar/SUM/intersection, boundaries, single cells, overlapping declarations, radical/extra-data/deleted/pivot forms and XML/XLSX/ODF/BIFF7 transports. |
| Encrypted BIFF | Applicable XOR, RC4/CryptoAPI and property-container profiles, passwords/encoding, ancillary streams, independent vectors, supported native cross-read and publication. |
| Encrypted ODF | Applicable AES, Blowfish and modern package profiles, algorithms/KDFs/manifest/paths, password variants, independent crypto and native cross-read. |
| Encrypted Paradox | Applicable header/body algorithms, block/record/version profiles, passwords and companion files, original vectors and native cross-read. |
| PERL_DATE | Sample signatures/coercion, injected clock, locale/timezone/DST/date boundaries, errors, arrays and activated runtime parity. |
| PERL_SED | Required bounded pattern grammar, classes/captures/replacements, Unicode and raw bytes, malformed inputs, diagnostics and activated runtime parity. |
| PY_PRINTF | Required conversion/formatting grammar, flags/width/precision, arrays/references/sheets, errors, Unicode/version rules and activated runtime parity. |
| PY_CAPWORDS | Pinned Unicode casing/whitespace/context/expansion and explicit version selection, surrogates/NUL/malformed values, typed splitting, diagnostics and exact activated runtime parity. |
| Database functions | EXECSQL/READDBTABLE signatures, typed scalar/array results, providers, errors/retry, actual effects, explicit authority, transactions, cancellation and connection retirement. |
| ATL_LAST | Datasource/FIFO lifecycle, ordering/read boundaries, partial and late records, recalculation/rebinding, errors and bounded watcher cleanup. |
| LN1P/log1p/acos | Reproduce current public/primitive discrepancies; exact binary64 profiles, signed zero, subnormal/overflow, poles/NaN/infinity, rounding versus accuracy and independent holdouts. |
| Higher-q Bessel | Current direct/shared routes, source operation order/FMA/reflection/phase, integer order and larger arguments/domains, exact reference values, warning/error/budget behavior and other supported runtime profiles. |
| Format records | Every applicable importer/exporter version/subformat/record effect: formulas, names, styles, encodings, metadata, merges, comments, charts/objects and external links. Prove independent parse/edit/export/readback; distinguish opaque preservation from implemented semantics. |
| Rendering | Chart/print/PDF text, geometry/fonts/page breaks/ranges/headers/footers, style/merge/rich-text/overflow/object fidelity and claimed Unicode/CJK/RTL support; independent visual evidence for each supported profile. |
| Solver/analysis | Goal seek, linear/nonlinear models, sensitivity/analysis reports and layout, errors and lifecycle; known solutions plus authenticated native optional profiles, not installed-program evidence. |
| Optional profiles | All eight activation environments and fourteen capability obligations in the optional runtime register, actual plugin activation/results/effects/lifecycle, exact source-disabled and GUI-only distinctions. |
| Public artifacts | Actual root/scoped registry artifacts installed outside the repo without private workspace resolution or native PATH; strict NodeNext, SDK/Shell XLSX-to-CSV and edited CSV-to-XLSX, browser/worker where advertised, authority/cancellation/cleanup and replay. |

Encryption qualification includes correct/wrong/empty/binary passwords, encoding,
tampering, truncation, unsupported versions, KDF/work ceilings, chunks, cleanup and
no invalid plaintext publication. Describe unauthenticated legacy formats honestly.
All functions preserve namespace replacement and absent-plugin behavior. Never
remove difficult numeric inputs or relax exact comparisons to obtain a pass.

## 4. Interfaces and test plan

Use existing `createEngine`, `readWorkbook`, `writeWorkbook`, `convert` and
`runCommand` contracts; update public type consumers when contracts change.
Extend `Workbook`, `Sheet`, `FormulaNode` and declarative codec/provider metadata
at their actual owners, with snapshots and bounded accounting.

For each family, record source/profile/candidate hashes, smallest reproducer,
neighboring controls, applicable behavior, remaining scope and current proof.
Historical mismatch counts and earlier installed artifacts are not current proof.

- [ ] Every table row has current implementation and independent evidence in the ledger; applicable unknown cells and missing profiles are resolved.
- [ ] Each code repair has failing-before/passing-after evidence and appropriate package checks: `npx vitest run <exact files>`, `npm run lint --workspace=safe-bash-command-ssconvert`, and the selected maintained workspace build.
- [ ] Execute the source-authenticated native procedures in `ssconvert-reference-qa.md`, `ssconvert-biff-label-ranges-qa.md`, `ssconvert-database-file-codecs-qa.md` and `ssconvert-audit-qa.md`; record observations, not merely command exit codes.
- [ ] Run actual compiled SDK and command conversions for each changed profile. Independently decode native output records and recalculate in the matching application. For live label scalar/SUM cases require fresh values 2/5 from stale cache 999, preserved tokens and correct behavior after editing the former data gap.
- [ ] Execute installed artifact conversions outside the checkout with native commands absent from PATH; independently read edited output and compile strict consumers. Inspect actual CLI diagnostics and rendering screenshots.
- [ ] Before final integrated acceptance, run the maintained root build, tests and lint routes; fix failures and timeouts. A focused package result cannot close the complete integration gate.
- [ ] Verify each delivered commit's ancestry on remote main, required CI, actual registry version/provenance and installed release behavior separately. Close #1748 and complete the goal only after every requirement is proven; notify through hey-boss when ready.

## 5. Code plan

1. Repair active ledger/plan links and keep current findings concise. Use
   `docs/ssconvert/gap-resolution.json` for receipts and all 19 open rows.
2. Continue `packages/spreadsheet-format-xls/src/{biff-formulas,biff-write-formulas,biff}.ts`
   and `packages/spreadsheet-engine/src/formulas/{ast,parser,serialization,rewriting,label-references,dependencies}.ts`:
   complete flag, subtype, context and transport behavior from pinned sources.
3. Drain validated defects at the AST, engine and format owners above, plus the
   remaining command codecs, rendering, solver and explicit service adapters. Preserve unrelated
   work. Implement each atomic improvement with its own commit and delivery.
4. Update existing package/root support text and relevant public consumers as
   behavior changes. Qualify native and public profiles while releases run.
5. Reconcile the ledger with current evidence, finish integrated acceptance and
   monitor the containing release through publication. Retain only compact
   necessary provenance; put raw outputs in ignored `out` and purge consumed
   captures. Do not reintroduce the historical 70 KB rolling plan log.
