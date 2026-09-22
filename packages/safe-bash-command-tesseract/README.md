# Tesseract command admission and layout utilities

Opt-in VFS command and bounded TypeScript utilities, imported through
`@poe-platform/safe-bash/commands/tesseract`. **OCR is unavailable.** No models
are included; recognition returns 1 before reading images or writing outputbase
files. This private workspace is bundled with its declarations into Safe Bash;
consumers never install it separately.

```ts
import { Shell, createMemoryFileSystem } from '@poe-platform/safe-bash';
import { tesseractCommands, tesseract, parseTesseractArguments } from
  '@poe-platform/safe-bash/commands/tesseract';

const shell = new Shell({ fs: createMemoryFileSystem() }).use(tesseractCommands());
try {
  await shell.exec('tesseract --help'); // status 0
  await shell.exec('tesseract scan.pbm result --psm 7'); // status 1, no OCR
} finally { await shell.dispose(); }
const options = parseTesseractArguments(['scan.pbm', 'result', '--psm', 'single_line']);
// In a host-owned CommandContext, equivalent SDK admission:
// await tesseract(context, { input: 'scan.pbm', outputbase: 'result', psm: 7 });
```

Register `createTesseractCommand()` directly or use `tesseractCommands()`;
registration is opt-in, with `replace: true` required to replace an existing
command. CLI and SDK default to PSM 3/OEM 3. SDK paths are literal; variables
and configs follow CLI admission. An empty SDK invocation shows help; supplied
recognition options require input/outputbase. Explicit `action: 'help'` shows
help alongside options.

Accepted command profile (opt-in; recognition is unavailable):

```sh
tesseract --help
tesseract --version
tesseract --list-langs
tesseract scan.pbm result --psm single_line --oem lstm_only --dpi 300
# Last command returns 1; it produces no OCR file.
```

| Flags/operands | Accepted values and behavior |
| --- | --- |
| `-h`, `--help`, `--help-extra`, `--help-psm`, `--help-oem` | Same admission-profile help, status 0. No arguments also shows help. |
| `-v`, `--version` | Source-profile version, status 0; never claims a native executable is installed. |
| `--list-langs` | No admitted loader/languages; diagnostic on stderr, status 0. |
| `-l language` | Literal language string, default `eng`; PSM 0 without explicit language selects `osd`. No model is loaded. |
| `--psm mode` | 0–13 or the symbolic names below; default 3. |
| `--oem mode` | 0–3 or the symbolic names below; default 3. |
| `--dpi value` | Decimal integer 1–2400, with no signs, suffixes or whitespace. |
| `--tessdata-dir path` | Literal VFS operand; currently never accessed. |
| `-c name=value` | Nonempty name; splits at first equals, retains remaining value including an empty value. No variables are applied. |
| `--` | Literal input/config operands. Image consumes the next token as outputbase, including an option-like token. |
| `image outputbase [configs...]` | Nonempty input/outputbase required for recognition; `-`/`stdin` and `-`/`stdout` are admitted spellings but no streams are acquired for OCR. Options must precede the first config operand; later tokens are config names, never executed or loaded. |

PSM names in numeric order: `osd_only`, `auto_osd`, `auto_only`, `auto`,
`single_column`, `single_block_vert_text`, `single_block`, `single_line`,
`single_word`, `circle_word`, `single_char`, `sparse_text`, `sparse_text_osd`,
`raw_line`. OEM names: `tesseract_only`, `lstm_only`,
`tesseract_lstm_combined`, `default`. Other flags, attached/grouped short options
and malformed UTF-8/NUL/surrogate operands are rejected. Help aliases do not
provide native mode tables. Strict DPI admission deliberately differs from native
`atoi` conversion, which accepts `abc` as 0 and `12tail` as 12.
Native PSM 2 layout-only behavior, OSD, config
execution, image lists, TIFF pages, txt/box/hOCR/PAGE/ALTO/PDF renderers and
scanned-PDF rasterization are unavailable.

Outputs are awaited UTF-8 byte writes: help/version on stdout, list-langs,
argument errors and unavailable-recognition diagnostics on stderr. Recognition
returns 1 with `recognitionQualified: false`; status 2 is reserved, currently
never emitted. Cancellation and output/cleanup capability failures propagate;
they are not reported as successful recognition. Command outputbase files are
untouched, but shell `>` redirection can truncate VFS files before admission,
including symlink aliases; no atomic shell-redirection guarantee is made.

Invocation `maxArgumentBytes`/`maxOutputBytes` default to 65536 each and accept
0–1048576; output bytes count stdout and stderr together. Writes are awaited,
cleanup is registered before output acquisition, and owned writes are drained.
Abort signals are forwarded to output capabilities.

Runtime profile: first-party TypeScript ESM with explicit `AbortSignal` and
invocation cleanup; no host executables, implicit network, ambient files,
native/WASM fallback, downloaded dependencies or runtime models. The command
requires supplied byte-output capabilities; utilities accept caller-owned memory
rather than image paths. Byte/raster APIs currently require same-realm
`Uint8Array`; cross-realm input admission is not qualified. Node ESM is the
maintained runtime; conditional import/declaration checks do not alone qualify
actual browser/workerd engines. Private implementation and declarations are
bundled into the public Safe Bash artifact.

| Utility | Limits and output |
| --- | --- |
| `inspectTraineddata(bytes, limits, signal)` | Positive `maxModelBytes`/`maxComponents`; 1–24 component slots, either byte order, no component copies. Returns offsets/lengths and `recognitionQualified: false`; no digest verification/network deserialization. |
| `readTesseractBytes(input, maxBytes, signal, maxChunks?)` | Byte cap 0–2147483647; positive safe-integer chunk cap, default 4096. Allocates full cap; returned view retains that capacity. Iterator ownership transfers and `return()` is awaited. Source must honor cancellation during pending I/O. |
| `inspectTesseractRaster(image, limits, signal)` | Explicit nonnegative `maxWidth`, `maxHeight`, `maxPixels`, `maxWork`; positive safe-integer dimensions, exactly width × height bytes, DPI 1–2400. `gray8`: black 0/white 255; `binary8`: foreground 1/background 0. One validation step/pixel, checkpoints at most 65536 traversal steps apart; no copies/codecs. |
| `fillTesseractBinary(seed, mask, connectivity, rasterLimits, budget, signal)` | Explicit 4/8 connectivity; seeds outside mask clipped. Owned raster plus idempotent `dispose()`. Exhaustion fails, never returns incomplete reconstruction. |
| `morphTesseractBinary(image, operation, brick, rasterLimits, budget, signal)` | Rectangular `dilate`/`erode`, positive integer brick dimensions within dimension ceilings; outside pixels off, native asymmetric even-brick anchor. Owned raster plus `dispose()`. Reserves N pixels and N retained/output bytes; N validation + N × brick-area work, including outside samples. |
| `renderTesseractTsv(rows, budget, signal)` | Supplied recognized layout only; owned UTF-8 `{ bytes, dispose }`. Fixed 12-column header, levels 1–5, 1-based pages, top-origin rectangles, nonword confidence -1, word confidence 0–100 serialized to six decimals. Contiguous hierarchy and parent containment required; controls/DEL/malformed surrogates rejected. No partial output on failure. |
| `createTesseractBudget(limits, signal)` | Explicit nonnegative safe-integer resource caps; omitted resource fails closed. Cumulative `work` cannot be released. Dispose owned results before budget `close()` in `finally`; account caller-owned backing stores separately. |

TSV budgets cover `inputBytes` (88 numeric payload bytes/row plus UTF-16 text),
`work`, `retainedBytes` (4096 scratch bytes plus exact UTF-8 output), and
`outputBytes`. Keep supplied rows stable during synchronous rendering. Binary
primitives do not qualify normalization, segmentation or recognition.
`tesseractCapabilities` marks normalization, deskew, segmentation, recognition
and PDF rasterization false. Model/pixel/page/tensor/beam/dictionary reservations
are safety contracts, not implementations of future OCR stages.

Recognition assets require separate provenance, license/notices, exact-byte,
size and engine admission. No asset is shipped or approved. The researched
Apache-2.0 native source pin is `8ae68101439b3f7df123499a784e8896c805179d`;
native bitmap/model controls qualify only their enumerated upstream cases.
