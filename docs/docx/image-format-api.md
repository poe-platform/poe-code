# Image format and value API reconciliation

Task 69 began after task 68 at main
`b879fb6113379e01467cee623684fa73385858e9`. Its standalone Image value API and
stated observable adaptations are now verified locally through product commit
`220100e694961bc82e561eeae24347a13fe553b4`. Preparation does not establish
full parity, live part/shape behavior or publication.
The sole format contract is [docx.md](../specs/docx.md); shared behavior follows
[office-sdk.md](../specs/office-sdk.md) and
[office-cli.md](../specs/office-cli.md).

Pinned source provenance is retained by the upstream audits/inventories and
the research-only image case map. Source `src/docx/image/image.py` lines 29–50,
63–70, 105–151 and 154–165 establish anonymous byte/public-stream names, path
basenames/suffixes, native/scaled dimensions and exact-blob SHA-1. Existing
TypeScript shared Length values provide explicit units and checked rounding.

The proposed standalone Image is immutable and unbound, unlike the generic
live-owner classification in the earlier API map. Optional context supplies
intrinsic limits without ambient grants. Explicit stream `open(signal)` follows
the maintained DocumentByteSource capability; JSON uses finite base64/VFS
equivalents. Filename suffix metadata preserves source spelling and unknown
suffixes; known suffixes assert a type at admission, and MIME remains byte-derived.
Anonymous names use canonical header extensions, without reading stream names.

The sole contract's literal final-dot suffix also applies to leading-dot names:
`.PNG` has suffix `PNG` and asserts PNG bytes. This differs from the source's
`os.path.splitext` dotfile exception. Independent review reproduced the current
implementation returning an empty suffix and accepting GIF bytes under `.PNG`;
two original failing memfs regressions preceded the corrected candidate.

That finding is now corrected after two original failing tests; independent
reproduction confirmed suffix preservation and GIF refusal. A separate original
JavaScript-construction regression also preceded runtime factory-only admission:
TypeScript private constructors alone did not protect retained caller bytes.

Specific numeric divergences are intentional: source PNG rounds 1654/945 ppm
to 42/24 DPI; the sole contract preserves 42.0116/24.003. Source BMP rounds
7864 ppm to 200 and defaults zero density to 96; characterization preserves
199.7456/null and the model independently falls back to 72. Physical native
aspect ratio stays unrounded until actual shared EMU results, avoiding intermediate
rounding and source ties-to-even differences. SHA-1 is compatibility metadata;
provenance remains SHA-256.

Standalone Image's 14 members do not qualify ImagePart relationship/package
semantics, ImageParts collections, or shape iteration/type/extent setters.
The exact research map must distinguish these pending obligations from passing
original TypeScript adaptations. No codec defect was validated by initial review.
No external binary/code/decoder is imported into product tests or dependency closure.

Final task 69 evidence covers standalone Image's 14 members and 138 limited
observable codec adaptations: 90 bounded header cases plus 48 admitted Image
cases. The 20 ImagePart/shape cases remain pending. No full source parity,
pixel decoding, rendering, or additional insertion format is qualified.

The maintained DOCX workspace passed 108 files / 2402 tests. Independent review
passed 182 focused/public tests across 13 files, 116 actual DOCX Shell tests across
15 derived files, and all 108 exact literal registration tests without skips.
Its renewed 258-file append-aware candidate proof had no changes or membership
drift. Against the earlier 49-path capture, 38 bytes were unchanged and 11
task-owned paths changed explicitly; that historical capture is not a blanket
current-input seal. Selected build closure comprised five derived stages;
portable exports passed two tests and safe-bash typechecking passed 26 current
consumer groups. Dependency manifests and lockfile were unchanged; selected
source scans had zero reference-identity/native-I/O/implicit-network hits.
Final guarded root lint passed complete 12621 subjects, zero errors, 12 existing
warnings, 25 receipts and zero gaps after QA storage settled. The earlier identity
drift receipt remains incomplete and does not supply that gate's evidence.

The [complete-input QA receipt](image-format-api-qa.json) verifies 24 public
admission cohorts across eight complete original/derived inputs and four
capability/suffix controls. Independent hashes, exact bytes, dimensions, density,
native and scaled EMUs matched. Three original inputs were authenticated and
retained; sips 316 derived complete GIF/BMP/TIFF only as an independent QA tool.
A requested JPEG density edit remained 72/72 in tool output and bytes, and is
not counted as the requested 144/72 case; physical PNG covers unequal axes.
Producer reuse, signal forwarding and cleanup are recorded only where actually
observed. VFS signal forwarding is not claimed from this campaign.

The initial QA inventory recursively hashed unrelated historical fixtures and
was outside the approved scope. Its 46827-path proof and a subsequent 662-path
proof are retained as superseded evidence, never qualification. Final QA freshly
authenticated the approved 258-path scope with zero before/after drift. No
historical fixture was executed or modified by that inventory; this does not
grant future traversal or held-path clearance. Owned disposable cache contents
and cleanup inventory are retained while the image campaign needs them.

Workspace usage through the verified public export (not a publication claim):

```ts
import { Image, Inches } from "poe-code/docx";

const image = await Image.from_blob(bytes); // caller-supplied Uint8Array
const [width, height] = image.scaled_dimensions(Inches(1));
const size = { width: width.emu, height: height.emu };
const exactOwnedBytes = image.blob;
```

`Image.from_file` accepts caller-supplied `open(signal)` byte sources or explicit
VFS path/capability objects with a matching injected resolver. Live streams stay
programmatic; JSON batches use finite base64 or VFS descriptors. Factory handles
are awaited and belong only to the current invocation registry. Metadata helpers
and properties are synchronous after admission, and returned bytes are owned.
