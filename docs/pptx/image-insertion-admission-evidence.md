# Image insertion admission evidence

This receipt covers bounded byte/header admission and its separately verified insertion integration. The original TypeScript cases in `packages/pptx/src/image-admission.test.ts` are independent authored arrays; no decoder, downloaded asset, reference source or fixture was copied. Existing standalone legal notices remain unchanged.

## Exact JavaScript and security mapping

- Explicit `Uint8Array` bytes replace ambient path lookup and seekable file handles. Content type is an exact supported MIME string; neither suffixes nor implicit coercion determine format.
- PNG/GIF/JPEG container signatures and supported dimensions are checked without native runtime or decompression. JPEG entropy markers are scanned for later unsafe frames. Unknown JPEG frame dimensions remain `null`; the insertion caller must supply explicit width and height with default or explicit stretch fit.
- Width/height are integer pixel counts; normalized DPI uses the existing bounded metadata reader. Strings and non-finite density values do not coerce to numbers. All axes are at most 1,000,000, individual images at most 100,000,000 pixels, animated GIF frame pixels cumulatively at most 100,000,000, and encoded bytes at most 32 MiB.
- Alpha, palettes and compressed content remain original bytes. Header admission is not proof that compressed pixel data decodes successfully. Unsupported BMP/TIFF/vector insertion is an explicit remaining obligation; read-only inventory support is not insertion parity.
- This internal admission function does not implement or rename the documented model Image/ImagePart/Picture classes, constructors, inherited methods or properties. No underscore-prefixed type was reclassified as private.

## Parametrized and BDD accounting

The complete preexisting [121-row image case ledger](image-inventory-case-map.json) retains every selected parameter and BDD example with exact inventory pointers. The following per-row receipt accounts for their relationship to admission, without upgrading whole-row parity. Sizing, package relationship allocation and picture insertion have separate original SDK evidence in the JSON ledger. Full crop setters and neutral model APIs remain gaps. Density-only rows keep their existing metadata tests.

| Case ID | Evidence and remaining obligation |
| --- | --- |
| presentation-unit-91c243814808 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-fb2e9411289a | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-b366143c022b | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-e790db98ac5f | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-720e948c0952 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-4a3220beb224 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-3854b6bc0856 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-b5504d5046c9 | Original nonsquare 4-by-2 image covers native dimensions, width-only, height-only, explicit stretch and default stretch boxes. Both supplied dimensions default to stretch in the bounded operation API. The neutral ImagePart method is still absent; no whole-model parity. |
| presentation-unit-ad7fd90ba643 | Original nonsquare 4-by-2 image covers native dimensions, width-only, height-only, explicit stretch and default stretch boxes. Both supplied dimensions default to stretch in the bounded operation API. The neutral ImagePart method is still absent; no whole-model parity. |
| presentation-unit-9bda14f4e567 | Original nonsquare 4-by-2 image covers native dimensions, width-only, height-only, explicit stretch and default stretch boxes. Both supplied dimensions default to stretch in the bounded operation API. The neutral ImagePart method is still absent; no whole-model parity. |
| presentation-unit-b86a88b628a1 | Original nonsquare 4-by-2 image covers native dimensions, width-only, height-only, explicit stretch and default stretch boxes. Both supplied dimensions default to stretch in the bounded operation API. The neutral ImagePart method is still absent; no whole-model parity. |
| presentation-unit-a96183408cb0 | Original 204 by 204 JPEG header asserts pixel dimensions and absent-density 72 fallback; dependency internals and raw decoder tuple identity are not replicated. |
| presentation-unit-d7de68e11d14 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-31051f87d8e9 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-6265ea43dbe1 | Explicit byte input, retention and ownership tested; public Image constructor/property remains separate. |
| presentation-unit-4051e9d84ca3 | Explicit byte input, retention and ownership tested; public Image constructor/property remains separate. |
| presentation-unit-8515443702c1 | BMP/TIFF/vector metadata inventory does not imply insertion support; insertion rejects this format. |
| presentation-unit-0857c460092d | Exact MIME and canonical extension tested with original bytes; public Image model remains separate. |
| presentation-unit-77ac10c68e39 | Exact MIME and canonical extension tested with original bytes; public Image model remains separate. |
| presentation-unit-1c59ff997265 | Exact MIME and canonical extension tested with original bytes; public Image model remains separate. |
| presentation-unit-8fdeaf90135b | BMP/TIFF/vector metadata inventory does not imply insertion support; insertion rejects this format. |
| presentation-unit-5f28737a850f | BMP/TIFF/vector metadata inventory does not imply insertion support; insertion rejects this format. |
| presentation-unit-d32b8f4a1db9 | BMP/TIFF/vector metadata inventory does not imply insertion support; insertion rejects this format. |
| presentation-unit-27d892830d64 | Exact MIME and canonical extension tested with original bytes; public Image model remains separate. |
| presentation-unit-047b50bed43a | Exact MIME and canonical extension tested with original bytes; public Image model remains separate. |
| presentation-unit-147a581f9a6c | Exact MIME and canonical extension tested with original bytes; public Image model remains separate. |
| presentation-unit-8c34f8831879 | BMP/TIFF/vector metadata inventory does not imply insertion support; insertion rejects this format. |
| presentation-unit-3371bece8cae | BMP/TIFF/vector metadata inventory does not imply insertion support; insertion rejects this format. |
| presentation-unit-5a5652e1f037 | Original numeric tuple cases assert each audited normalization result through the bounded header metadata helper; number-only admission and ties-to-even rounding have explicit JS mappings; see [density correction](image-density-evidence.md). |
| presentation-unit-1f25980fb288 | Original numeric tuple cases assert each audited normalization result through the bounded header metadata helper; number-only admission and ties-to-even rounding have explicit JS mappings; see [density correction](image-density-evidence.md). |
| presentation-unit-740838c88241 | Original numeric tuple cases assert each audited normalization result through the bounded header metadata helper; number-only admission and ties-to-even rounding have explicit JS mappings; see [density correction](image-density-evidence.md). |
| presentation-unit-b6831ecbaf09 | Original numeric tuple cases assert each audited normalization result through the bounded header metadata helper; number-only admission and ties-to-even rounding have explicit JS mappings; see [density correction](image-density-evidence.md). |
| presentation-unit-fc9c9fdcdc67 | Original numeric tuple cases assert each audited normalization result through the bounded header metadata helper; number-only admission and ties-to-even rounding have explicit JS mappings; see [density correction](image-density-evidence.md). |
| presentation-unit-b3d8217c08ce | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-4d9204685be4 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-dc79ef5c9bf0 | Media compatibility SHA-1 and integrity SHA-256 are independently asserted with Node crypto over original authored bytes; the Image model property remains separate. |
| presentation-unit-aa873e116a88 | Original 204 by 204 JPEG header asserts pixel dimensions and absent-density 72 fallback; dependency internals and raw decoder tuple identity are not replicated. |
| presentation-unit-f4382377e979 | Original authored picture markup asserts each recorded crop read value, including missing attributes, negative crop and greater-than-one values. Direct Picture.crop_* model properties remain a separate API obligation. |
| presentation-unit-b78ba82ddac8 | Original authored picture markup asserts each recorded crop read value, including missing attributes, negative crop and greater-than-one values. Direct Picture.crop_* model properties remain a separate API obligation. |
| presentation-unit-5637df81e4c5 | Original authored picture markup asserts each recorded crop read value, including missing attributes, negative crop and greater-than-one values. Direct Picture.crop_* model properties remain a separate API obligation. |
| presentation-unit-34ba8092668b | Original authored picture markup asserts each recorded crop read value, including missing attributes, negative crop and greater-than-one values. Direct Picture.crop_* model properties remain a separate API obligation. |
| presentation-unit-eae707fb55fa | Original authored picture markup asserts each recorded crop read value, including missing attributes, negative crop and greater-than-one values. Direct Picture.crop_* model properties remain a separate API obligation. |
| presentation-unit-ea14a8d403b4 | Original authored picture markup asserts each recorded crop read value, including missing attributes, negative crop and greater-than-one values. Direct Picture.crop_* model properties remain a separate API obligation. |
| presentation-unit-d27c8d5a5a57 | Original authored picture markup asserts each recorded crop read value, including missing attributes, negative crop and greater-than-one values. Direct Picture.crop_* model properties remain a separate API obligation. |
| presentation-unit-83dac690f32a | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-6376b0f15679 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-6a65aacb6191 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-0d71658602d5 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-556a3ac44074 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-ebcffaf400c8 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-12450cf9ee92 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-853acd97deef | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-840c6be64e4e | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-a83f1bc84b50 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-4ed44d0f3035 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-efc54aabbc6e | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-eeed295d75f6 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-d1b2c2679401 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-75859a74b031 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-2a40c68c6e2d | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-f413e6833613 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-48e912b0c901 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-211ef5b0556d | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-b5a9ecedaa1b | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-5adda9ea035d | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-2b0ceede9805 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-112a0f5a9535 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-7eefb7318396 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-b3271b2c2383 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-9de16ca3f584 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-3a2c7866d339 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-ef00251b2abb | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-578cf476ec91 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-c925eb99d943 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-b172f886586e | Shared occurrences yield one default media record per part; linked targets remain occurrences with no bytes. Non-image relationships do not produce media rows. |
| presentation-unit-854276fcba16 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-24b83881c66b | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-3bba2df7e506 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-54df6c3779ee | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-unit-2548d24c40ba | Opaque vectors are retained and hashed rather than skipped by a private hash lookup. Intrinsic size is explicitly unknown. No image insertion/deduplication lookup API is claimed. |
| presentation-bdd-a9830ddf61a6 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-beb1261edaeb | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-de957907b33b | Inventory accepts and preserves a declared image/jpg MIME value without rewriting the package. Canonical characterization and subsequent model save behavior are separate obligations. |
| presentation-bdd-dbb7a1d72792 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-a466e4f3e2c6 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-c44f2df416aa | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-726b2e4e1796 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-47dc6bf879ef | Original authored picture markup asserts each recorded crop read value, including missing attributes, negative crop and greater-than-one values. Direct Picture.crop_* model properties remain a separate API obligation. |
| presentation-bdd-a18292bfe492 | Original authored picture markup asserts each recorded crop read value, including missing attributes, negative crop and greater-than-one values. Direct Picture.crop_* model properties remain a separate API obligation. |
| presentation-bdd-f97fa248a247 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-9ff264b21d88 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-4c26ce757f70 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-df781268e734 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-c68356dbaf0f | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-254b5eff72c9 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-d5eb46286927 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-be18506184f1 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-c79f2d505c9d | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-68e07a3c8494 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-b0ea90fa73e5 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-9649ae7ccf82 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-c9060ab30649 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-450cafe9e13f | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-def2e613cf20 | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-f910559e664f | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-02b71ac19a1f | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-1a54af20915e | Returned Image/ImagePart/Picture model, cropping setters, playback and other neighboring APIs remain obligations; bounded insertion does not establish parity. |
| presentation-bdd-16d75de07073 | Original GIF bytes pass header admission and independent SDK package insertion assertions. Explicit VFS/bytes replace ambient filename/seekable-handle APIs; exact neutral public model scenario remains partial. |
| presentation-bdd-b40a00cb2ef4 | Original JPG bytes pass header admission and independent SDK package insertion assertions. Explicit VFS/bytes replace ambient filename/seekable-handle APIs; exact neutral public model scenario remains partial. |
| presentation-bdd-4a377fae63aa | Original PNG bytes pass header admission and independent SDK package insertion assertions. Explicit VFS/bytes replace ambient filename/seekable-handle APIs; exact neutral public model scenario remains partial. |
| presentation-bdd-eec99c93e60c | Format remains a future insertion obligation; no test claims equivalence from read-only metadata. |
| presentation-bdd-7ef30a31d8e1 | Format remains a future insertion obligation; no test claims equivalence from read-only metadata. |
| presentation-bdd-dc4f4580ac55 | Format remains a future insertion obligation; no test claims equivalence from read-only metadata. |
| presentation-bdd-bd43137a6647 | Format remains a future insertion obligation; no test claims equivalence from read-only metadata. |
| presentation-bdd-69b3cf51b29d | Original GIF bytes pass header admission and independent SDK package insertion assertions. Explicit VFS/bytes replace ambient filename/seekable-handle APIs; exact neutral public model scenario remains partial. |
| presentation-bdd-31929f0f2a0a | Original JPG bytes pass header admission and independent SDK package insertion assertions. Explicit VFS/bytes replace ambient filename/seekable-handle APIs; exact neutral public model scenario remains partial. |
| presentation-bdd-7422d19c3d36 | Original PNG bytes pass header admission and independent SDK package insertion assertions. Explicit VFS/bytes replace ambient filename/seekable-handle APIs; exact neutral public model scenario remains partial. |
| presentation-bdd-266bb2222c6d | Format remains a future insertion obligation; no test claims equivalence from read-only metadata. |
| presentation-bdd-a35e548b135c | Format remains a future insertion obligation; no test claims equivalence from read-only metadata. |
| presentation-bdd-17a91580ca54 | Format remains a future insertion obligation; no test claims equivalence from read-only metadata. |
| presentation-bdd-a1a5870ff7ae | Format remains a future insertion obligation; no test claims equivalence from read-only metadata. |

## Validation

Initial focused run failed because the admission module did not exist. A second red run reproduced acceptance of invalid PNG chunk names and an unsafe JPEG frame after entropy bytes. Both became green after bounded validation changes. Focused suite currently has 38 passing original cases; focused source/test ESLint passed. Maintained integration checks and SDK/CLI receipts belong to the root-owned insertion plan.

Complete machine-readable accounting: [image insertion case map](image-insertion-case-map.json). Every original image case ID remains visible, and all whole-row parity flags remain false.

## Insertion integration receipt

The 40-case `image-insertion.test.ts` suite passed in focused integration verification.
`retains an original RGBA PNG compressed payload and transparent pixel` asserts
unchanged package media bytes, independently inflates the authored payload and
asserts exact pixels including transparent alpha. `uses JPEG frame dimensions
without altering compressed bytes` asserts the stored byte sequence and a 200-by-100
EMU box from a 6-by-3 frame; it makes no JPEG decodability claim. Existing GIF
geometry cases cover native, width-only, height-only, contain, cover and stretch.

Physical sizing uses `(pixelWidth / dpiX) / (pixelHeight / dpiY)`. Existing metadata
cases independently characterize PNG density 96/48 and JPEG density 102/51; a
separate end-to-end unequal-DPI insertion test is not claimed. Both supplied box
dimensions default to stretch, including admitted images whose intrinsic dimensions
are unavailable. Explicit fit requires both dimensions. Independent original cases
assert signed half-position rounding, derived zero-dimension rejection, both-axis
contain/cover, and cover values on either side of the empty-source quantization
boundary. The neutral model remains an explicit API gap.
