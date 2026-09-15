# Image format and value API reconciliation

Task 69 is active after task 68 at main
`b879fb6113379e01467cee623684fa73385858e9`. Investigation is preparation;
no task 69 product operation, adaptation or parity claim is verified yet.
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
