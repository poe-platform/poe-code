# compatibility-exiftool qualification record

Executed 2026-09-18 against dirty main based on
`052940a62255aa620236474575b4003a2df76549`. This record qualifies selected PNG
cells, not complete ExifTool compatibility. Unrelated edits were preserved.
Final command-package candidate manifest SHA256 is
`8d7eb3f7592f6522a7e599da02b62f2f2229196b914f24d12be0cc3a184debd7`:
sort all regular package files outside dist by relative POSIX path; for each,
hash file bytes with SHA256, then hash UTF-8 `path + NUL + lowercaseHash + LF`.
This identifies the dirty package candidate, not the broader uncommitted tree.

Oracle: ExifTool 13.59 at `2200871d9cef988051d2a99d67df3bda6cbb30a8`.
Downloaded archive SHA256 matched
`e1e2ad6c6fbf568afee5993ef8b2b91ab013d21698c9304e079e633ad82776f5`
before extraction. Native controls ran manually following
[the Markdown QA](safe-bash-exiftool-compatibility-qa.md), with `-config ''`
first and PERL5LIB/PERL5OPT/PERLLIB removed. Perl v5.34.1; product/test Node
v22.22.2. Perl is only a research control, never a product capability.

## Independently constructed fixture set

Canonical fixture bytes are embedded in
`packages/safe-bash-command-exiftool/src/compatibility.test.ts`.
Construction used Python struct and zlib CRC32, independently of product code.
Each PNG has a 1×1 RGBA8 IHDR and identical IDAT/IEND. IDAT payload hex is
`789c636000020000050001`. Metadata precedes IDAT. No fetched fixtures,
native processes or disk writes occur in the regression tests.

| Fixture | Bytes | SHA256 |
| --- | ---: | --- |
| duplicate.png | 115 | fa89b266dc4b8d7eb9d83c6ab8409f246d30d087859ac45b1c5069fb61e99c7e |
| unicode.png | 103 | 46915dec5520ca990bbd55162d690b86528a8ed6acfb3cb7f0adb4c540a5b8ba |
| control.png | 91 | 24e4c28b6b8399ac2ea5d2e88ca23ef5c3a986d5ee176ddac76ebf5a6246908f |
| empty.png | 86 | 107452e4bc4d92ffd9830db54538714f3920ac1d3dec1f1dc76b7327c2b9c40a |
| unknown.png | 100 | b21fd14859ff50d22f1d5c8369bfbed165ba12cd39dc1f9859684dd30698565c |

## Fresh native read results

Each fixture crossed `-j -Title`, `-s3 -Title`, `-b -Title`: 15 invocations,
all status 0, empty stderr and unchanged input. Candidate output matched exact
UTF-8 bytes, status and VFS effects in all 15 cells. Regression assertions retain
exact JSON indentation/member order/final LF. JSON template is
`[{\n  "SourceFile": "NAME.png",\n  "Title": TOKEN\n}]\n`;
unknown has only SourceFile, with no comma or Title member.

| Fixture | JSON TOKEN | s3 bytes (escaped) | binary bytes (escaped) |
| --- | --- | --- | --- |
| duplicate | `"second"` | `second\n` | `second` |
| unicode | `"café 水😀"` | `café 水😀\n` | `café 水😀` |
| control | `"ab\u0001\u007F"` | `ab..\n` | `a\0b\x01\x7f` |
| empty | `""` | `\n` | empty |
| unknown | omitted | empty | empty |

## Fresh write results and minimized finding

Seven independent controls each started from duplicate.png. All retained exact
IHDR/IDAT/IEND chunks, including CRCs. Successful cases returned stdout
`    1 image files updated\n`, empty stderr and an exact 115-byte original backup.

| Ordered assignments | Status | Result bytes | Effect |
| --- | ---: | ---: | --- |
| Title=new | 0 | 110 | **Two** Title=new chunks |
| Title= | 0 | 68 | Both Title chunks deleted |
| all= | 0 | 68 | Both Title chunks deleted |
| Title-=first | 0 | 92 | Only Title=second remains |
| Title+=extra | 1 | 115 | Unchanged, no backup |
| Title=old, Title=new | 0 | 110 | Two Title=new chunks |
| Title=new, Title= | 0 | 68 | Both Title chunks deleted |

Shift stdout is empty; stderr is exactly
`Warning: Shift value for XMP-xmp:Title is not a number\nNothing to do.\n`.
110-byte result SHA256:
`e272d6409719cd6b65552bd3d4ba8b42a77e2f82e7b882138c2d82db7e839102`.
68-byte result SHA256:
`43739c566e26fd7cb88f69d3864ea34740372f5ee99acac169e090beffbce5c6`.
92-byte result SHA256:
`442df846272fa83665f37d288b7b8d6bd028ad180eb37abbcc5e206b42e41ea8`.

The fresh duplicate assignment contradicts the supplied collapse summary;
different original fixture bytes were unavailable, so that historical case is
not explained or invalidated. A minimized exact-output regression exposed the
candidate's collapse. The writer now retains existing selected text multiplicity;
absence still creates one instance and deletion removes selected instances.
Additional output copies consume cumulative output/work/retained accounting.
Independent unknown-chunk/pixel preservation and corrupt extent/CRC refusal
regressions pass. Those negative refusals are product safety controls, not a
claim of native diagnostic parity for damaged PNGs.

## Remaining acceptance cells

| Required area | Current evidence / disposition |
| --- | --- |
| PNG basic text/Unicode/duplicates/control display | Fresh 15-cell exact read comparison; exact native duplicate-write regression |
| Repeated edits/unknown metadata/image payload | Deterministic memory regression, separate from native comparison |
| Timestamp conversion | Existing focused tests; native cross-format/date qualification incomplete |
| Scalar JSON 20×3 | Supplied controls and existing regressions; not freshly rerun here |
| TIFF endian/IFD corruption, JPEG EXIF/XMP conflicts | Product unsupported, independent comparison missing |
| XMP lists/structures/languages/namespace aliases | Product unsupported, independent comparison missing |
| DOCX/PPTX/XLSX | Product unsupported; no write extension admitted; supplied DOCX refusal does not qualify PPTX/XLSX |
| PDF incremental edit/delete/restore/corrupt suffix | Product unsupported; supplied evidence only; deletion is never redaction |
| Backups/collisions/aliases/permissions | Fresh native backup bytes; existing memory publication tests; fresh native identity/collision controls missing |
| Cancellation/cleanup/budgets/rollback | Existing memory tests pass; per-file publication only, completed writes/backups survive later failure; not native parity proof |
| CLI/SDK/byte brand | Focused workspace and Shell boundary checks; direct resource-error diagnostic parity remains open |
| Import/execute/stay-open/conditions | Product unsupported; status 2 and readyN protocol unverified |
| Node/browser/workerd/isolated installed artifact | Node focused checks only; browser/workerd and real isolated installation unverified |
| Original/checkpoint/replay execution | No new replay feature; qualification not executed |
| Performance | Not measured; semantic results do not establish performance |

Package remains `safe-bash-command-exiftool`, private, with no external runtime
dependencies. Safe-bash composition/export and declaration-bundling recipes were
already present and were preserved. Packaging mock checks do not substitute for
an isolated installed consumer. No commit, push or publication was performed.

## Gates

- `npm run test:unit --workspace=safe-bash-command-exiftool`: 117 passed,
  zero failed/skipped/cancelled. Initial new preservation test failed solely on
  Buffer versus Uint8Array assertion type and was corrected. The separate native
  duplicate-write regression failed before the writer repair.
- `npm run lint --workspace=safe-bash-command-exiftool`: passed ESLint and
  source/test TypeScript checks.
- `npm run build:workspaces -- --workspace=safe-bash-command-exiftool`: passed
  maintained three-workspace dependency closure (safe-fs/contracts/command).
- Focused Shell boundary test: one passed (byte argv, pipelines, stdin and VFS
  scripts). `npx vitest run --config vitest.root.config.ts scripts/package-safe.test.ts`:
  144 passed; this is packaging recipe/mock evidence, not a real packed installation.
- Full root gates were not run: the repair is confined to this command workspace.
- No CLI presentation code changed; CLI screenshot qualification remains unrun.

Temporary native source, fixtures and logs were kept in repository `out` and
purged after recording these results. Missing cells remain unverified, never passes.
