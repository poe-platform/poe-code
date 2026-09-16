# PPTX accessibility metadata work plan

Scope: implement the bounded F52 structural inspector and metadata editor under
`packages/pptx`; the safe-bash adapter remains under its command directory. Root
only wires exports. This is one integrated atomic improvement on main, with no
push, release, pipeline execution, README change or downloaded fixture commit.

Ownership: the domain worker owns `accessibility.ts` and domain tests. Root owns
package exports and command-engine wiring; the command worker owns the command
modules, schemas and adapter coverage;
the research worker owns this plan and the four `docs/pptx/accessibility-*`
receipts. The root agent coordinates integration, maintained checks, independent
review, disposable QA and the final explicit-path commit. Existing unrelated
changes are preserved.

The authoritative inputs are `docs/specs/pptx.md` F52 and accessibility appendix,
`docs/specs/office-cli.md`, `docs/specs/office-sdk.md`, both upstream audits and
full inventories. Keep reference identities only in research/provenance and
standalone legal notices. New fixtures and assertion wording are original.

1. Reproduce the missing read/edit domain and direct command routes with failing
   original TypeScript tests using admitted memory bytes and memfs publication.
2. Implement alt text/description aliasing, independent metadata titles,
   documented decorative XML, title-placeholder diagnostics and depth-first
   structural order. Preserve unknown extensions and occurrence independence.
3. Test shared-image occurrences with different descriptions, explicit empty
   overrides, layout metadata provenance, all five nonvisual object forms,
   nested groups, invalid metadata, read nonmutation and atomic selection errors.
4. Expose the same domain behavior through direct SDK operations and shared
   command schemas, list/get/set routes, selectors, JSON and status codes.
5. Run maintained scoped tests, lint and build closure after integration. Record
   actual outcomes in the root QA plan; do not infer passing evidence from code
   presence. Use the screenshot command for CLI presentation review.
6. Validate receipt IDs against the pinned inventories and original test names
   against current files. Commit only explicitly owned implementation/tests,
   receipts and relevant plans once maintained checks pass.

The disposable corpus procedure and actual QA run records belong in
[pptx-accessibility-qa.md](pptx-accessibility-qa.md). It uses only manifest-listed
fixtures and separate owned outputs. Meaningful findings become small original
regressions; no corpus download becomes a unit-test dependency.

The bounded inspector is not the live model API. The 49 nearby unit variants,
24 BDD examples and 103 relevant public member rows remain explicit deferred
parity obligations in the focused ledgers. No certification, measured contrast,
visual reading-order or screen-reader behavior is asserted.
