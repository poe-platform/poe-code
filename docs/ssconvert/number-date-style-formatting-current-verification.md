# Current number/date/style formatting verification

This follow-up preserves the existing shared TypeScript ESM formatter and virtual command, and repairs validated scientific precision differences. It does not complete all GOffice display semantics. The [earlier verification](number-date-style-formatting-verification.md) describes the implemented number/date/token/locale/text selection and independent style preservation; its finite-font preserve failures remain open.

## Changes and failing evidence

Four original native-backed cases first reproduced rejection of scientific masks above 100 fractional places. After removing that guard, the different agent's independent 144-case cohort exposed 56 disagreements. Normalizing a value by division into another binary64 mantissa discarded original decimal digits. Scientific formatting now scales and rounds the original exact binary64 rational once. Exponent selection distinguishes decimal-power neighbours, and carry detection uses the rounded decimal integer width instead of converting that string back to binary64.

Native fixed/scientific masks accept 128 places. GOffice's unsigned-byte printf precision operand wraps at 256, independently of placeholder emission. Product formatting reproduces that measured behavior. For example, native `TEXT(2.5,256 fractional placeholders)` emits `3.` and 256 zeroes. The independent report cites and authenticates the released source operations rather than inferring this from JavaScript formatting.

Twenty new formatter regression/negative tests accompany these repairs. The actual safe-bash command/SDK integration test now exercises scientific precision in preserve mode. An additional original/checkpoint/replay test calculates scientific TEXT, compares command and SDK bytes, recalculates after updating the precedent, retains independent style records, and checks the complete memfs namespace and borrowed workbook.

## Reference and exact candidate

The official Gnumeric archive under existing `out` source scratch was reauthenticated against `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. The native binary, spreadsheet library and GOffice library were rehashed and match the [captured dependency/plugin/locale profile](number-date-style-formatting-profile.json). Native execution stays in the separate Docker oracle, with explicit C/UTC environment; it is neither a product dependency nor fallback. No ambient Intl guarantee is used.

The [current candidate profile](number-date-style-formatting-current-profile.json) binds 269 live source/test/configuration inputs, Git HEAD, original fixture bytes, argv/status/stdout/stderr, exact expected/actual bytes, and final check-log hashes/summaries. This is an uncommitted live candidate; its source digest is not a Git object. Source bindings were verified again after checks. The independent reviewer provides a separate [verification](number-format-current-independent-verification.md) and [profile](number-format-current-independent-profile.json).

## Deterministic semantic results

| Cohort | Result |
| --- | --- |
| Four initial scientific rejection regressions | 4/4 native byte matches after repair |
| Different agent's original scientific/engineering cohort | 144/144; initial 56 disagreements repaired |
| Different agent's independent precision/power/carry cohort | 143/143 |
| Root's separate fixed/scientific 255/256/257/511/512-place cohort | 10/10 native byte matches |
| Existing main C/German cohort, rechecked against recorded native outputs with final product source | 277/287; ten preserve failures remain |
| Independent focused formatter/TEXT unit suite | 192/192, including 16 new independent tests |

The main-cohort native outputs were reused from their authenticated captured profile; this follow-up did not freshly execute those 287 native calls. The newly acquired precision cohorts executed the oracle independently. Cohorts are deterministic enumerated lists; their minimized regression cases and full fixture bytes are retained, with no randomized seed or performance qualification.

Cancellation and budget controls cover exact output-byte acceptance, one-less rejection, borrowed cancellation identity during scanning, workbook work exhaustion, UTF8/pattern admission in the maintained suites, and a negative ambient-Intl control. The command/SDK suite also exercises explicit host capabilities, cancellation/error statuses, diagnostics and namespace preservation. These finite controls do not establish arbitrary host isolation or every realm/runtime cell.

## Final maintained checks

| Command | Result |
| --- | --- |
| `npm test --workspace=@poe-code/ssconvert` | exit 0; 127 files, 3,375 tests; fresh execution |
| `npm run lint --workspace=@poe-code/ssconvert` | exit 0; ESLint plus source/test TypeScript |
| `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache` | exit 0; maintained selected closure, 18 builds |
| `node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/ssconvert.test.ts` | exit 0; 40 pass, zero failed/cancelled/skipped/TODO |
| `npm run lint:eslint` | exit 0; complete 16,714 configured inputs; zero errors, four warnings |
| `npm run typecheck --workspace=@poe-platform/safe-bash` | exit 2 before compilation; failed preflight, no consumer/runtime execution |

The typecheck failure is concrete: `tests/plugins/qualified-current-release/peer.mjs` requires root `./safe-fs` to import `./packages/safe-js/dist/safe-fs.js`; current root exports omit that entry. Existing invocation-cleanup and S3/HTTP negative controls explicitly assert this rejection. This follow-up preserves that separate export/identity work and does not weaken the preflight or claim the route passed. Parent Git environment and private/global Git configuration were unchanged; none of the repository-local Git environment variables were present in child environments.

## Remaining failures and unverified cells

The same five preserve cases fail in both measured locales: `*x0` fill repetition, General precision at 1.2345678901234567, accounting hair-space padding, General exponent selection at 1e16, and font-dependent mixed-fraction spacing. Exact bytes remain in the current profile. The unlimited-width default formatter cannot reproduce these finite-font/column layouts. Captured displayed text or an injected formatter can preserve supplied display; that mechanism is not a repair of the measured default failures.

Arbitrary locales/LCIDs/numeral shaping, every custom or malformed format variant, scientific whole-placeholder widths of 256 or more, all date/rounding/serial boundaries, arbitrary font metrics and theme/palette/rich-text codec round trips remain unsupported or unmeasured as detailed in the earlier report. Existing style records remain independent and unchanged in exercised fixtures; this is not all-codec style serialization proof. Cross-realm formatting execution and all mapped upstream runtime variants are unverified. Existing command/SDK original/checkpoint/replay checks establish their exercised host only. Interruption during synchronous BigInt arithmetic and time/RSS budgets are unmeasured.

Full-root `npm test`, full-root `npm run build`, root type/workflow lint and the whole safe-bash unit suite were not executed in this focused follow-up. They are not counted as passes or completed broad gates. CLI visual screenshots were skipped because these changes affect conversion data bytes and add no CLI UI; byte comparisons validate those outputs. Manual QA was executed from [the Markdown procedure](../plans/ssconvert-formatting-current-candidate-qa.md).

No README edits, staging, commits, push, remote-main delivery, publication or release were performed. Owned scratch is purged after reducing its evidence; preexisting native/source artifacts and unrelated work remain intact.
