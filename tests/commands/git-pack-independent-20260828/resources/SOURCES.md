# Primary sources and review boundaries

Inspected 2026-08-28 through read-only web/source retrieval. No native Git version probe, Node version probe, codec invocation or remote executable was run. References are source/API observations, not proof about a future packed helper. No external implementation source is vendored.

| ID | Primary location | Bounded fact used |
| --- | --- | --- |
| N1 | https://nodejs.org/download/release/v22.14.0/docs/api/zlib.html — bytesWritten, Options, close, threadpool sections | Engine-input API description; maxOutputLength applies to convenience methods; asynchronous zlib uses the threadpool. The author used this same documented Node22 baseline. |
| N2 | https://raw.githubusercontent.com/nodejs/node/v22.22.2/lib/zlib.js — processChunkSync/processCallback, ZlibBase.close/_destroy, _close | Source-level consumed-input deltas update bytesWritten; output backpressure may delay another engine write; destruction notification is not itself a completed pending-write receipt. These private internals are research only, not APIs to import/use. |
| N3 | https://raw.githubusercontent.com/nodejs/node/v22.22.2/src/node_zlib.cc — CompressionStream.Close and AfterThreadPoolWork | Close can defer while work is in progress; after-work completion handles the pending close. This motivates a future public-wrapper barrier proof, not private-handle access. |
| G1 | https://git-scm.com/docs/gitformat-pack — Deltified representation | REF deltas can refer outside a transported thin pack; on-disk packs should be self-contained to avoid cycles. The proposed same-pack-only rule is preserved, not broadened by a global body cache. Detailed format compatibility is the other reviewer's scope. |
| G2 | https://git-scm.com/docs/gitrepository-layout — objects/pack and objects/info | Repository layout identifies storage and auxiliary paths; it does not authorize this project's exact inert allowlist or imply that ignored files are byte-verified. |
| G3 | https://git-scm.com/docs/multi-pack-index — Design Details/File layout | MIDX chooses one representation for an OID; individual idx files remain usable without MIDX. Incremental MIDX layouts differ and are not covered by the proposed singleton allowance. |

Node22 API documentation is not an exact patch-level engine-behavior test. Source retrieval exposed option details not claimed as a portable Node22 API here; the design must not rely on newer or undocumented options. The actual future tool binary/source binding and split-input/abort/close behavior require their own authorized evidence. Browser-rendered source is not a proof that the local Node binary was built from the displayed source.

Local author documents, exact commits and byte/mode/hash bindings are in INPUTS.json. M1A resource seam reads were limited to limits, Session accounting/read/observation, codec ownership/consumption, repository object/cache/census and the relevant counter-call locations. They support integration requirements only; no M1A correctness verdict, test rerun or competing implementation patch is issued.
