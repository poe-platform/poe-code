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
