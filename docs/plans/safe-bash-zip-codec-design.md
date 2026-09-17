# Bounded ZIP codec extensions

Authorized scope: packages/safe-bash on main. Method 14 and method 98 are
format extensions beyond native Info-ZIP Zip 3.0. Runtime dependencies and
host-process fallback remain prohibited. README and SafeJS are excluded.
Revision-specific observations belong in safe-bash-zip-remaining-features-evidence.md.

## LZMA reuse design

The authenticated XZ 5.8.3 source already includes raw LZMA1 and LZMA1EXT.
Expose an explicit initializer through the maintained generated-code build;
do not patch generated internals. Preserve existing XZ initialization, allocator,
64 MiB tracked-allocation cap, 128 MiB heap maximum, bounded step driver and
owned codec destruction. Add no asset or dependency beyond the rebuilt XZ asset.

ZIP framing consists of two encoder-version bytes, little-endian property
length, five LZMA1 properties and raw data. The qualified initial profile is
SDK 9.4 with five-byte properties. Admit lc/lp/pb, lc+lp <= 4 and dictionary
<= 8 MiB before native allocation. Dictionary values below 4096 use liblzma's
documented minimum. Writer levels 1–9 retain their preset effort with a 1 MiB
dictionary and lc=3/lp=0/pb=2, fitting the tracked allocator budget.

EOS readers use LZMA1 and require the end marker. Clear-EOS readers use strict
LZMA1EXT with the declared size and no optional end marker. The writer always
advertises and emits EOS, extraction version 63, including with ZIP64. Direct
raw codec encoding can also generate size-terminated streams. Keep bit 1 across
DOS naming, descriptors, encryption and copied members. Refuse reserved flags,
bad size/CRC, truncated range data and any compressed remainder. Apply existing
archive/output budgets before publishing chunks; never publish beyond a LZMA
member's declared size. Consumers may have received earlier unauthenticated
plain output before a final error, consistent with the existing extraction contract.

CLI -Zlzma and SDK zip.compression select the same package logic. Retain STORE
fallback for buffered inputs and compressed live/stdout behavior. AES+LZMA,
other encoder-version profiles and larger dictionaries remain open/refused.

Acceptance requires independent Python EOS and native liblzma non-EOS vectors;
empty, small, binary and incompressible encode/decode; malformed properties;
dictionary boundaries; every prefix of compact EOS/non-EOS data; actual output
bombs; cancellation before acquisition and during acquisition/input/step/work/
output; consumer retirement with zero tracked native allocation; and mixed
STORE/DEFLATE/BZIP2 neighboring controls. Add native oracles only outside unit
discovery, passing bytes through stdin/stdout without host fixture files.

## PPMd minimal dependency-free design, not implementation

No existing package asset exposes PPMd. Variant H from 7z is unsuitable:
ZIP method 98 requires variant I / PPMd8. Do not import a library merely because
it has a PPMd name or recognize the method number as support.

Proposed first profile: order 2–8, 1–8 MiB model arena, restart restoration only.
The little-endian two-byte properties encode order-1 in bits 0–3, memory MiB-1
in bits 4–11, restoration in bits 12–15. Reject unsupported order/restoration
and excessive memory before arena allocation. Extraction version must be 63;
GPBF DEFLATE/LZMA option bits are inapplicable. Other admitted archive flags
reuse the normal package format rules. Do not expose a CLI/SDK choice until
both actual encoding and decoding satisfy independent interoperability controls.

The codec requires these explicit components, all inside this package:

1. An owned typed-array arena with integer offsets, 12-byte allocation units,
   reference-compatible size classes/free lists and deterministic restart.
   Admission covers the arena, class ledgers, probability/exclusion state and
   I/O slabs together. No host object per unbounded context or implicit malloc.
2. Context/state records with bounded suffix and successor walks, binary and
   multi-symbol distributions, exclusion epochs, escape estimation, rescaling,
   update ordering and successor construction. Every lookup validates arena
   offsets and admitted order; stale/released records never remain traversable.
3. An unsigned-32-bit carryless range encoder/decoder,
   normalization and strict terminal/flush verification. Need-for-input/output
   suspends state without advancing the model twice. A ZIP end marker cannot
   be inferred solely from declared output size or a exhausted byte source.
4. A BoundedCodec implementation with a per-step counter covering normalization,
   suffix walks, updates, rescaling, allocation/glue and restoration. Suspend
   long maintenance work to make signal observation/yielding cooperative.
   Reuse the existing step driver, ByteSource/ByteSink and reader ownership.
5. An encoder using exactly the same admitted variant/profile and update rules;
   an independent reader must extract emitted empty, one-byte, repetitive and
   incompressible streams. Matching two halves of this implementation is not
   independent interoperability proof.

Do not write a guessed state-transition implementation. The ZIP framing
specification and a large positive archive do not completely specify PPMd-I
model/allocator/range transitions. Prerequisites remain open: independent
published arithmetic known-answer vectors and context-update traces; a reviewed
variant-I transition/arena specification; and pinned empty/small/incompressible,
restart and terminal fixtures with provenance and licenses. Published source
can be reviewed as an oracle, but copying an unaudited implementation is excluded.

Pinned interoperability anchor (not a model known-answer suite): libarchive
9525f90ca4bd14c7b335e2f8c84a4607b0af6bdf,
libarchive/test/test_read_format_zip_ppmd8.zipx.uu, decoded SHA-256
3524501a47b1947a162cb2b33ccabc8d2bd8c2311b86c0a6af6f7ba28eedbf6e.
Its vimrc member is order 8 / 1 MiB / restart, with 912 output bytes.
Keep this public input outside product runtime and unit discovery until its
fixture adaptation/provenance requirements are qualified. Crash fixtures need
an independent valid control beside each malformed case, not guessed byte edits.

All PPMd acceptance cells remain open: encoder, decoder, empty/small/random,
malformed properties, arena boundaries/restoration, truncated/terminal/trailing
data, actual bombs, each cancellation phase, flags/version, CLI/SDK and codec
neighbors. This design is prerequisite work and does not complete method 98.

## PPMd published vector and range-design refinement

Follow-up source inspection found a published byte-level variant-I known answer
in PyPPMd at commit `f5a852c3ae83df5de9b9a2814fe6de685e492d98`,
`tests/test_ppmd8.py`. Its source SHA-256 is
`61331fa7252adcee58de35cae00b60c2c852995051ff3b64dc6ef9d2740b1844`.
The `test_ppmd8_encoder1` and split-input `test_ppmd8_encoder2` assertions
specify identical 42-byte output for a 67-byte payload, order 6, 8 MiB,
restart restoration. Decoder and high-level variant-I tests use those bytes.
This is now an identified published codec known answer; it is not an arithmetic
transition trace or an empty/small/incompressible qualification suite.
The locally constructed ZIP wrapper and independently verified native decode
are pinned in the evidence plan. No upstream code was imported into the package.

Inspection of that revision's `src/lib/ppmd/Ppmd8Enc.c` and `Ppmd8Dec.c`
corrects the initial range design: PPMd-I uses the carryless Subbotin coder,
not an LZMA-style delayed-carry coder. The proposed state is unsigned 32-bit
low/range/code, initialized to low 0 and range `0xffffffff`; decoding consumes
four initial bytes and rejects initial code `0xffffffff`. For a distribution,
divide range by total, add cumulative-start times range to low, and multiply
range by the selected frequency. Decoder code subtracts the same interval
start. Binary distributions use a 14-bit total.

Normalization uses top `1 << 24` and bottom `1 << 15`: stable high bytes
normalize first; otherwise a range below bottom is corrected to
`(-low) & (bottom - 1)`. Emit/read the high byte, then shift the state by eight
with explicit unsigned wrapping. Encoder flush emits four high bytes of low.
The end symbol escapes through the suffix chain until the root has no suffix;
declared output length alone cannot identify it. These are inspected arithmetic
rules, not proof that malformed terminal states are safely accepted/rejected.
Exact terminal consumption and flush validation still require independent
controls, including every prefix and trailing bytes.

Each normalization iteration must have a resumable phase before I/O. Partial
four-byte initialization/flush retains a bounded byte index. After a symbol
interval is selected, input/output suspension must resume normalization without
repeating probability updates. Model updates and allocator maintenance need
their own resumable phases; yielding only between symbols is insufficient.
No implementation starts until the model/arena transition specification,
independent traces and remaining fixture profiles are qualified.

Source notices identify the range/model C components as public domain, but the
PyPPMd test/wrapper project is LGPL 2.1 or later. Reference URLs and authenticated
measurements here do not authorize copying that project's tests or wrappers.
Any future adapted fixture suite must preserve its applicable notices/licenses.
