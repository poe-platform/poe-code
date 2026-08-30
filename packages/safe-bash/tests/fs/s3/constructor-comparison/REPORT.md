# S3 constructor comparison: serialized-SDK usability checkpoint

August 27, 2026. Implements the root-approved additive `compareEntry` constructor
option using the existing `FileSystem.compareEntry` contract and `cd8b5c8` trusted
backing-binding rule. Only S3 source/types/docs and owned backend tests/evidence
are changed. No shared contract, root export, other filesystem, core command,
dependency, package manifest or Dirac-owned trust-review file is edited.

## Public API and exact composition

`S3FileSystemOptions.compareEntry` uses the existing method's Parameters and
ReturnType, with an adapter-local `this: FileSystem` annotation. The callback is
stored privately, leaving the public negotiation method in place. Runtime invalid
non-function options fail EINVAL before provider requests. No authority registry,
new namespace identity, SDK dependency or broad trust flag is introduced.

The actual resolved S3 backend is the receiver; arguments are followed local paths,
the resolved peer backend and unchanged cancellation signal. Complete scoped IDs
retain existing precedence without querying callbacks. For incomplete IDs, a late
public-method override replaces that operand's constructor callback; selected
callbacks run once per operand, with existing reentrancy protection. Errors and
cancellation are propagated before effects, including for known provider aliases.

The initial early-return-on-built-in-same proposal was NOT implemented: it could
hide existing explicit errors. Instead, after selected callbacks succeed, fresh
built-in same is retained. Callback distinct versus that same proof is EIO; callback
same/unknown leaves same. Conflicting selected callback answers and invalid literals
are also EIO. Explicit unknown never silently revives S3's built-in distinct fallback.
Built-in distinct is unselected when a custom callback exists, preserving existing
explicit-override composition. Without a custom callback, built-in inference is
unchanged. Another backend's independently selected authority remains subject to
the shared helper's normal merge/conflict rules; S3 unknown is not a global veto.

Readonly, exclusivity, metadata denial and known-alias protections remain separate
from callback authority. Native copy/rename conditions, conditional fallback/delete,
partial-error handling, nonatomic behavior and ABA/pathname-race limits are unchanged.
Source docs and precise public usage are in `src/fs/s3/SDK_COMPARISON.md`.

## Source-level coverage

`constructor-comparison.test.ts` adds 18 tests covering:

- Serialized Mock HEAD metadata with private markers lost in JSON round trips;
  actual existing-target shell cp AND mv succeed with truthful backing authority.
- Same-store overlapping prefixes/clients resolve as aliases; distinct existing
  files copy correctly; missing/unknown authority refuses before content effects.
- Actual backend receiver, canonical followed paths, resolved peer and exact signal;
  one callback per distinct operand even when both share one function.
- Built-in same versus same/distinct/unknown/denial/invalid/cancellation callbacks;
  no early return hides EACCES or cancellation and contradictory distinct is EIO.
- Explicit unknown suppresses built-in distinct; late overrides replace configured
  callbacks, preserve denial and cannot erase a built-in same proof.
- Two constructor callbacks conflict safely; cancellation stops the next callback;
  readonly, exclusive creation and metadata denial cannot be bypassed.
- Invalid option rejection, public negotiation retained, same operand queried once,
  and recursive callback forwarding returning unknown rather than renegotiating.

The unit fixture may inspect its owned Mock bucket Map to establish actual test
storage ownership. That white-box fixture is NOT the public consumer recipe.
Neither it nor the consumer uses ETag/content equality as entry identity.
Existing tests are not reclassified or edited in this task; the earlier33 late-error
cases, nine faithful decorators and other authority cohorts remain active.

## Isolated built-package public consumer

`consumer.mts` imports only `virtual-bash` public package exports and Node test/assert.
It uses no private Mock fields, private helper imports or module-level authority
registry. The application actually owns the Memory backing used by its SDK-shaped
transport and resolves that backing's real scoped stat tuples. Its WeakMap associates
configured filesystem views with their truthful application paths; it does not mint
client identities. Unknown views remain unknown. Its HEAD values cross JSON
serialization and do not acquire private library provenance. ETag versions serve
only the bounded model's conditional operations, never comparison.

`build-consumer.mjs first` snapshots repository source and the existing package
manifest into an ignored, owned `.isolated/first` tree. It compiles that snapshot
with strict TypeScript and declarations to its own `dist`, then compiles and runs
the consumer through the copied package's PUBLIC export map/self-reference. It
does not read or overwrite shared repository dist, install an SDK, alter the root
package or perform a live remote request. Callback assignability is checked in
both directions against the public FileSystem contract type.

`built-first.json` records build/compile/run exit0 and **6/6 consumer tests**:
cp and mv each with/without authority, overlapping SDK/actual-Memory aliases,
and an unregistered backing relationship remaining unknown. Actual bytes, source
removal only after successful move, sentinels, typed refusal and no comparison
GET/PUT/delete effects are checked. This is a built ESM/export/declaration proof,
not npm publication, live AWS/MinIO qualification or universal SDK interoperability.

The isolated build snapshot is associated with HEAD
`97d04d476a166ff4b277dbe6676ae83f5a4a1ddd` plus recorded worktree sources. It includes
the exact constructor source hashes below. All source contents and emitted file
hashes are recorded; no live inputs changed after the snapshot during this run.
Other workers' source is captured read-only, not silently claimed as a clean HEAD.

## Final scoped results

`final.json` captures HEAD `21d78a4073ce5ab03079985b44888026c45564ec` plus the owned
patch, exact source/test snapshots and raw commands/output. No inputs changed
during these commands. Core `0bee8e7` is included. Results:

| Cohort | Result |
| --- | --- |
| New constructor comparison tests | 18/18 |
| Existing authority/late-error/trusted-forwarding cohort | 82/82 |
| Unchanged original S3 compatibility subset | 16/16 |
| S3 backend total | 288/288 |
| Independent policy86, read-only | 86/86 |
| S3 conformance plus two provenance checks | 50+2 / 52 |
| Strict S3 source/backend-test types | exit0 |
| Isolated public-package build and consumer compile | both exit0 |
| Compiled public consumer | 6/6 |

The 18 and 82 are included in backend288, not disjoint added totals. Every final
test cohort has zero failures, cancellations, skips and TODOs. Original fixture
SHA256 remains `9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734`.
No fresh combined original38 or Dirac independent-acceptance claim is made here.

| S3 source | Previous checkpoint SHA256 | New SHA256 |
| --- | --- | --- |
| authority.ts | `a89587089b0d059d44393e04822ff8f3481faa0aedb8101449d087100f8e30a8` | `1a95f7a28904b8607948673db3e99d3d4a49b2a3839d980143fe13c25e1af344` |
| filesystem.ts | `b34d766829184cf73ff6e8712d0bcb60216c35250234a0b80475f8d91d4f1a9e` | `af2ee439cbabdc3babe008da2601ccc1a031555edc5e082f8711f4512db01411` |

Consumer SHA256:
`1c3a43c9c582380f179e0e4c888bcd238076f37beb33810a95accc40442a2383`.
Historical permission, source-loss, trusted-forwarding and decorator evidence is
unchanged. `SHA256SUMS` seals the new owned artifacts and final source/docs/tests.
Fresh replays use `node tests/fs/s3/constructor-comparison/validate.mjs replay-unique`
and `node tests/fs/s3/constructor-comparison/build-consumer.mjs unique`; existing
captures/build trees cannot be overwritten. All launched processes have exited.

## Remaining limits

The host must supply truthful metadata-only resource authority and forward signals.
Endpoint/client identity, bucket labels, credentials, ETags and content hashes do
not establish disjointness. Providers lacking recognized observation authority or
an application resolver retain unknown existing-target relationships. No automatic
real-SDK discovery, hostile-host sandbox, snapshot atomicity, ABA protection,
universal filesystem overlap support or full product/backend closure is claimed.
