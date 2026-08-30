# Provider namespace review proposal — August 27, 2026

Status: the root approved a narrower implementation rule after this proposal:
fresh provider-owned observations may pass through faithful opaque forwarders;
remove extra client/fetch/factory method-reference eligibility, retaining fresh
query provenance and filesystem/path/stat binding. Exact approved semantics are
in `src/contracts/filesystem.md`. Poincare implements, Dirac independently reviews.
The generic binding helper and staging alternatives below remain **unapproved
future proposals**, not additional requirements for this narrow source change.
Original31/38 remains required; qualified38/38 is additional
evidence only. The source owner retains every FS implementation. Curie proposes
no new identity token, host-code sandbox, global trust flag or blanket overwrite.

## Actual seven unresolved configurations

Frozen source b02bbe8, evidence committed1f9efe3:
`tests/fs/mount/identity-compatibility-review/evidence/final-checkpoint-b02bbe8/REPORT.md`.

| Existing-target operation | Refusal boundary |
| --- | --- |
| S3 one-mount copy | Mount copyFile unknown identity |
| S3 separate-client copy | Mount copyFile unknown identity |
| S3 separate-client cross-mount mv | Core distinctness preflight |
| Memory → S3 copy | Mount copyFile unknown identity |
| S3 → Memory copy | Mount copyFile unknown identity |
| Memory → WebDAV copy | Mount copyFile unknown identity |
| WebDAV → Memory copy | Mount copyFile unknown identity |

Six copies return typed ENOTSUP; move returns1. All preserve original source,
old target, sentinels and namespaces. Existing qualified factories close those
cases only with changed input construction. No source-effect success is inferred
from safe refusal, and no old fixture/result is relabeled as passed.

## Trust boundary

Injected host JavaScript is trusted to implement its advertised filesystem or
transport semantics. The library cannot sandbox a callback that itself mutates
arbitrary host/virtual data. HEAD/stat, GET/read, PUT/write, COPY/rename and DELETE
must consistently refer to the same configured resource namespace. A callback
that describes one store but writes another violates that semantic contract;
method-reference recognition is not a general security proof.

This does **not** imply disjointness. A faithful WebDAV server may expose a Real
backend's same inode. Two endpoints, credentials, prefixes, clients or wrappers
may alias one resource. Two independent memory stores can also be deliberately
exposed through another protocol. These are legitimate configurations, not
malicious callbacks. Metadata provenance and namespace consistency alone cannot
resolve such overlap. No automatic per-client token may stand for disjoint stores.

## Minimal routing proposal

Keep the existing `compareEntry` signature and same/distinct/unknown answers.
No new public identity fields are necessary for this decision.

1. First use existing complete scoped identities or actual provider-owned
   comparison authority. Preserve known aliases, wrappers, source symlink guards,
   permission errors and cancellation. Conflicts remain errors before effects.
2. Allow a host integration to supply a **specific namespace mapping** through
   the existing comparison callback. The proposed ergonomic addition is a small
   host-side adapter helper, not a boolean: it binds actual participating stores
   to canonical resource locators, including shared storage and root/prefix
   transforms. Same storage + same canonical locator answers same; a genuinely
   distinct resource/store answers distinct; outside the mapping answers unknown.
   The helper must be described as trusted configuration, not verified identity,
   and must not generate a fresh namespace per adapter/client automatically.
3. A transparent forwarder should preserve that binding without private method
   reference equality being the sole admission rule. The host owns the promise
   that all its operations retain that mapping. A decorator that changes routing
   must supply a new accurate mapping or return unknown. Known provider factories
   can expose this ergonomically without asking every caller to write pairwise
   callbacks; exact helper shape is for joint review, not an approved API here.
4. For unknown existing targets, do not silently infer distinctness. Investigate
   protected copying as an alternative to refusal: complete a bounded/spooled
   independent source snapshot **before** destructive destination publication.
   Publication must preserve the old target on failure (atomic replacement or a
   genuine conditional complete-object operation), and handle already-known same
   entries as errors before staging. A mere temporary filename plus recursive
   delete/rename is not a transaction, nor is an arbitrary writeStream atomic.
   Where those prerequisites are absent, ENOTSUP remains honest until the provider
   supplies a binding or safe publication primitive. Do not add fake temp VFS
   effects solely to match an oracle.
5. Unknown-alias **moves cannot reuse copy permission as deletion authority**.
   Publishing a staged copy then deleting an unresolved alias can delete the
   destination. Require same/distinct authority for the actual source/target
   mapping before removal; preserve source on pre-publication failures. Keep
   non-atomic move/partial publication and conditional-delete limits explicit.

The proposed default is faithful transport semantics, existing known identity
first, then explicitly bound namespace authority or genuinely protected copy;
it is **not** class/protocol-based disjointness. Opaque callbacks alone cannot
prove a relationship that the host has not described. The remaining decision is
which shipped providers can supply safe publication and which cross-view setups
must receive a shared namespace binding. This is an actual usability constraint,
not closure of the seven required workflows.

## Required independent acceptance before source changes

- Replay all original38 positives and rejection controls unchanged; report any
  revised configuration cohort separately and explain why its declarations are
  required. No default38/38 claim from the qualified mocks.
- Include faithful opaque forwarding controls, separate clients sharing one
  service, overlapping prefixes/mounts, and Real↔WebDAV aliases of one backing
  entry. Require exact source/target bytes and relevant metadata/namespace effects.
- Verify inaccurate/mixed routing is a documented host contract violation without
  claiming protection from arbitrary host JavaScript. Retain historical guard
  observations; do not erase them or claim earlier failures were fixes.
- If staging is chosen, inject read failure, publication failure, cancellation,
  changed destination and quota exhaustion; verify no source removal and no
  destructive publication before source capture. Account for scratch ownership,
  cleanup, bounded buffers and backpressure; do not assume provider atomicity.
- Keep point-in-time identity distinct from leases, same-content ABA protection,
  provider authentication and pathname-race guarantees. Exact operation guarantees
  must come from the provider contract and tests, not naming or object shape.

Root requested facts before accepting a qualification policy. This proposal
records the limits and routing choices for that review; it approves none itself.
