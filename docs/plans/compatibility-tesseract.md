# Tesseract independent compatibility controls

Manual evidence specification for `research-tesseract`, 2026-09-20. Keep this
control inventory independent of first-party implementation tests and snapshots.
See [safe-bash-tesseract-research.md](safe-bash-tesseract-research.md) for source,
asset pins and product acceptance gates. Native execution is a development oracle
only, never a runtime capability.

## Evidence classification

The task supplies a prior pinned 5.5.3 build with 76 CLI/segmentation/renderer
controls plus 17 effects controls. Their complete transcripts, executable hash,
platform/compiler, config/font bytes and control manifests were not available
in this checkout. This task did not rerun that build. The enumerated observations
below retain their scope; the number 93 is not a count of newly verified passes.
Missing exact bytes are marked pending and must not be invented or normalized
away. Fresh pinned source reads corroborate the grammar and mode/status rules;
fresh English model/Apache LICENSE reads verify asset size/hash only.

## Reconstructible fixtures

`hello.pbm`: ASCII PBM P1, width 220, height 100, background bit 0. Origin (15,20).
Draw HELLO with 5×7 cells, each 6×6 foreground bits 1. Glyph origins advance
36 pixels. Rows:

- H: `10001/10001/10001/11111/10001/10001/10001`
- E: `11111/10000/10000/11110/10000/10000/11111`
- L: `10000/10000/10000/10000/10000/10000/11111`
- O: `01110/10001/10001/10001/10001/10001/01110`

Seal future fixture bytes as `P1\n220 100\n`, then each row as 220 ASCII
`0`/`1` tokens joined by one ASCII space and terminated by LF, with no comments.
This serialization is a reconstruction specification, not a claimed hash of the
prior fixture. `blank.pbm` sets every bit 0; `inverted.pbm` flips all hello bits.
`pages.list` bytes: `hello.pbm\nblank.pbm\nhello.pbm\n`.
`missing.list`: `hello.pbm\nmissing.pbm\nhello.pbm\n`, second path absent.
All paths are relative to the isolated control directory. Explicit DPI is 300.

Notation: `H` is exact stdout bytes `48 45 4c 4c 4f 0a` (`HELLO` LF);
`ε` is zero bytes; FF is byte `0c`. No diagnostic normalization is allowed.
Every invocation below uses the pinned native executable and explicit
`--tessdata-dir MODEL_DIR -l eng`; these options occur before config names.
`MODEL_DIR` contains the pinned English model and pinned renderer configs/assets.
These native filesystem accesses are oracle setup, not product VFS permissions.

## Native control inventory

| Control / argv suffix | Expected stdout or named output | Expected stderr | Status / qualification |
| --- | --- | --- | --- |
| `hello.pbm stdout --dpi 300 --psm N`, N=3/4/6/7/8/9/10/11/12/13 | H | Complete build-specific diagnostic bytes pending | 0, supplied enumerated observation; mode 12 does not qualify OSD |
| Same modes by their exact symbolic names | H where corresponding numeric mode recognized | Pending exact transcript | Symbol mappings source-confirmed; individual symbolic-mode execution coverage not sealed |
| `hello.pbm stdout --dpi 300 --psm 5` | Vertical interpretation; exact bytes pending | Pending | Supplied observation; no exact acceptance yet |
| `hello.pbm stdout --dpi 300 --psm 2` | ε | Orientation/writing direction/order/deskew report; exact values pending | 0, no OCR |
| `blank.pbm stdout --dpi 300 --psm 2` | ε | Complete bytes pending | 1 |
| `missing.pbm stdout --psm 2` | ε | Includes `Leptonica can't process input file: missing.pbm\n`; codec prefix pending | 2, source-confirmed path |
| `inverted.pbm stdout --dpi 300 --psm 6` | H | Pending | Recognition supplied; per-mode inversion corpus still open |
| Inverted automatic modes | Some produce ε | Pending | Do not treat silent absence as an accuracy pass |
| `hello.pbm stdout --dpi 300 --oem 1` / `3` / `lstm_only` / `default` | H | Pending | 0 with pinned LSTM-only English model |
| Same with OEM 0 / 2 | ε / any partial output must be captured | Model/legacy initialization error, exact bytes pending | 1; no legacy assets |
| Mode 0 without admitted osd model | No successful OSD result | OSD/model error, exact bytes pending | Failure; unavailable resource is not a supported capability |
| `hello.pbm out.txt --dpi 300 txt` | stdout ε; `out.txt.txt` contains H | Pending | 0 |
| Input aliases `stdin` and `-`, output aliases `stdout` and `-` | H when fed exact hello bytes | Pending | Supplied success; seal all four alias combinations independently |
| `hello.pbm stdout --dpi 300 txt tsv` and reversed config order | TSV then H on the same stream | Pending | 0; full concatenated TSV bytes pending |
| `hello.pbm out --dpi 300 txt tsv` | stdout ε; separate `out.txt`, `out.tsv` | Pending | 0; preserve file identities and exact bytes |
| TSV word geometry | Word text HELLO; left 15, top 20, width 174, height 42, conf `94.235031` | Pending | Exact build/model-dependent confidence, not universal accuracy |
| `makebox` geometry control | H character box `H 15 38 45 80 0\n`; remaining rows pending | Pending | Bottom origin / page 0; differs from TSV |
| `lstmbox` / `wordstrbox` / UNLV | Distinct framing; lstmbox repeats line bounds plus TAB marker | Pending | Do not infer from makebox |
| `pages.list stdout --dpi 300 txt` | Exact `48 45 4c 4c 4f 0a 0c 0c 48 45 4c 4c 4f 0a` | Page/auxiliary messages pending | 0 |
| Same list with `tsv` | Header once; pages increment through blank page | Pending | 0; full rows pending |
| `missing.list stdout --dpi 300 txt` | First-page H prefix; no third-page H | Missing-path/page diagnostics pending | 1, non-atomic streaming output |
| `hello.pbm stdout --dpi 300 nonexistent-config` | H fallback | Warning, exact bytes pending | 0 |
| `hello.pbm stdout --dpi 300 -c unknown_variable=1` | H | Warning, exact bytes pending | 0; no promised timeout capability |
| `hello.pbm stdout --dpi 300 -c tessedit_create_txt=0` | H fallback | Pending | 0 when no other renderer/error |
| `-c key=a=b` before config names | Value is exact `a=b` | Variable-specific result requires separate control | Split-first-equals source-confirmed |
| `-c key` before config names | ε | Caught missing-equals exception; wrapper bytes pending | 1 |
| `hello.pbm stdout --dpi abc` / `--dpi 12tail` | H in supplied controls | Pending | 0; atoi 0 / 12 respectively; product rejects |
| Option-like argv immediately after image | Consumed as outputbase | Subsequent parse-dependent diagnostics | Pin actual argv/output files before acceptance |
| Options after first config name | Treated as config arguments, not normal option parsing | Config warnings possible | Full interaction controls pending |
| hocr | Exact framing/escaping/IDs/bboxes/confidence pending | Pending | Source contract only; no full-byte acceptance |
| pdf with this zlib-free build | Partial PDF bytes | Compression failure and processing error; exact bytes pending | 1; explicitly not successful PDF qualification |
| No input / help / version | Native help/version bytes pending | Build-specific version diagnostics pending | 0 |
| list-langs with failed initialization | Listing bytes pending | Initialization error bytes pending | 0, source contract |

Auxiliary bitmap-font warnings in the supplied build stem from disabled TIFF;
they do not establish PBM input decoding failure. Capture them verbatim when
sealing transcripts, separately from recognition output. Build variation must be
recorded as another profile, never scrubbed to manufacture exact equality.

## Manual execution and sealing plan

1. Retrieve pinned source archives and English research model explicitly into
   task-owned `/out`; verify full hashes, licenses and model length. Record actual
   archive URL, toolchain/platform, build flags, linked libraries, executable hash,
   config/font/license bytes and model manifest. Do not substitute a PATH binary.
2. Rebuild the specified oracle profile. Generate and hash exact fixtures above.
   Pin cwd, environment and every argv byte; remove ambient tessdata/locale/debug
   settings. Keep all native effects confined to the isolated oracle directory.
3. Execute each named cell independently, cap each process at 10 seconds and
   16 MiB combined captured output, and record raw stdout/stderr, status, created
   file bytes and order. A timeout/cap/missing tool is unavailable evidence,
   never a successful comparison. These are research supervision limits, not
   accepted production budgets.
4. Seal a manifest binding inputs, configs/model/executable and expected bytes
   before running the candidate. Resolve every pending cell required by the
   advertised profile, including malformed image/list/config/model, aliases,
   PSM/config precedence, renderer creation failures and language ordering.
5. Independently compare the candidate through SDK and CLI using the same byte
   fixtures and admitted capabilities. Report exact matches, intentional safety
   deviations, unsupported cells and defects separately. Do not derive the oracle
   from candidate snapshots or count mocked recognition as fidelity evidence.
6. Qualify recognition corpora, tensor/preprocessing/segmentation, codecs and
   searchable PDF independently. For PDF obtain a separately pinned zlib-capable
   renderer oracle and validate raster/text/font/ToUnicode structure and placement;
   the failed PDF above cannot serve as a success baseline.
7. Record durable results here; purge task-owned temporary sources, models,
   executables, transcripts and generated evidence after use. No native/model
   artifact enters the shipped runtime unless explicitly admitted separately.

No independent execution was performed in this task. This plan preserves known
observations and identifies missing exact controls without closing engine gates.

## Candidate qualification increment — 2026-09-20

The preceding section describes the earlier research task. This increment
executes the existing Markdown wiring QA steps 1, 3 and 4, plus the narrower
command workspace build closure. It does not rerun the native oracle inventory.
Compatibility acceptance remains **incomplete**: the candidate explicitly has no
recognition engine, image decoder, normalization/segmentation pipeline, network
interpreter, hOCR renderer or searchable-PDF writer. `inspectTraineddata` only
inspects component boundaries; supplied synthetic containers are not recognition
models. No repair was made because the new controls reproduced no defect.

### Candidate and tools

Base revision: `ab1fa8d34101e1e7f61272973f3bc28a842043d8`, with existing uncommitted
contributor changes preserved. HEAD alone does not identify this working-tree
candidate. The tested command manifest SHA256 is
`598d61cae56cffd8e720340a99dc82ebe6a88424f7fbe52a0fe006b8be048c17`.
To reconstruct the manifest, select every command-package `.ts`, `.json` and
`.md` file outside `dist`, together with
`packages/safe-bash/src/commands/tesseract/index.ts`; sort paths lexically and
form an array of `{path, sha256}` objects from exact file bytes. Hash the UTF-8
JSON with sorted object keys and compact separators. This identity covers the
command sources/tests/configuration/README and public source export, not the
entire dirty repository or a published artifact. The new control file SHA256 is
`9c86566f278465f6db1bd4f1e2f3f3252a7f8bc8e14592ad14b73649d703d9d6`.

Environment: macOS 15.7.7 arm64, Node 22.22.2, npm 10.9.7, TypeScript 5.9.3,
tsx 4.22.4, ESLint 9.39.4, Vitest 4.1.11, esbuild 0.28.1. No native executable
was substituted for the pinned research build. No model or corpus was fetched.
The archived package pattern was read; its deleted original was not restored.
The command remains private, ESM, with empty runtime dependencies and unchanged
opt-in composition through the public safe-bash export.

### Fixture set, bytes and differences

The durable, memory-only fixture definitions and literal expected masks are in
`packages/safe-bash-command-tesseract/src/independent-controls.test.ts`.

| Cell | Fresh result | Scope and effects |
| --- | --- | --- |
| Four 9×7 binary planes × four bricks × dilation/erosion | 32 exact 63-byte output masks pass | Left edge, point, gap row, all-on; no source mutation; output backing store distinct; exact work and disposal accounting. Literal expectations follow the supplied anchor/boundary observations; no fresh Leptonica execution is claimed. |
| Symbolic/numeric PSM and OEM | 14 PSM and 4 OEM pairs pass | Parsed structures match; PSM0 selects osd only without explicit language. Parsing does not establish that a recognition mode works. |
| Config/CLI PSM precedence | All 196 pairs pass | Configured6 retains CLI; other configured modes override. Source-derived grammar evidence, not config loading or recognition. |
| Model-container subview | Both endian profiles pass | 33-byte view at backing offset7, count3, offsets28/-1/30; extents2/3; surrounding bytes stay unchanged; recognitionQualified remains false. |
| Truncated/out-of-view model tables | 62 truncations and 2 escaped-view offsets rejected | Status represented by structured `invalid-model`; no inference/model admission or ambient read. |
| Existing seed-fill controls | Pass in workspace route | Complete serpentine masks; retain the documented intentional difference from native silent partial-fill success. |
| Existing TSV controls | Pass in workspace route | Supplied recognized rows, fixed header/geometry/confidence serialization and UTF-8 negatives. Recognition is not mocked or simulated by these controls. |
| Real-shell CLI/SDK and authority controls | 5 tests pass | Opt-in registration, scripts/pipes, no fetch authority, byte preservation and deterministic recognition-unavailable status1. Named outputs remain untouched; shell redirection can truncate its target before command admission, including symlink aliases. |
| Isolated public runtime/types | 1 selected test passes | Memory-VFS packaging removes the private workspace and checks public import, runtime identity and strict declarations. It does not verify an npm-installed tarball or release. |

### Maintained routes

- `npm run test:unit --workspace=safe-bash-command-tesseract`: 60 passed;
  zero failed, skipped, cancelled or todo.
- `npm run lint --workspace=safe-bash-command-tesseract`: exit0, including
  production and test TypeScript checks.
- `npm run build:workspaces -- --workspace=safe-bash-command-tesseract`: exit0;
  maintained dependency closure builds safe-fs, safe-bash-contracts and the
  command package. It does not stand in for the safe-bash artifact build.
- `node --import tsx --test packages/safe-bash/tests/plugins/tesseract-wiring.test.ts packages/safe-bash/tests/plugins/tesseract-boundaries.test.ts`:
  5 passed, zero failed/skipped/cancelled.
- `npx vitest run --config vitest.root.config.ts scripts/package-safe.test.ts -t 'ships tesseract command'`:
  1 passed, 155 unrelated tests skipped; no complete packaging-suite pass claimed.

No broad source, workflow or visual behavior was changed. Repository-wide
lint/test/build, CLI screenshots and native QA were not run in this increment.
The earlier screenshot receipt remains historical evidence. Real browser,
workerd and Bun runtime cells remain unverified; a browser-target bundle executed
in a Node VM is only a conditional-graph control. Checkpoint/replay recognition
is unsupported. No performance benchmark was run; test durations establish no
performance acceptance.

Required licensed independent corpora (noise, skew, tables and multiple scripts),
CER/WER, approved model provenance/bytes, native-compatible tensor operations,
preprocessing/segmentation/CTC/dictionary, mode/language runtime cells, hOCR/TSV
overlay screenshots and successful searchable-PDF screenshots remain open.
The supplied HELLO native observations cannot qualify an unavailable candidate
engine or language-wide accuracy. Local commits: none. Verified remote-main
delivery: none. Successful releases: none. No private publication was performed.
