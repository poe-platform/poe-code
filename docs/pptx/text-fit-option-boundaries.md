# Fitting option absence and bounds receipt

The public `fitTextFrames(input, options, context)` operation now rejects explicit
`null` for `fontFamily`, `maxSize`, `minSize`, `bold`, `italic`, and `lineSpacing`
with `OfficeError`, code `invalid-value`, phase `usage`, before admitting input.
Explicit `undefined` retains documented defaults: `Calibri`, 18 points, 1 point,
false, false, and a line-spacing multiple of 1, respectively. The synchronous
`TextFrame.fit_text` path shares this validator for trailing numeric controls;
its four positional argument type-error mapping remains unchanged.

Original acceptance: `text-fit-option-boundaries.test.ts` contains six failing-
then-passing null cases through both the validator and public SDK, six undefined
cases, command-schema null rejection for each field, and pre-read CLI rejection
of the literal invalid numeric value `null`. The latter checks use memfs and
assert neither input admission nor publication occurs. CLI numeric options have
no null spelling; schema rejection is the exact JSON-null mapping. No CLI flag
or schema change was necessary because those boundaries already rejected null.

The nondefault bounds case independently derives a maximum size of 13 points:
`AA` occupies one em, available width is 13 points, and the 26-point height
permits one line at double spacing. Minimum 13 succeeds and serializes a font
size of 13; minimum 14 throws `unsupported-edit` and retains the same XML handle.
This supplements existing fitting cases rather than claiming a replacement for
unreviewed source rows or BDD examples.

Research association: `upstream-api-inventory.json` entry
`pptx.text.text.TextFrame.fit_text` retains its historical baseline label. The
later fitting receipts, including this one, supply current bounded evidence.
`text-fitting-case-map.json` remains the authority for individual source fitting
cases and layout-engine-specific dispositions. This JavaScript null/default
regression adds contract coverage; it does not collapse source variants or
remove crop, font-discovery, shaping, or renderer obligations. The explicit
metrics handle remains the security mapping for host font discovery/file access.

No upstream code/assets were copied; the original arithmetic fixture needs no
new derived-material notice. Existing standalone legal notices remain unchanged.
The focused four-file suite passed 41 tests after six new null regressions failed
against the previous validator. Maintained checks and commit are reported by the
coordinating delivery. No whole-public-API or complete source-test parity claim.
