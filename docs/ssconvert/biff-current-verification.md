# Current BIFF import verification

The existing TypeScript ESM ssconvert BIFF/CFB implementation and virtual-command binding were preserved. This follow-up repairs built-in NAME identifiers and suffixes, complete Unicode/header consumption before formula tokens, empty NAME placeholders, bounded retention of untranslated NAME records, and Gnumeric XML named-expression export. The encoding importer remains a separate priority-200 nonprobe service. Native execution remains solely a manual QA oracle. No README, export/package configuration, Git commit, push or publication changes were made.

Four original name-import regressions failed before repair. A separate XML-export regression and two independent parser regressions failed before their corresponding repairs. The independent reviewer owns ten original in-memory stress cases and documented procedures in `docs/plans/xls-biff-read-name-stress-qa.md`. Root's procedure is `docs/plans/xls-biff-read-current-qa.md`. Unit tests never invoke native utilities or create host files; virtual-command file effects use memfs.

## Final checks

| Check | Result |
| --- | --- |
| `npm test --workspace=@poe-code/ssconvert` | Passed: 161 files, 4,250 tests; fresh execution, no test-result cache |
| `npm run lint --workspace=@poe-code/ssconvert` | Passed: ESLint, source and test TypeScript checks |
| `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache` | Passed: maintained dependency closure, 18 builds including native npm suffix stages |
| Maintained `test-reporting.mjs` runner, four ssconvert command files | Passed: 52 tests, zero skips/cancellations; command/SDK bytes, corruption rollback, encoding registration, names and XML replay |
| Scoped ESLint for changed Safe Bash integration test | Passed; not the guarded full-root lint route |
| Independent NAME/export stress | Passed: 48 focused tests and final ten-case stress run; not a broad gate |
| Actual virtual-command importer-list screenshot | Inspected; distinct excel and excel_enc rows visible |
| `npm run typecheck --workspace=@poe-platform/safe-bash` | Failed, exit 2 before compilation: public SafeFS export prerequisite mismatch |
| Full root tests/lint/build, full Safe Bash suites | Not run; not passes |

The failed typecheck was investigated: `tests/plugins/qualified-current-release/peer.mjs:245` requires root `./safe-fs` to point to `./packages/safe-js/dist/safe-fs.js`, while the current root manifest has no such export. The maintained runner reported zero builds, zero consumer groups and cleanup complete. Reintroducing the legacy export would change existing work outside this codec task; the prerequisite remains unresolved. A successful selected build or scoped lint does not substitute for that failed check.

The first expanded command test used stale built XML emission and failed; it was rerun after the final uncached build. Another assertion incorrectly assumed XML preserved BIFF sheet IDs and ordinary object prototypes. It now checks the public XML sheet namespace (`s1`) and exact serialized semantic fields. The complete four-file selected integration gate subsequently passed.

## Native measurement

The authenticated source archive remains only in out and matches SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Stable `ms-excel-read.c` hash is `fba376ae47e276e9209800415a44e1060cc775745d3bdd8b400770d0c0f49216`, matching the existing source audit. The prior inventory of revisions, all 330 defined opcode values, 148 reader labels and 381 formula descriptors remains in `biff-source-audit.json`; dispositions are not per-opcode semantic parity passes.

Fresh QA used the existing explicitly selected colima Linux aarch64 Gnumeric 1.12.61 oracle, LC_ALL=C, injected library/schema paths, and freshly captured dependency/plugin/importer/locale profile. Binary hash `104f1e5500432c95ac3d46a679d476d05d2bf84e7483e991d212703cb0ed131c`, Excel plugin XML `04af00f442424ae635c43d758c9da5a9cef93731015519e5a01c0da7a635aff2`, and Excel plugin binary `a05993275c1b71e9868f94e2ac4d8c3841b66a0ac740f81876b60d6f8f5cbaff` match the previously captured reference profile in `biff-verification.json`.

Three original complete BIFF8 workbooks measured compressed/wide suffixed built-ins and an ordinary Unicode-name negative control. Two native-generated BIFF7/8 CFB workbooks measured names through native export, candidate import/export and native replay. All five comparisons matched native name values/scopes after replay; all native imports/replays exited 0 with empty stdout/stderr, and the candidate reported no diagnostics. BIFF7's native Unicode name downgrade to `?A` was preserved. These name-focused files have no populated cells and do not certify cell/style/chart fidelity. Earlier scratch with an incorrectly calculated BOUNDSHEET offset was corrected before these measurements and is not positive evidence.

Before the XML writer repair, all three native replays exited 0 but silently lost the exported `=42` named expression. After repair all three preserved `42`. A separate zero-token name fixture remains a measured mismatch: native source creates a placeholder, but its serialized XML omits the global name; candidate XML replay retains the global name with `#NAME?`. Both exit 0 without stderr. This is not a native compatibility pass.

## Exact candidate and limits

Final source SHA-256:

| File | SHA-256 |
| --- | --- |
| biff.ts | `021802aa1626f470c154a9e68223cf8d2304fef5332593f6568c6dc90ed7bc99` |
| biff-strings.ts | `cf6cea1bdfbf006a6486e43d723cfd4ee0f944d69bfec7d0ab1dd8f195f68578` |
| biff-binary.ts (preserved) | `cb404dc22f88d59d274941619dabc85d83d4f910d976c10dcb42ea775202e0f2` |
| gnumeric.ts | `fe79c1e70e78fa96dc93cfdbcaf89a71022eb1d2e9686eb6952fb3529ca60720` |
| ssconvert-biff.test.ts | `915b4d34616e29921960c1185109f8a72051fc37ce2435da414bae4da79fa35d` |

Full Gnumeric compatibility remains incomplete. Existing `biff-verification.json` mismatches remain except that the measured built-in-name and leading-equals replay failures above are repaired. Unknown built-in identifiers still use invented names rather than native NULL/warnings. Hidden/VBA NAME flags and invalid-scope recovery differ. Empty-placeholder XML omission differs. Encrypted workbook decryption is unsupported. Drawing/chart/VBA/pivot/validation records are retained with loss reporting rather than reconstructed. Exact corrupt-file recovery/GLib diagnostics, full XF inheritance/font mappings/default geometry, external workbook evaluation, BIFF4W BUNDLEHEADER naming, DSF and property streams remain incomplete or unmeasured.

Required raw BIFF2/3/4 and mapped BOF variants have current deterministic unit coverage plus historical native captures; they were not freshly native-measured in this follow-up. Successful multi-sector DIFAT and CFB v4 mini-streams remain unmeasured. Browser/workerd/foreign-realm/native operating-system variants and shell checkpoint restoration are not verified by the Node/SDK/XML replay checks. No bounded performance measurements or randomized generated cases were performed. No unavailable or unsupported cell counts as a pass.

Owned temporary native files, run logs and screenshot were generated only in out, inspected and purged after recording these conclusions. Existing source archives, historical receipts and other workers' scratch were preserved.
