# PPTX public input error categories

Own errors.ts, bytes.ts, xml.ts, public-input-errors.test.ts, the specific XML base-class assertion, and only the two matching index exports. Preserve all unrelated work.

Implement office-sdk section 5 and PPTX section 6.8 neutral typed errors over the existing admission/parser paths. Keep stable codes and phases. Map an explicit capability open failure with ENOENT to PackageNotFoundError; other I/O failures stay OfficeError. Cancellation takes precedence, and diagnostics never include supplied paths or provider error messages.

TDD: three original cases use malformed authored XML and a memfs missing path. Initial run: two failed because public constructors were absent, one passed for permission/cancellation. Add classes and integrate the existing paths. Update the older fragment assertion to check OfficeError inheritance, allowing the required specific subtype.

Agent QA: run the focused error, bytes, XML and model-error cases; run maintained PPTX unit and lint routes. This change does not change CLI text/help or rendering. Commit only owned changes on main; no push.

Validation: maintained `npm run test:unit --workspace=pptx` passed 202 files / 5,906 tests; `npm run lint --workspace=pptx` passed.
