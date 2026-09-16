# Public input error mappings

The shared SDK and PPTX section 6.8 require neutral typed errors. The package exports `InvalidXmlError` (OfficeError, invalid-xml, parse) and `PackageNotFoundError` (OfficeError, io-failure, admit). Constructors accept an optional diagnostic string; engine-generated diagnostics are bounded neutral messages.

`parseXmlPart` raises InvalidXmlError for malformed XML and forbidden declarations through its existing parser. Structured-edit value errors and resource ceilings retain their existing categories. Capability-scoped input open failures carrying ENOENT raise PackageNotFoundError. Permission/read failures remain generic io-failure; cancellation wins before missing-path mapping. No host lookup, path string fallback or implicit network is introduced.

Original tests: `packages/pptx/src/public-input-errors.test.ts` covers public exports, malformed XML, Promise-only admission, memfs missing path, diagnostic privacy, permission distinction and cancellation. The preimplementation run produced two failures for absent constructors. Existing XML fragment tests now assert the common base class rather than forbidding subtypes.

This is the J08 neutral error mapping for the public exception surface, not whole-public-API completion. Other errors and model ownership obligations remain independently tracked.

Validation: maintained `npm run test:unit --workspace=pptx` passed 202 files / 5,906 tests; `npm run lint --workspace=pptx` passed.
