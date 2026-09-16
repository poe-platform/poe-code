# OPC identity and media types

Scope: only the `opc-identity` milestone. Root policy applies; there are no scoped
AGENTS files under packages/pptx or docs. No adapter exists yet, so no CLI behavior
is exposed by this milestone. Do not run the whole pipeline or change its existing
status edits. Do not change README files, push, or release.

## Procedure

1. Read the format/shared contracts, test/API audits and inventories, corpus
   manifest, existing byte reader and writer, and pinned standards text.
2. Add original failing tests before implementing URI metadata/reference operations
   and content-type parsing. Use authored memory bytes and memfs capabilities.
3. Run the maintained pptx test/lint routes and selected workspace build closure.
   Inspect published declarations and portable bundling. No CLI visual output is
   changed; screenshot checks apply when the adapter is introduced.
4. Consult existing manifest-listed disposable corpus files, if present, for
   bounded read-only admission QA. Reduce findings into original small tests.
5. Record exact relevant source-case dispositions in research, preserving other
   members and broader BDD workflows as outstanding. Commit atomic owned changes.

## URI outcome

Implemented original immutable metadata plus relative reference resolution and
emission. Existing reader name validation and ASCII equivalence now share the
same module. Absolute part names reject dot segments, empty segments, unsafe
encoding and query/fragment syntax. Relative references resolve internal dot
segments but reject package-root escape, authorities and schemes. URI strings
never enter host path APIs. Numeric suffixes return null when absent and reject
integers outside the JS safe range. Root metadata is supported; it is not a part.
ASCII folding leaves non-ASCII case and normalization forms unchanged. Percent
hex is canonicalized without decoding reserved ASCII into separators.

TDD: the original URI suite failed with the missing module, then 41 URI and 35
existing reader cases passed. These tests assert independently authored expected
metadata and references; no source fixtures or implementation were copied.

## Standards and language mapping

ECMA-376 Part 2 (2021), 6.2.2, 6.4 and 7.2.3 govern names, relative references and
media-type lookup. The local audited source is ecma-p2.txt under the standards
cache recorded by /tmp/pptx-standards-current-path.txt; the authoritative edition
is linked by https://ecma-international.org/publications-and-standards/standards/ecma-376/.
RFC 3986/3987 syntax is implemented with explicit character/segment parsing, not
WHATWG host URL resolution. JS immutable records replace string subclasses;
missing indexes are null, invalid names use OfficeError unsafe-path, unsafe
integers use invalid-value. Source private class mechanics do not define APIs.
Public inherited/underscore-prefixed model obligations remain in their existing
registers and are not reclassified by this internal primitive work.

URI validation: maintained `npm run lint --workspace=pptx` and
`npm run test --workspace=pptx` passed (192 cases at that point). The selected
`npm run build:workspaces -- --workspace=pptx` includes the shared ZIP dependency.

## Content-type outcome and QA

Added a bounded namespace-aware parser using the pure JavaScript `saxes` package.
The existing shared package is ZIP-specific; content-type semantics stay in
packages/pptx, without depending on shell XML code or introducing a second XML
parser implementation. Dependency version 6.0.0 and its transitive XML character
tables are lockfile-pinned. Parser API documentation was checked at
https://github.com/lddubeau/saxes. No parser implementation was copied.

TDD: 60 initial content-type cases failed for the missing module, then passed.
Checking the actual opc-contentTypes.xsd exposed a mistaken assumption that
extensions share MIME-token syntax. Fourteen additional cases produced eleven
failures; the corrected extension parser passes all 74 cases. The suite covers
independent expected lookups, original memfs ZIP admission, duplicate/case rules,
unsafe names, malformed XML, namespace prefixes, UTF-8/UTF-16, explicit resource
limits, MIME parameters, image/jpg preservation, all three main kinds, wrong main
kind and explicit suffix disagreement. A test string escape lint error was fixed.

Read-only corpus QA used only three already cached files below 1.5 MB. First
verify each byte length and SHA-256 against corpus-manifest.json; admit via the
built package reader with explicit archive ceilings; parse its media-types stream;
look up every part; check the explicitly supplied main part's pptx kind. Executed
results: 37, 28 and 42 parts respectively, all mappings present and all main kinds
pptx. Exact manifest paths are in the evidence JSON. No downloads, fixture
mutations, cleanup or visual-fidelity claims. These runs found no further defects.

The browser-target esbuild bundle compiled and its lookup executed successfully
with supplied bytes. This is a portable import smoke check, not a real-browser or
workerd conformance claim. Declaration generation passed with the selected
workspace build closure. Public package exports and CLI output are unchanged, so
packed-public API and screenshot checks do not apply to these internal additions.

The research receipt joins all 21 URI and 10 content-type-map source identities,
including every parameter variant, to original tests. Source string-subclass
requirements map to validated JS strings, missing-key errors to missing-binding,
and constructor mocks to observed lookup results. Six related BDD workflows and
13 serializer/model/media unit cases are explicitly deferred to their owning
milestones; content-type parsing alone cannot establish those operations. Existing
API and command inventories retain every inherited and underscore-prefixed public
member. No whole-API or whole-pipeline completion is claimed.

Final maintained checks passed: `npm run lint --workspace=pptx`,
`npm run test --workspace=pptx` (266 cases),
`npm run build:workspaces -- --workspace=pptx`, scoped Prettier and
`git diff --check`. URI work is local commit `3ee01fd7c`; content-type work is a
separate atomic local commit. Nothing is pushed or released.
