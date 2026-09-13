# Presentation public boundary

Scope: connect the async public `Presentation` factory to the existing package admission, property model, canvas editor, archive writer and publication contract. Do not construct a second slide editor.

- [x] Read root instructions, PPTX and shared office specifications, and pinned API/test audit inventories.
- [x] Reproduce absent public factory with an original failing import test.
- [x] Add explicit deterministic context defaults, byte/stream/VFS admission, live core properties and synchronous canvas dimensions.
- [x] Extract the existing synchronous canvas mutation and conditional-settings guard for shared operation/model use.
- [x] Test owned input/output bytes, async-only factory/save, failed admission, missing properties, absent dimensions, stale model publication, repeated atomic saves, receiver-preserving destination snapshots and cancellation.
- [x] Add evidence that distinguishes implemented members from outstanding object graph obligations.
- [x] Root ran maintained package checks and built public-package smoke; owned changes are committed locally on main. No push/release.

Agent QA procedure: run the focused model, public export, settings and property suites; run the maintained PPTX lint/build/unit routes; use built public exports to create, edit, save and reopen an original deck. No downloaded fixtures, host filesystem access or native application is required by product behavior. No CLI presentation changed in this boundary, so screenshot QA is not applicable.

Maintained validation: `npm run test:unit --workspace=pptx` passed 206 files / 5,936 tests; `npm run lint --workspace=pptx` and `npm run build:workspaces -- --workspace=pptx` passed. Built workspace-package consumer verified async factory/save and live property/canvas round trip. These are local workspace checks, not publication or whole-public-API certification.
