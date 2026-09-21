# XLSX import verification

The source inventories and gate receipts below qualify the earlier candidate. The [current followup verification](xlsx-current-verification.md) records later shared-string, namespace-registration and exact command-warning repairs, fresh native controls and final source fingerprints; earlier cohorts remain historical evidence.

The bounded `Gnumeric_Excel:xlsx` reader is implemented in `packages/ssconvert/src/codecs/xlsx.ts` and registered through the existing declarative Excel provider. The SDK and safe-bash virtual `ssconvert` command use the same engine, injected byte I/O and cancellation. This is a verified partial implementation of the requested Gnumeric importer; it does not establish full OOXML feature parity.

Reference source: Gnumeric 1.12.61, official archive SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Primary sources remain under `out`. The native executable is a separately profiled QA oracle, with no product dependency or fallback. [Source audit](xlsx-source-audit.json) inventories the stable reader registrations, included modules, namespaces, handler behavior and plugin MIME/probe declarations. [Independent verification](xlsx-independent-verification.json) preserves original fixture ZIP bytes, oracle dependencies/plugins/locale, argv, statuses, diagnostics, XML outputs, failing cohorts and final source inventories.

## Implemented and exercised

- Stored/deflated OOXML ZIPs and `.xlsx`/`.xltx` imports; native member-existence probe independent of suffix/content types; explicit importer selection and actual command/SDK output parity with memfs replay.
- Workbook/sheet order, visibility, duplicate sheet identity, shared/inline/rich strings, styles and measured theme colors/tint, inherited XFs and row/column formats, 1900/1904 date systems and calculation settings.
- Ordinary/shared/array formulas and caches, relative reference translation, measured native formula spelling, boolean/numeric cache edge cases, names/reserved names and invalid-name warnings.
- Merges, row/column sizing, views/freeze/protection effects, comments, hyperlinks without target fetching, measured custom filters, print margins/scaling/orientation/paper/header/footer/breaks and core document properties.
- Source-based unknown-node recognition and measured warning ordering/namespace fallback/extension suppression. Unused table/drawing relationships are ignored in the measured cases.
- Package member/path/aggregate inflation bounds, OPC traversal rejection, XML entity rejection, sheet/cell/node/text/work bounds, owned byte input and original cancellation-reason identity. These product security tests do not establish native malformed-input diagnostic parity.

The schema expands/deduplicates 1,685 recognition declarations across 17 source DTD tables and 27 namespace entries. Recognition is distinct from semantic implementation. The profile does not establish strict OOXML namespace support; genuine workbook.bin/XLSB has no reader. Native plugin suffix declarations also list xlsm/xltm/xlsb, but those declarations do not prove binary, macro or encryption support.

## Differential results

A concrete regression preceded the reader implementation: both stored and deflated `.xltx` memfs fixtures failed with `E Unsupported file format for file "book.xltx"` (two tests failed). Further native-backed regressions preceded each measured warning/cache/style/metadata repair. [Check captures](xlsx-check-captures.json) preserves the initial root failure and subsequent task-owned log hashes/excerpts before scratch cleanup; the independent evidence preserves its separate failing cohorts.

A different agent stressed the actual engine, established failing regressions and verified repairs. Its final 30-fixture conversion cohort matches native status in **30/30** cases and exact diagnostics in **30/30** cases. Successful cell records match in **25/26** compared cases; shared-expression export representation is the remaining measured cell-record mismatch. Explicit compared metadata/style/rich-text/theme records match. Native default Gnumeric scaffolding also differs. No complete XML identity or lossless editing claim follows from these results.

The final independent source inventory contains 302 ssconvert TypeScript files, unchanged before/after replay and rechecked by root, including current inventory membership (no added or missing TypeScript files). XLSX reader SHA-256: `b54497a27307bd41e414470476ce7806db760c9b74415eb005921480a472326c`. Historical failed/pre-repair cohorts remain separately labeled; final results qualify only the named fixtures under the recorded C/UTC oracle profile.

## Maintained checks

| Command | Result |
| --- | --- |
| `npm test --workspace=@poe-code/ssconvert` | Passed: 147 files, 4,031 tests; fresh Vitest execution |
| `npm run lint --workspace=@poe-code/ssconvert` | Passed: ESLint, production and test TypeScript checks |
| `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache` | Passed: 18 declaration-derived workspace builds, including office-package, safe-fs, ssconvert and safe-bash |
| `node --import tsx --test packages/safe-bash/tests/commands/ssconvert.test.ts packages/safe-bash/tests/commands/ssconvert-encoding.test.ts packages/safe-bash/tests/commands/ssconvert-text.test.ts` | Passed: 50 tests, no skips |
| `npm run typecheck --workspace=@poe-platform/safe-bash` | Failed before compilation, exit 2; see below |
| `npm run lint:eslint` | Passed, exit 0: maintained guarded root ESLint route; 16,756 subjects, zero errors, four warnings |

The safe-bash typecheck peer-profile admission asserts `package.json.exports["./safe-fs"].import === "./packages/safe-js/dist/safe-fs.js"`; current root metadata has no such export. Concrete failure is in `packages/safe-bash/tests/plugins/qualified-current-release/peer.mjs:245`, before any builds or consumer checks. Existing package/export edits were preserved, and no assertion, profile or realm-identity requirement was weakened. This gate is not a pass and strict safe-bash consumer type coverage remains unverified.

An ad hoc screenshot of the actual virtual command's importer listing was visually inspected: the XLSX importer appears, columns are readable and the existing C-locale rendering is retained. No screenshot tests or visual design changes were introduced. This inspection does not verify graphical workbook rendering.

## Remaining work and limits

Validation and conditional-formatting records currently retain source ASTs; full native rule parsing/evaluation, warnings and export are not implemented. Drawing/image/chart/pivot/extension records generally remain unsupported raw metadata; image contents and chart rendering/fidelity are not preserved or verified. Full external-link/name calculation semantics, advanced print/style/theme behavior, recovery and warning ordering for malformed optional parts, every namespace/version handler combination, alternate locale behavior, genuine VBA/macros and encrypted OOXML are unmeasured. Exact exported shared-formula ExprID representation and default native Gnumeric scaffolding differ. The independent evidence lists each remaining measured mismatch and unmeasured category; none is counted as a pass.

No README files were edited. No local commits, pushes or publication were performed. Existing unrelated edits and oracle files were preserved. Task-owned disposable captures/logs are reduced to evidence and removed after checks finish.
