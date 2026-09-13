# Text fitting public argument mapping

This receipt refines `TextFrame.fit_text` in the API register and supplements the
existing fitting evidence. It does not claim new layout support or whole API
coverage.

The live method keeps the documented positional defaults: font family `Calibri`,
maximum size `18`, bold `false`, italic `false`. Explicit `undefined` selects those
defaults. Explicit `null` for any of these four arguments throws the exported SDK
`TypeError` (`invalid-type`, phase `usage`), as required by their `null_behavior` rows in `public-api-map.json`.
The retained fifth argument accepts an already admitted `FontMetricsHandle`;
missing/null metrics still produce the existing neutral unsupported-edit error,
without ambient font discovery. The synchronous method returns `void`.

The existing sixth typed options argument permits `minSize`, `marginLeft`,
`marginRight`, `marginTop`, `marginBottom`, `wrap`, and `lineSpacing`. Options must
be a plain or null-prototype stored-data record. Accessor properties, symbol keys,
arrays, null and custom prototypes are rejected before copying any option values.
Duplicated positional controls such as `fontFamily` are rejected rather than
silently overwritten. Invalid containers use neutral `OfficeError` with
`invalid-value`; numeric bounds remain governed by the existing fitting engine.

These public argument rejections occur before invoking the frame binding or fitting engine and
leaves the current `XmlPart` unchanged. No second fitting engine, asynchronous
model path, network, filesystem, font runtime or default asset is introduced.
The existing package fitting commands continue to use `fitFrameXml` with their
separate operation options; CLI behavior and flags are unchanged.

Original tests in `text-fit-public-arguments.test.ts` establish these JS-specific
obligations, supplementing baseline cases without upstream language equivalents.
After choosing adequate parser limits for the original tiny frame, eight tests
failed before the first implementation. The duplicate-option regression then
failed before its guard was added. All 10 new tests and the 28 existing focused
frame/fitting tests pass (38 total). Maintained checks are recorded by the
coordinating delivery.

Review verification: four class-identity regressions failed against the native
error before switching to the shared SDK TypeError; tests assert class, code and
phase. The focused 38-case suite passes after this correction.

Maintained validation: `npm run test:unit --workspace=pptx` passed 206 files / 5,936 tests; `npm run lint --workspace=pptx` and `npm run build:workspaces -- --workspace=pptx` passed. Built workspace-package consumer verified async factory/save and live property/canvas round trip. These are local workspace checks, not publication or whole-public-API certification.
