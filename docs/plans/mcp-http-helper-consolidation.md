# Bounded HTTP response helper consolidation

JWKS loading and OAuth metadata/body reads need the same bounded UTF-8 reader already maintained by the HTTP transport. Preserve one implementation in mcp-oauth and expose it to the tiny client. Move its focused tests to the owning package and update internal imports, avoiding duplicate logic and keeping cancellation/reader ownership semantics unchanged.

Temporary copies were used while the broad maintained test route was active. Consolidate once that route ends and consumers can be rebuilt sequentially. Verify size, declared-length, UTF-8, abort and cleanup contracts in the owning package plus client/JWKS suites.

The broad route is terminal and the eleven bounded-reader tests now reside in mcp-oauth, where all eleven pass. The tiny client keeps a direct export of the owner implementation; no implementation copies remain.
