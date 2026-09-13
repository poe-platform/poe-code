# Image density correction

The original TypeScript metadata and SDK tests reproduce and correct a mismatch
between historical implementation/accounting and PPTX specification section 6.5.
Finite numeric density rounds to nearest integer, ties to even, before checking
1..2048. Each invalid axis independently becomes 72. Thus 42.5 becomes 42,
23.5 becomes 24, 0.5 becomes 72 after rounding to zero, and 2048.5 becomes 2048.
Numeric strings, nonfinite numbers and other types do not coerce.

## Exact source accounting and language mapping

Pinned source: `278b47b1dedd5b46ee84c286e77cdfb0bf4594be`, research checkout
`/tmp/pptx-upstream-review`, `src/pptx/parts/image.py:187–217` and
`tests/parts/test_image.py:128–130,164–193`. The source uses ties-to-even; earlier
receipts incorrectly described half-up rounding as an accepted JS divergence.
The explicit number-only policy remains a deliberate no-coercion mapping.

All five relevant parameter variants are retained in both
[inventory accounting](image-inventory-case-map.json) and
[insertion accounting](image-insertion-case-map.json):

| Inventory pointer in upstream-test-inventory.json | Case ID                        | Original assertion                     |
| ------------------------------------------------- | ------------------------------ | -------------------------------------- |
| /unit_cases/1608                                  | presentation-unit-5a5652e1f037 | Integer axes 42/24 remain 42/24        |
| /unit_cases/1609                                  | presentation-unit-1f25980fb288 | Fractional axes 42.1/23.6 become 42/24 |
| /unit_cases/1610                                  | presentation-unit-740838c88241 | Missing density becomes 72/72          |
| /unit_cases/1611                                  | presentation-unit-b6831ecbaf09 | Out-of-range axes become 72/72         |
| /unit_cases/1612                                  | presentation-unit-fc9c9fdcdc67 | Invalid density becomes 72/72          |

These assertions remain in `image-metadata.test.ts`. No dedicated density BDD
scenario exists in the pinned inventory. All 121 broader image variants/scenarios
remain in the existing ledgers, including unimplemented format/model obligations.
New tie and adjacent-value cases supplement the baseline rather than inventing
source scenarios. Whole-row parity flags remain false.

The documented `pptx.parts.image.Image.dpi` research member maps to the planned
neutral `Image.dpi` readonly pair. Current `readImages(...).media` exposes detached
`dpiX`/`dpiY` numbers; it does not implement the live model property. The
[API receipt](image-inventory-api-map.json) retains that gap and all inherited,
underscore-prefixed and untested public members. No new public signature or
command-schema alias is introduced.

## Original evidence and security boundary

`image-metadata.test.ts` covers both TIFF endian forms, rational 85/2 and 47/2,
even/odd ties, neighboring fractional values, bounds and independent fallback.
`image-insertion.test.ts` uses an authored JPEG header with 75/25 pixels per
centimeter (190.5/63.5 DPI) and a 190-by-64 pixel frame. Independent ZIP and XML
inspection requires a 914400-by-914400 EMU picture; SHA-256 extraction verifies
unchanged media bytes. This checks header characterization, not pixel decoding.
The companion CLI regression uses explicit memfs input/output capabilities.

TIFF, EMF, WMF, WDP, animated payloads and SVG remain subject to their existing
preservation/admission boundaries. No fetch, execution, transcoding, ambient I/O
or corpus shipment is introduced. Existing standalone MIT notices are retained;
test wording and byte arrays are original. QA/check procedures and actual results
are in [the plan](../plans/pptx-image-density.md).
