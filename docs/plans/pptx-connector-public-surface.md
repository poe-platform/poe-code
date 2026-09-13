# Connector inherited public surface

Ownership: `connectors-model.ts`, `connector-public-surface.test.ts`, and the matching
receipt in `docs/pptx`. Extend the existing connector and drawing format objects;
keep all mutations synchronous and use the existing namespace-aware XML edits.

1. Reproduce missing inherited `shadow` and `placeholder_format` using original
   in-memory XML tests, including Strict namespaces and sibling preservation.
2. Expose the existing `ShadowFormat` against the connector's current owned XML.
   Preserve the documented placeholder default values and neutral enum spelling.
3. Verify failure atomicity for advanced shadow edits and absent placeholders.
4. Run focused tests and the maintained package lint/test checks. No CLI appearance
   changes or external QA assets are involved; no screenshot procedure is needed.

Completed: six failing tests reproduced the missing getters; six original tests
now pass, and all 35 focused connector tests pass. Existing foreign/stale target
checks passed and required no speculative ownership changes. Evidence is recorded
in `docs/pptx/connector-public-surface.md`.

Maintained validation: `npm run test:unit --workspace=pptx` passed 206 files / 5,936 tests; `npm run lint --workspace=pptx` and `npm run build:workspaces -- --workspace=pptx` passed. Built workspace-package consumer verified async factory/save and live property/canvas round trip. These are local workspace checks, not publication or whole-public-API certification.
