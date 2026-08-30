# Retained-copy author scope

Started 2026-08-27 at approximately 10:48 UTC. Initial observed HEAD:
`c3fbda6279028fd2bde9f6d967970870ff7546aa`.

Ownership: only the retained `chunks.push` copy in
`src/commands/structured/jq.ts`, the retained `cache.push` copy in
`src/commands/network/body.ts`, two new canonical byte-ownership test files,
and this new author evidence directory. Foreign staging is present and excluded
from author commits. No production edits before the verifier freeze marker.

Original SHA-256:

- jq.ts: `feca27d38a096931faabe5a5449ecc65c39c8b0abbcf69d3ea73a31f729fdbac`
- body.ts: `29a8a744b043447eacc09d09ca651f2b0a34bdf08e08ddf3065729dbc486edbf`

The 18 new canonical tests exercise producer reuse only at the next read or
finalization, never arbitrary concurrent mutation or mutation after transfer.
Jq program decoding intentionally remains fatal UTF-8. Curl exercises actual
503 status retry with an injected transport, not external HTTP. Raw original
pre-fix results remain alongside candidate results. The independent verifier
owns hidden holdouts, moved-pack runs and original-cohort replay; those fixtures
and the historical packed21/24 and directcurl1/2 evidence remain untouched.
