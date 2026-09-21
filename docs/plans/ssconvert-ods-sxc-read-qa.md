# OpenCalc ODS/SXC import procedure and measured coverage

Task: `ods-sxc-read`. Product: TypeScript ESM `@poe-code/ssconvert`, virtual command exactly `ssconvert`. The provider attaches the reader declaratively; CLI, SDK and Safe Bash use the existing conversion engine. Native Gnumeric is a separate QA oracle, without product fallback. Root owns integration, exports and Git. No README edits, commits, pushes or publication were performed.

## Procedure

1. Preserve existing work. Inspect root and Safe Bash instructions, provider discovery, ZIP/XML contracts, workbook ownership and conversion lifecycle.
2. Acquire the official Gnumeric 1.12.61 source archive only in task-owned `out/ods-sxc-read`. Verify SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12` before extraction. Audit reader handlers and retain source citations below.
3. Add an original small in-memory ZIP regression using injected memfs I/O. Run it before implementation; its concrete initial failure was `E Unsupported file format for file "book.ods"`. Unit fixtures never write host files, spawn native commands, or query an LLM.
4. Implement bounded ZIP/XML import, formulas and caches, styles and metadata. Reproduce every repair before changing code. Keep unrepresented metadata in owned source records, without treating retention as semantic compatibility.
5. Use a different agent to stress/fix the implemented tool. Execute the [independent procedure](ssconvert-ods-sxc-independent-qa.md). Root retains export/integration/Git ownership.
6. Build unchanged native Gnumeric/GOffice in an isolated oracle with the captured profile below. Run original small fixtures outside unit tests. Capture status, output and diagnostics independently. Retain failed oracle-build attempts as failures; do not suppress their diagnostics or remove unrelated Docker data.
7. Run maintained uncached workspace builds, ssconvert workspace tests/lint, Safe Bash integration and maintained targeted test selection. Capture and inspect an ad hoc screenshot of the actual virtual conversion. Record all failures and unmeasured cases below.
8. Reduce evidence into this document and the independent procedure, remove only task-owned oracle containers and scratch, and leave product sources/tests for review. Do not push or publish.

## Source audit

Citations refer to the authenticated archive's `plugins/openoffice/openoffice-read.c`. Namespace/state data in `odf-schema.ts` derives from its three stable reader tables, not from product native execution.

| Area | Stable source contract | Implemented/verified extent |
| --- | --- | --- |
| MIME/probe/version | `OOVersions` at 114–130; `identified_google_docs`/`determine_oo_version` at 13964–14020; probe at 14413–14437 | Exact modern spreadsheet/template and legacy spreadsheet MIME; filename-sensitive legacy fallback; first-512-byte office-namespace fallback; modern/legacy namespace aliases. Requested legacy template MIME is also accepted as an explicit extension. |
| Package parts | `openoffice_file_open` at 14025–14338 | ZIP ownership, canonical members, duplicate/symlink rejection, aggregate inflate/XML limits; optional styles/meta/settings/manifest; encrypted parts rejected. ODF uses manifest paths and XLink targets rather than OPC `.rels`. External URIs remain passive. |
| Reader recognition | styles table at 12198–12380; legacy at 12382–12516; ODF at 12518–12804; preparsers at 12806–12829 | Derived state edges preserve recognized parent/namespace relationships; known unexpected elements warn in both content passes; unknown foreign extensions are skipped. Full prefix-rebinding/libgsf effects are unmeasured. |
| Repeated rows/cells | row handlers at 3841–3937; cell handlers at 3964–4290; repeat copies at 4294–4320 | Empty repetitions stay sparse. Materialized values and axis expansion are admitted against limits and yield for cancellation. Only the first repeated cell owns a formula; copies keep cached values. Dense meaningful metadata still has explicit bounds. |
| Typed values | ordered attribute scan at 3998–4105; text/error callbacks at 4323–4424 | First valid value attribute in source order; numbers/booleans/strings/date serials/full H-M-S durations; paragraph/space/tab/line-break content. Empty-formula errors reproduce the native persistent text-cell pointer behavior. General malformed C-scanner recovery is unmeasured. |
| Formula conventions/cache | `oo_conventions_new`/`oo_load_convention` at 2299–2356; type selection at 3938–3961; expression/value assignment at 4224–4274; queue-all-recalc at 14404 | Shared AST parser and serializer handle OpenFormula, `oooc:` legacy and `msoxl:` conventions, relative/absolute/cross-sheet references and names. Caches survive initial import; parsed formulas are dirty for ordinary conversion recalculation. Empty/missing caches are distinguished. |
| Matrix formulas/names | matrix setup at 4230–4264; named-expression handlers at 3488–3663; preparse name entries at 12813–12815 | Array ranges, per-cell caches, implicit interiors, missing-axis warnings; workbook/sheet names and base-sheet/coordinate ownership. Overlap/error recovery and all external-name cases are unmeasured. |
| Styles/formats | number/date/time handlers at 4984–5921; style handlers at 6585–6968; style tables above | Named/automatic inheritance, default row/column/cell formats, per-column resolution across repeats, font/alignment/color/protection/basic borders; raw declarations retained. No claim of complete number-format or conditional-format translation. |
| Rows/columns/merges | column/row handlers at 3687–3937; merge handling at 4105–4220 and 4284–4290 | Dimensions in points, hidden/outline metadata, grouped/header axes, bounded merges; Gnumeric fake-span extension honored. Axis extents include their last metadata index. Repeated styled/hidden axes remain bounded rather than universally compressed. |
| Validation/conditional formats | validation handlers at 2912–3265; style-map handlers at 6405–6580; stable table entries | Definitions, references and style maps remain in source records. Complete executable validation/conditional-format overlays are **unsupported**, not passes. |
| Annotations/links | text/link callbacks at 4323–4479; annotation handlers at 4485–4539 | Exportable comment objects, inline annotation text, passive Gnumeric hyperlink style regions, released URI classification and workbook-target conversion. Rich annotation font export and unusual link cases are unmeasured. |
| Drawings/charts/images | drawing/chart handlers and tables at 7659–12171 and 12662–12777 | Anchored source records, ZIP-relative embedded XML, cycle deduplication, owned image/OLE byte retention, traversal rejection, aggregate text/node/work limits; no implicit external acquisition. Complete rendering, chart-model conversion, image decoding/export are **unsupported**. |
| Database ranges/filters | `oo_db_range_start`/filter handlers at 4650–4761; table at 12790–12801 | Database declarations retained; basic exportable filter records with shared address parsing and released XML attribute conventions. OR/grouped conditions and actual filter execution remain unsupported/unmeasured. |
| Print/settings/meta | print layout handlers at 5940–6404; configuration at 11600–12041; application at 14326–14327 | Raw settings/meta/print declarations retained; selected orientation/margin/scale/header-row mappings exported. Pagination, print ranges, complete headers/footers, view/configuration application and metadata-property translation remain unsupported/unmeasured. |

## Native measurements

The existing [reference qualification](ssconvert-reference-qa.md) and `docs/ssconvert/reference-profile.json` remain unchanged. This task captured an additional explicitly qualified **importer QA profile**, with identical Gnumeric/GOffice release sources but its own Debian dependency and binary identities. It does not replace the frozen profile or certify optional plugins.

Oracle attempts: the first container's apt installation failed because the Docker VM disk was full. A host-mounted chroot attempt failed during package extraction because files created with mode zero were inaccessible through that mount. The successful attempt used an invocation-owned temporary memory filesystem with executable permission and a correctly permissioned `/tmp`; it built unchanged source. All source acquisition stayed inside task-owned `out`. No VM resize, unrelated cleanup, product process spawning or host fallback occurred.

Each fixture was authored for this task, outside unit discovery. The following seven native `-T Gnumeric_stf:stf_csv` conversions matched **status, CSV bytes and stderr bytes**, under the captured C/UTC profile. These are measured conversions, not a full import/export equivalence claim:

| Fixture | Verified behavior |
| --- | --- |
| `values.ods` | Date/time serials, boolean, text/error-pointer recovery: `61.5,1.0416666666666667,TRUE,#DIV/0!` plus newline. |
| `repeats.ods` | Dirty anchor recalculates to 3; repeated copies retain 99: `3,99` then `99,99`, each newline terminated. |
| `cross.ods` | First-sheet CSV `7` plus newline; an additional native `-O sheet=Output` capture produced `9` plus newline. The additional selected-sheet invocation was subsequently compared through the actual virtual command: status 0, `9\n` stdout and empty stderr exactly matched native. This is an eighth measured invocation, outside the original seven-tuple capture. |
| `metadata.ods` | Linked/annotated styled text exports `label` plus newline. This does not prove complete metadata export equivalence. |
| `unknown.ods` | Value `2` plus newline; exact unexpected-element warning appears twice in order. A separate C.UTF-8 native capture also succeeded. |
| `template.ots` | Modern template MIME import and empty-sheet CSV newline. |
| `legacy.sxc` | Legacy namespace/value/formula conventions; recalculated ADDRESS produces `8,Legacy!$B1` plus newline. |

Native XML was also inspected to establish repeat-anchor formula ownership and the displaced empty-formula error. Full XML bytes differ through existing writer defaults/metadata and were **not** reported as passes. The requested `application/vnd.sun.xml.calc.template` MIME is an intentional product extension: upstream's MIME table rejects it. An invalid modern-body fixture with that legacy MIME failed in the product too; it was not counted as an import pass.

## Remaining mismatches and limits

- Whole-release compatibility, every dependency/plugin/locale profile, diagnostic recovery for malformed inputs, and byte-exact Gnumeric XML round trips remain unmeasured. The seven stated fixture cohorts and the additional selected-sheet invocation matched complete output/status/diagnostic tuples.
- Validation and conditional formats, complete native chart/drawing/image translation/export, database filter execution/OR composition, complete print pagination/settings/meta application, and uncommon number/date formats are not implemented merely because their XML is retained.
- Missing/invalid named-expression bases, invalid numeric/date/duration scanners, zero/oversized repetitions, conflicting/overlapping merges and arrays, legacy implicit date/time formats, duplicate sheet/name recovery and namespace prefix rebindings do not have complete native recovery equivalence.
- ZIP duplicate/symlink/traversal/entity rejection and encryption rejection deliberately preserve product host isolation. Native recovery/status wording for these cases is not generally identical. URI fragment/query and percent-encoded absolute-path variants remain unmeasured; they never authorize external fetching.
- Source records preserve unknown-to-model information but existing export codecs do not export every retained ODF record. Retained binary image/chart data is not a rendered/exportable graph. Work/text/node budgets may reject otherwise native-readable large documents; unsupported cases are not counted as passes.
- Large meaningful axis repetitions are bounded metadata expansion. Empty repeated values remain sparse. Synchronous hex serialization is budgeted; arbitrary timer-driven interruption within its loop is unmeasured, though decode/XML/resource cancellation preserves the original reason.
- Import itself never invokes external-reference resolution or transport. Subsequent shared formula calculation can use an explicitly injected synchronous host resolver, as specified by the existing SDK contract; the importer introduces no network or filesystem capability for external links.

## Verification record

Verified final checks:

- `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache`: exit 0; maintained three-workspace build closure.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`: exit 0; maintained eighteen-workspace build closure.
- `npm test --workspace=@poe-code/ssconvert`: exit 0; 171 test files, 4449 tests passed. This uncached Vitest execution includes ten reader, two metadata and twenty-six independent stress cases.
- `npm run lint --workspace=@poe-code/ssconvert`: exit 0; maintained ESLint/source TypeScript/test TypeScript checks.
- `node --import tsx --test packages/safe-bash/tests/commands/ssconvert*.test.ts`: exit 0; 57 tests passed, zero skipped/cancelled/failed, across five command integration files, including two new ODF cases.
- `npm run typecheck --workspace=@poe-platform/safe-bash`: **failed**, exit 2. Current package/export qualification requires `poe-code/safe-fs` to target `./packages/safe-js/dist/safe-fs.js`, but the current root export is absent (`actual undefined`). Reproduced by the maintained guard at `tests/plugins/qualified-current-release/peer.mjs:245`. Root metadata and the guard were preserved; this is not a passing integration/typecheck gate.
- Actual virtual-command screenshot captured with maintained `npm run screenshot`, inspected visually: invocation, `3,99`, `99,99`, `exit 0`, without native product execution. Screenshot SHA-256 `94ca2c7af71435bbb26db06965e562d3d90627502def4e8016442162e0f43837`. Raw generated screenshot is temporary evidence, removed after inspection.

`npm run lint:eslint`: exit 0, guarded root execution complete, zero errors and four warnings. The warnings concern existing unused symbols in `packages/docx/src/operation-types.test.ts`, `docx/table-model.test.ts` and `zip-review.test.ts`; they were not suppressed. The guarded declaration covers 16804 linted subjects and preserves separately reported ignored/unconfigured/held boundaries.

`npm test --workspace=@poe-platform/safe-bash -- --test-name-pattern=ssconvert`: **failed and incomplete**, not a pass. Maintained discovery authenticated 1339 active files, six fixture roots and five held roots. After over 400 files, `tests/commands/network/http.test.ts` failed its cleanup hook (`Cannot read properties of undefined (reading 'close')`, line 7). A direct filtered reproduction produced the same `hookFailed` result and remained open; both owned verification process trees were stopped after retaining the failure (maintained run exit 143; direct diagnostic run exit 1). The name filter is not an independently qualified complete-workspace selection; skipped cases are not counted as passes. No unrelated network tests or cleanup assertions were changed. No local commit, remote-main delivery or release is claimed.

## Captured oracle identity

The isolated oracle used Debian image `debian@sha256:a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a`, unchanged Gnumeric 1.12.61 and GOffice 0.10.61. GOffice archive SHA-256: `558597fd9ca59b93ff562750218d1e7ea8ec3c8d0ed6a5cc096aa715ef909a15`. Both configured with `--prefix=/opt/ssconvert-reference --disable-introspection`; Gnumeric additionally used `--disable-component --without-python`; compilation used `make -j2`.

Runtime: `LC_ALL=C`, `TZ=UTC`, isolated HOME/XDG config/data/cache directories, `LD_LIBRARY_PATH=/opt/ssconvert-reference/lib`, `GSETTINGS_SCHEMA_DIR=/opt/ssconvert-reference/share/glib-2.0/schemas`, `XDG_DATA_DIRS=/opt/ssconvert-reference/share:/usr/local/share:/usr/share`. The initial missing-schema invocation emitted GLib critical messages; it was corrected and the clean captures below were used, without suppressing stderr.

Exact dependency package inventory, linked-library/plugin hashes, compiler flags, locale, importer/exporter listings and seven differential tuples are retained as gzip/base64 JSON below. Decode base64, decompress gzip and parse JSON to inspect the named captures. Uncompressed JSON SHA-256: `037b9af1071f3c841afa33b9fa06d39c5bcce2fe060f26f116a46c3f97bcd916`; 66152 bytes. This captures actual oracle identity, not product dependencies or optional-profile qualification.

<details>
<summary>Exact captured profile and differential evidence</summary>

```text
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
```

</details>

## Reproducible original oracle fixtures

The same gzip/base64 JSON decoding procedure recovers each original package part below, together with its measured original ZIP SHA-256. Rebuild small ZIPs from the named UTF-8 parts to repeat the native QA invocations. These are QA fixture definitions in the procedure, not unit-time host file writes. Uncompressed JSON SHA-256: `e93c58679b76c0e6ebbb1a71e2cd05f1c39523567f0ff6009dfb05be022e1f3f`.

<details>
<summary>Original package parts</summary>

```text
H4sIAAAAAAAC/+1YbW/bNhD+K5lbDBtWSSRFiZKSGkjXASuwNyzFviz7wFdHqCRqEtU4K/rfd5TkJHbSOFixth/8RZbIu+eOx7vnSL9byM72fWhVvyjeLVre
ufFF2sbpxoXruloUixNbKCuHGkaCeeYIZpq+sM/PF0PXFJb3ZV80vNZ94WRhW91sNIpZ0phS6gKH6HwxK7tHKzsuqm3d9eN19dptqfaPVu3d1Y7Z5tG6ijt+
V988Wn/dV4GxEO665a7cXX4FOBfOtUUUXV5ehpdxaLtVhPM8j9ZV2by5FlTyRrIdumqUUzLSlfbG+giHOAJpW7zVXV9av0AckvPFEjadD87WYF0G40r65Ul0
36AthFVX/rdvO81Vf6G1W564aduO3LhOwH3VtIPzyPNM0NnLmw+pq8q7wavBC7PzRQT2tkQ3X/dg/zq4veCuMLarh4qDvDXF8z9Hh8JT/Nd3ZArBbDvfY9vb
VIFew2p7H7P+ZrDjzeqWW6+t4xVgu0LwfnIj4Ep5PZh9Ojnw9PQpHmXG6RHhQ0KTW/fYj3aCH202Jbpbu8vFs0Vd1tpdtRqqm7dtVUrYUdtEbxsVjrkZ3k7J
8Bb04v2zxT9le3bBSZKCtoiFMYbxVGQUSy61ErmIExNTGVPBMGKpyiRWIERpplOKlUaMJooqomOUebxKr7i8Cvu1/M8kNKe493pimjHRCUIomr63WOcB6XGT
p/SfAngn1X4avd2XaptcysZN+2AePj99+fL3H87OvsHH5Dg+/vrvwbrjycL0/u2YGb3rymYVbEBf4Acz9CM2vx8aH+9Q8krubjVJiJaIiyzT2GCMNU0IRyyX
mGSC40wpnnKcsyROBQzrOBOJyVCsTaokptTjgWHuqfHQcQ4d51EdZ47JUb8pvxdApKAOK+N1WV3ByE1pjeM+DpN6MKv8MtQeftqZoO1g8Z0rdX9koBIhwy51
ubrwuSFspabKms3eY//7i9ILPeAA5LTP2y0XJq9HH66Ftz0RXL5ZdXZoFGxBZTtQemIMUBLa8agpmqEWugt2HJtXuZk+agqlZVlzsFMBL/sk9G2uKeqyCUqo
qRVgqHJVOj81M8o2+Ec2/LN9JLkVok1g5z4ceIaC4Yn6PNK6aP2DH1XFRafNnGY95Jle87qtdFg2oFqqiIN4xYWuTiKQX/pnO6ZX00BD9mS3PFGykOC8s93y
VPGT6Nb3aAkk9awYbWtGt1fxIAt/npYsiadciblKuRA4ZSmlJuGMMWjUCTeIxznOCYsJkzqPaY6TlGiCqM4MTtPc43W6hVgcLgYHmv4EF4NdnvAzEwvBRx9M
uajVRGB3SGQWBdIc6mZX+s6hH++e9fO7lGMqy92+E9bnqe0sRURlKeU840LFEk7QOCYx4zqJGeI0zihNUJaYNMnSDGmdJVxSOHkToQXJscdzGsgSQhRadyju
Q3H//8UdfcKCCTbZvVs5jBGN41jBrSUzqZFIp7nK41wplkjDaZpISkyWU6UoyrnC1CCh8gxJjtOYjpUzNG8ae9kcuuKhcD5ZV5xzLnrc32bky2xbjMUQbE4V
dCoDJcYwIkZTliAYoYlShFFGjVBpYgxVeU60IUizhBgjWDIW87jEw4n0UHuf4UR6f71tzosQQD065l+u/6TDOUIBigOEX2NSIFTMN/mHkBwU3IjkX66RfntN
kh/Rz+hsr76wttK8GSHm92sU1w16L8D2bZvDsz9aF35nYq8rYACUo6Wcr8b+oTbX5O178YP/ve+75z95+eqPCH11P/IXR2+GE5TgLMmQyfOUoTiFY7lUWMg4
M4pygUgemzxOmJZUY8QFEcB4eSoMZoapxfv3/wKM8SKEihsAAA==
```

</details>

## Gate evidence reduction and cleanup

Guarded root ESLint final summary (full output retained through inspection; generated raw log removed afterward):

```json
{
  "complete": true,
  "exitCode": 0,
  "errorCount": 0,
  "warningCount": 4,
  "scope": {
    "configured": 16804,
    "linted": 16804,
    "ignored": 2044,
    "unconfigured": 38803,
    "ignoredDirectories": 166,
    "heldExcluded": 5
  },
  "timings": {
    "traversalMs": 409362,
    "parsingMs": 4531,
    "initializationMs": 25488
  },
  "cacheHits": 16755
}
```

- `red.log`: SHA-256 `512af02bf7a5e2da588fe90cf863c1f61caf6e2b625bcf95de2868eaeb48fe44`, 2366 bytes, inspected before reduction.
- `axis-extent-red.log`: SHA-256 `522ea213cd0994f6df7a0f6ec5c668be415597589f1827af5d43a073d4f14107`, 2014 bytes, inspected before reduction.
- `column-defaults-red.log`: SHA-256 `94944f82bebe3445cf7e3c8fa95e37f7455c35a023d6b8803881db74101339c8`, 2084 bytes, inspected before reduction.
- `build-final-accepted.log`: SHA-256 `648daf0944bd6b81abe6938bfb9686040049b1e77b426f395240f42b8eefbbcc`, 716 bytes, inspected before reduction.
- `unit-final-accepted.log`: SHA-256 `a4e76e63c9917a1f3a9eab07941c26e3e1fae3db541f2a77d37078cbb6c9366b`, 14197 bytes, inspected before reduction.
- `lint-final-accepted.log`: SHA-256 `c4d01086f7d2047ba347cb7ac01f353e5ab2bc83fc8844becd30dce5d2fee2c1`, 132 bytes, inspected before reduction.
- `cross-workspace-final-accepted.log`: SHA-256 `f979d68b4e4a605263ae1a577c9602038cbc4f82cf7df884f6c33ef59029cb89`, 13368 bytes, inspected before reduction.
- `safe-bash-types.log`: SHA-256 `81efc1086d481dec7e35d40fc010527998994eff25152930cfb0df9daa6a51e3`, 686 bytes, inspected before reduction.
- `safe-bash-build.log`: SHA-256 `7bfdd06bf85ab9fd9ab24985ce0ee7eaab4a7b51f259cf16a2f8d413901fc48a`, 2354 bytes, inspected before reduction.
- `root-eslint.log`: SHA-256 `5a71ce81afafe05710f42ddccccff9d0438302a59a0d50c4a13ad60d4b099acb`, 2257664 bytes, inspected before reduction.
- `safe-bash-maintained-tests.log`: SHA-256 `7ecb64e443af2601d910c4fadab98ba84932fb5d6bd037003609f8770fd3bbc5`, 427 bytes, inspected before reduction.

The task-owned `ods-sxc-read-native` and `ods-sxc-read-oracle` containers were removed. The unrelated `ssconvert-statistics-qa` container was preserved. Only `out/ods-sxc-read` is purged after durable profile/fixtures/results are retained above. No source archive, generated screenshot or raw run logs are kept outside `out`; no README, Git staging/commit, push or publication was performed.
