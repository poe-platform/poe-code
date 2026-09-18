# wkhtmltopdf qualification receipt — 2026-09-18

**Rendering compatibility is unqualified.** No HTML/PDF engine is supplied by
the candidate. No pinned native binary/Qt patch profile or independent browser
was configured for this run. There are no candidate corpus PDFs, inspected PDF
screenshots, structural inspector results or link-geometry measurements.

Candidate HEAD: `052940a62255aa620236474575b4003a2df76549`, with existing dirty
implementation and wiring. This is not a clean-commit receipt. Leaf production
source digest: `1f7627bea8ada0f728f016ef01521d2fed666b5c16684c2c1cbc4f9a272573ec`.
Digest algorithm: SHA256 over sorted `src/*.ts` excluding `*.test.ts`, each
encoded as UTF-8 filename, NUL, raw file bytes, NUL. This pins the leaf source
only; it does not authenticate the shared contracts or installed artifact.
Runtime: Node `v22.22.2`, npm `10.9.7`, local macOS workspace. Native source pin
remains `024b2b2bb459dd904d15b911d04c6df4ff2c9031`; source findings are not
patched-Qt execution evidence.

## Executed checks

| Check | Result | Evidence boundary |
| --- | --- | --- |
| `npm test --workspace=safe-bash-command-wkhtmltopdf` | Pass, 84 tests; 0 failed/cancelled/skipped | Memory VFS and mocked capabilities only |
| `npm run lint --workspace=safe-bash-command-wkhtmltopdf` | Pass | ESLint, production and test TypeScript checks |
| `npm run build:workspaces -- --workspace=safe-bash-command-wkhtmltopdf` | Pass | Maintained closure: safe-fs, contracts, command |
| Compiled ESM SDK default conversion probe | Expected rejection | Exit 1, `UNSUPPORTED_CAPABILITY`; stdout 0 bytes, stderr 97 bytes; no inputs acquired or outputs published |
| Pinned native, browser, font profiles | Unverified | No admitted executable or font-byte pins |
| Corpus visual/structure/link geometry | Incomplete | No renderer output; no screenshots inspected |
| Installed safe-bash package JS/declaration closure | Unverified in this run | Existing export/build wiring inspected; leaf build alone is insufficient |
| Browser/workerd consumer cells; original/checkpoint/replay | Unverified | No executions in these environments |
| Full repository test/lint/build | Not run | Only qualification tests and corpus/docs added; no shared implementation repair |
| Performance | Not measured | Unit duration is not a performance or fidelity claim |

The compiled probe's exact stderr is UTF-8:
`wkhtmltopdf: UNSUPPORTED_CAPABILITY: A qualified first-party static renderer binding is required`
followed by LF. An initial ad hoc probe had a JavaScript brace typo and failed
before importing product code; the corrected probe produced the receipt above.
There were no failing maintained gates or product repairs in this run. An embedded
PNG control initially had an invalid IDAT CRC; it was replaced with an authored
1×1 RGB red PNG with valid chunk CRCs before pinning the corpus.

New independent integration controls exercise both command and SDK routes for
success/error-code pairs `(true,404)`, `(false,404)`, `(true,401)`, `(false,401)`,
`(true,500)`, `(true,1003)`, `(false,0)`: statuses `2,2,3,3,1,1,1`, respectively.
All preserve prior destination bytes, emit no stdout, never consume failed PDF
chunks and close the mocked renderer once. These are source-derived status and
product publication controls, not native PDF observations. A missing-renderer
negative control refuses input acquisition with no fallback authority. Existing
tests cover parsing, realms, budgets, alias refusal and cancellation/cleanup.

## Saved exact fixture set

Fixtures are authored controls, not upstream expected outputs. All are UTF-8
with LF endings, static HTML and explicit Arial CSS. Fonts are not bundled or
qualified. `missing.png` is absent by design; negative-authority URLs are denied
test targets. Header/footer files are auxiliary inputs, not standalone body
compatibility cells. Execute the [manual procedure](../plans/compatibility-wkhtmltopdf.md)
only after admitting the missing controls.

| File | Bytes | SHA256 |
| --- | ---: | --- |
| footer.html | 283 | cd38813d3716258d9c1fc06ca375fbdde75d18e6b8d29d283aaed7b723079b59 |
| furniture.html | 371 | ea2c13eba4d2f4a2d7d957ee5739707138889e52f3d0703549b79997b09dd3c6 |
| header.html | 294 | 58f84b5be40cd8de6bc82849fd41c3e8a6702f27c25e7eaab854ebb7610c595b |
| images.html | 456 | 212191baebdaeaee6b2826d6fc8907171d2b994624aa0e9516c74334ac319ea7 |
| links.html | 542 | acd45475076da0a72305f214469a26baf820e136cc06c175c274acd6127e6b42 |
| long-table.html | 7753 | 34917158f44dc8fbd70656f82294ee2a10c8b3a579c9d893fd4399a4a17157c6 |
| negative-authority.html | 431 | edff925a59e57f14d53fa4c58e1497e3edb189a71d1cbe46c43bb481c68100c2 |
| outline-toc.html | 352 | 677b5384114711dece679229410ec93525605928cf9e9e52a2c052fa68a4eeec |
| page-breaks.html | 488 | 0d5212cec763e717de187edd1033a734263d8ac49278a57f5e4b247630ec0b50 |
| typography.html | 510 | fcb199aa67edce4bd9868bb9ed8c8d7a478aecefc53005d485cdc0bfa3fc2dc8 |

No publication, commit, push, remote-main verification or release was performed.
The command package remains private with no declared external runtime
dependencies. Qualification additions preserve all existing edits.
