# Text fitting public argument contract

Own `text-frames.ts`, `text-fit-public-arguments.test.ts` and the matching receipt
under `docs/pptx`. Reuse `fitFrameXml` and explicit admitted metrics.

1. Reproduce the documented null-versus-undefined positional mapping and prove
   caller option accessors are not executed before validation.
2. Validate public argument types and stored option data before copying options.
3. Retain existing synchronous fitting, default values and no-publication-on-error.
4. Run original in-memory regressions and the existing fitting suite. No external
   files, metrics discovery, network or CLI presentation changes are involved.

Completed: nine reproduced argument-validation failures were addressed; the
undefined-default compatibility case remained passing. All 38 focused frame and
fitting tests now pass. The receipt records exact language mappings and limits.

Maintained validation: `npm run test:unit --workspace=pptx` passed 206 files / 5,936 tests; `npm run lint --workspace=pptx` and `npm run build:workspaces -- --workspace=pptx` passed. Built workspace-package consumer verified async factory/save and live property/canvas round trip. These are local workspace checks, not publication or whole-public-API certification.
