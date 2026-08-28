# YQ allocation-order repair author handoff

Route this packet to Sagan for different-agent review.  Public YQ integration
remains held; this is a private module repair candidate, not author acceptance.

## Exact bindings

- Independent review: `4b219eae180fcd2fd15ea864c9bc5226c54cda04`.
- Final contract freeze / verification: `bd471ef682d768692a682d40009a874f51e3ad68` / `de89e478d8ddce62eac955708f1b87d7be1bd137`.
- Pre-patch control freeze: `500e1ab6d5b52df098bfaf427c05fe3bb9b48424`.
- Repair source candidate: `b8f5d60d75452e1dd181167fb87abd995221f6e3`.
- Actual-parser WRK-13 control: `e889e5236ec5666977697bb758dce510d689efe3`.
- Final reconstruction driver: `03dd10ec4901a4356df5bfcf5b24bd9ae125d371`.
- Immutable evidence v1 / final v2: `32f4b0ca786e97fa1258fb13ac7a44a0917e77e7` / `644460b932feb6fa87222b7042d705da1219cf0c`.
- Reconstruction base: `5137a74ec855a32d8a8860eb66b62eb44d11e290`.
- Accepted length revision: `74361026502d76b8c2b696f9c60e410ac9b78d95`.
- Accepted interpreter blob / SHA-256: `d3ba11f0057b07d5ad307c5dfbb5f0612a87a047` / `e32ad45efe69544ed95b43b97f191006f10d3beea9ca9e2a3327843dffd45a74`.
- Original authored fixture / handoff / evidence: `1d802e7af02add9e334ab934668d41d6e5ffbbe2` / `bcec1ead34aee37c8fe574b248a8242ad4f60cfa` / `ef6032b210feb5cf19e6f6f94c40413740bef335`.

The archive is baseline 5137 + the exact accepted interpreter + exactly the
seven authorized YQ/query source paths.  It is not raw HEAD, a 35da parent
tree, LET/CD/timeout/XAN work, or default/public integration.

## Four repaired source contradictions

| Finding | Repair | Candidate Git blob | Source SHA-256 |
| --- | --- | --- | --- |
| WRK-06 | `yq/index.ts` frames and admits raw bytes, including CRLF/CR/BOM/comments/markers, before retained chunk copies and decodes each admitted frame; `accounting.ts` owns the raw-document admission; `parser.ts` consumes the admitted raw count without normalization shrinkage. | index `eb93b148ba25b95dc2e467f03e44c6c3e7159011`; accounting `e12c88906f219d82750071e2a01e5baa3f0b982e`; parser `24593a910b88199d4f68fd12ed18c61b1b7d2e6d` | index `212673fa3599fa3a0ead59e781197989cb224939ea19e068a9d8c98c3ab24baf`; accounting `63c68a7c7a7c54fa37276ffbb168faeafeca0ab5b217157557171b689e070509`; parser `c743319c37aa879a351a3c2caa7f68c3376969ea5fb50a3980635281ced6d008` |
| WRK-07 | `yq/parser.ts` projects exact UTF-8 bytes for double, single, plain and block scalars, admits them, then constructs normalized/decoded scalar strings. | `24593a910b88199d4f68fd12ed18c61b1b7d2e6d` | `c743319c37aa879a351a3c2caa7f68c3376969ea5fb50a3980635281ced6d008` |
| WRK-13 | `yq/parser.ts` admits the prospective flow/block sequence or mapping member before parsing its key/value/child; insertion retains duplicate/key checks and the inclusive 100,000 cap. | `24593a910b88199d4f68fd12ed18c61b1b7d2e6d` | `c743319c37aa879a351a3c2caa7f68c3376969ea5fb50a3980635281ced6d008` |
| WRK-17 | `yq/encoder.ts` and `structured/query-core.ts` project exact YAML/JSON escaped fragment bytes, reserve the fragment, then construct and retain it without double charging. | encoder `20be87d55d7a93004ba0f68665d6320746eb1928`; query core `fc0e889802b40ad49225ce944521aae9942cce09` | encoder `9e013ee8aadc590ea8aca8e94fb03079eb820b00a76fd05b9fd85ebb4223303f`; query core `d0582961172c95ce39a4bd999e1c8ee7446761786ecfc374b7d54cfd22f49241` |

No limit field, public API, shared Budget, CARRY checkpoint, alias accounting,
query evaluation count, diagnostic identity, sink ordering, default registry,
root export, or accepted interpreter was relaxed or replaced.

## Validation and qualifications

- Final repair controls: 9/9.  Four structural controls bind the changed
  functions and reversed-order mutants; WRK-13 also observes actual parser
  ledger events for flow/block sequences and mappings.
- Public fixed-cap controls: WRK-06 rejects an 8,388,609-byte CRLF document
  before normalization; WRK-07 accepts exactly 1,048,576 decoded scalar bytes
  and rejects 1,048,577.  The raw C+1 fixture is not an at-C success proof,
  because its synthetic comment body reaches the independent fixed work cap.
- WRK-17 runs the actual YAML and JSON fragment encoders with small internal
  `maxBytes` arguments.  Those cases are proof controls, not claims about a
  lowered public boundary.  No RSS, native-oracle, or exploit claim is made.
- Original author parser/query/encoder suite: 26/26.
- Separately selected parent jq join-safety suite: 19/19.
- Build, original scoped types, repair strict types, offline install, installed
  strict consumer, physical-move runtime/types, actual Shell plugin execution,
  wrong-source negative, and wrong-module-hash negative all passed their
  expected statuses.  Eighteen capture roles are recorded separately.

Final `evidence-v2` contains a 273-entry, 2,727,936-byte source archive with
SHA-256 `fe76de08017859b066ecb8830846e109cdab6fa3953b0317e5fc6f27777fd878`
and a complete 870-entry, 786,778-byte package with SHA-256
`1d06350cdef1a5f6c7d70c7d55a19b63537037bd97b2de5a5d8b8b8f722229ca`.
Both are byte-identical across the immutable v1 and v2 reconstructions; the
source driver also makes a second archive in each run.  The package contains
README and package metadata and has zero runtime dependencies.

Built artifact identities:

- `dist/commands/yq/index.js`: 26,827 bytes, SHA-256 `bc2638a9f9b7b0ab9dc164915e73993e2554fc4246779f077086ec1e496b0054`.
- `dist/commands/yq/index.d.ts`: 419 bytes, SHA-256 `2d37623cb7dceb666e2e705f0cf5b32f11a24c8d766ac021e53951b65cf6f98e`.
- `dist/commands/structured/query-core.js`: 23,200 bytes, SHA-256 `63b447194c3ba3eed8fb9b65eeb09a82aa7a86a071b7052a28b333938529e3e5`.
- `dist/commands/structured/query-core.d.ts`: 1,307 bytes, SHA-256 `1f316b2cc3856e4254c62f3a616b0f03b49249c8f77e4cec6cacea19d8bc949e`.

## Preserved failed review history

The original 35da/B04/author-review failures and all independent raw evidence
remain immutable.  Review 4b ran 149 original jobs plus 17 moved jobs, then the
sealed total-admission deadline stopped the remaining moved/loaded/type
controls.  Its aggregate verdict remains FAIL: 31 unfulfilled-obligation
failures plus the CMD-22 harness path-domain mismatch.  That review established
no additional runtime product bug, and this repair does not reclassify those 31
obligations as product bugs.  CMD-22 is deliberately unchanged and remains
routed to its harness owner.  No XAN source, workload, import, retry, or reroute
was used.

Root should now route the exact candidate and final evidence v2 to Sagan for a
different acceptance decision.  YQ stays absent from public/default integration
until that review explicitly accepts it.
