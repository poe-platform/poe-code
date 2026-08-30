# Identity contract decision required — Curie handoff

Status: **OPEN, not completion.** This is a durable contract request, not an
approved API or a fix. The shared interface inspected at this handoff has only
unscoped optional `FileStat.dev`/`ino`. It has no approved cross-instance identity
seam. The literal historical request is preserved, byte-for-byte, in
`original/exact-contract-request.txt`; its signature is a **proposal**:

```ts
readonly identityScope?: object | symbol;
```

Only Curie may change the shared contracts. This leaf owns the five local
backends/wrappers and their tests, not contracts, commands, root docs or remote
source. S3/WebDAV have a separate owner. The historical Curie agent ID was
previously unavailable; no valid replacement messaging ID has been supplied.
The parent must route this handoff and the shared `/tmp` reply to Curie. Do not
repeatedly wait on the invalid historical ID.

## Blocking semantic contradiction: explicit ruling required

The exact archived proposal says **different scopes guarantee disjoint identity
universes**. The user has also identified the contradictory earlier interpretation
that **different scopes are unknown, not proof of disjointness**. They cannot both
govern the same unqualified token comparison. Neither is adopted here by inference.

| Observation | Required owner decision |
| --- | --- |
| Same complete scope/dev/ino tuple | May consumers reject as the same live entry? |
| Same scope, different valid coordinates | Does this prove distinct entries at observation time? |
| Unequal scope tokens | Does inequality prove disjoint storage, or only unknown comparability? |
| Missing scope or invalid/missing coordinates | What precisely is unknown, and when may consumers return ENOTSUP? |

Under the archived **disjoint-universes interpretation**, scope allocation must
never merely identify an adapter/client instance. All overlapping native roots
and adapter instances must share a truthful namespace; overlapping arbitrary
provider clients must negotiate the same namespace or omit the claim. Independent
private memory stores can truthfully provide disjoint identities. A fabricated
per-client token for overlapping storage would be a contract violation and unsafe.

Under the **unequal-means-unknown interpretation**, comparing two private memory
scope tokens alone cannot authorize their ordinary cross-mount overwrite. Curie
must specify how consumers obtain an explicit proof of disjointness that retains
the required independent-memory/synthetic-collision controls. Do not silently
reinterpret unknown as disjoint or blanket-disable legitimate supported copies.
No extra proof field, helper or capability is invented by this handoff.

Please commit the exact typed seam and normative comparison/unknown rules, and
provide the contract commit hash. Consumers will follow that text rather than
the provisional field name or an inferred dev/ino namespace. The `/tmp` request
does not itself approve either comparison policy.

## Implementation requirements after the ruling

- A process-shared native identity namespace must span real adapter instances,
  roots, hardlinks and symlinks without leaking host root paths. Private memory
  stores must retain independent identity scopes without synthetic collisions.
- Readonly, mount and overlay metadata snapshots must preserve the identity of
  the actual backing entry, including prototype/nonenumerable contract fields.
  Overlay copy-up must report the newly selected backing entry, not stale lower
  identity. No constructor-name checks, unsafe casts or private root inspection.
- Mount rejects proven aliases before data reads, opening/truncating a target,
  delegating destructive copy, or publication. Overlay rejects proven aliases
  before reading/staging/copy-up/publication. Keep exact public errors and bytes.
- Unknown existing-target copies fail closed only as the approved contract
  authorizes. Missing targets retain exclusive creation against alias races.
  Supported disjoint copies and the synthetic dev/ino collision control stay
  supported; buffering is not a substitute for same-file protection.
- Identity is point-in-time, not an atomic namespace lease, descriptor-relative
  path operation, ETag incarnation identity, ABA protection, or rollback. Existing
  native pathname TOCTOU and arbitrary-provider limitations must remain explicit.
- Remote backends must not invent per-client disjointness. Report any required
  remote participation to their owner; do not edit S3/WebDAV concurrently.

## Immutable failure evidence and exact denominators

`handoff-manifest.json` gives this inspection's HEAD and filesystem/contracts
source SHA-256 inventory, plus hashes/origins of every copied original artifact.
The earlier source hashes and results remain separate from the current inspection.
No original report or expectation is rewritten to green.

- The original committed reproduction remains unchanged: **1 pass, 3 fail / 4**.
  Each real same-path/hardlink/symlink cross-mount case loses its 15-byte source
  sentinel to truncation. The disjoint synthetic-coordinate collision control
  passes. Original raw output, committed test and source manifest are included.
- The prior additional required guard cohort is **11 pass, 38 fail / 49**:
  42 mount guards (36 fail) and seven overlay guards (two fail). Its exact raw
  output and source/command manifest are included. These failures are requirements,
  not accepted behavior or successful defect characterizations.
- The prior **533/574** full owned checkpoint is preserved in its original
  manifest: 521/521 other tests, the original 1/4, and the added 11/49. Those
  41 failures are three original source-loss bugs plus 38 new required guards,
  not 41 regressions caused by later rmdir work.
- Safe directory-only removal and its static-lower correction are separate.
  `50f517d` did not repair identity. No new rmdir change belongs in this repair.

When the approved seam is available, run the original four cases, all 49 required
guards, complete five-owned suites, unchanged shared conformance and strict
scoped noEmit. Commit explicit owned source/test paths atomically after focused
validation. The independent source-read-only reviewer must replay a frozen fixed
revision and source mutations before independent acceptance is claimed.
