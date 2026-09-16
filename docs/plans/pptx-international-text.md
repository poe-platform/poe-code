# International text increment

Scope: the original `pptx` run formatting operation, paired SDK/CLI, script metadata preservation and mixed-script inheritance. No full pipeline or automatic rendering/font installation runs.

## Evidence and implementation

- Read `docs/specs/pptx.md`, shared Office CLI/SDK contracts and root ownership rules. No scoped AGENTS.md exists below packages/pptx.
- Consulted upstream test/API inventories and audits, the corpus manifest, and the existing font-formatting case ledger. Existing language variants remain tracked there; added the exact French-language-to-null write variant. Full language enum/live model parity remains an explicit gap.
- Red tests confirmed absent direct East Asian/complex/symbol typeface metadata, alternate language and run direction; implemented independent nullable fields.
- Red tests confirmed missing complex-script charset, pitch-family and PANOSE edits/extraction; implemented exact signed-byte charset, enumerated pitch-family and 10-byte hexadecimal PANOSE constraints.
- Local standards research used `/tmp/pptx-upstream-review/spec/ISO-IEC-29500-1/schemas/xsd/dml-main.xsd` CT_TextFont, CT_Boolean and ST_PitchFamily and shared ST_Panose; Transitional ST_OnOff additionally accepts on/off, Strict accepts XML booleans only. `rtl` is a child of rPr, after hyperlink children and before extLst; omitted val defaults false.
- Typeface and classification updates use namespace-aware deep merges. Creating classification requires an existing or caller-supplied complex-script typeface. Null-only removal does not create a font.
- Independent SAX inspection of the memfs command/SDK archive asserts namespace, element order and literal attributes. Mixed-script replacement tests use decomposed combining marks and multi-code-point emoji across runs, with original Arabic/Japanese text and independent expected output. Existing frame operations preserve eaVert while run metadata changes.
- Classification extraction distinguishes direct absence from schema defaults; no inherited flattening or font fallback selection. Existing effective ea/cs font resolution tests cover paragraph, layout, master and theme provenance per run.

## Checks and QA procedure

1. Run focused original tests in international-text, text-runs, command-text-runs, text-replacement and text-style-resolution.
2. Run maintained `npm run lint --workspace=pptx` and `npm test --workspace=pptx` before local commit.
3. Parent reviews disposable corpus fixtures from `docs/pptx/corpus-manifest.json`; no downloads or corpus bytes are unit dependencies or committed assets.
4. Parent captures scoped run help using the maintained screenshot route and reviews readability of the new script font flags.
5. Commit only owned files and this plan; no push or release.

Initial red runs: four script-metadata failures; one classification edit failure; four malformed-classification extraction failures; two dialect-specific direction failures. Focused script metadata/command tests passed after implementation. Maintained final package checks and corpus/screenshot receipt are recorded by the parent task.

All new wording/assets are original. No source project implementation or fixture was copied. Required existing research notice remains separate.

Root verification: all 1,892 tests across 72 package files passed, maintained
package lint passed, and `npm run build:workspaces -- --workspace=pptx` completed
the selected dependency closure. The actual Shell screenshot
`/tmp/pptx-international-help.png` shows complete readable help and an invalid
charset rejection, with statuses 0 and 2.

The manifest-admitted small template also passed an SDK/registered-shell byte
comparison for East Asian and complex-script fonts, charset -78, pitch-family
34, PANOSE, alternate language and RTL. All 38 decoded members were compared;
only slide 2 XML changed, and extracted text and both input copies remained
unchanged. Output was 1,202,623 bytes with SHA-256
`8888a76f7f28f0ba931140752229ad1f29c76388e5fc595c33fef7f4c1ea3b3a`.
Independent SAX attributes matched the supplied values. Full procedure and
admission details are in `pptx-international-fields-qa.md`.
