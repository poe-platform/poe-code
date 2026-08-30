# Bounded comparison-helper checkpoint

Initial internal API: `745eaa62eebbe07b7fd30dccad4a73a1669f7124`.
Follow-up source: `e8d308a11bf562efcfba1d8a861503883b4952a3`.
The approved contract remains `5076b32`; no new contract or guarded-copy flag.
Exact internal API and invariants are in `src/fs/mount/COMPARISON.md`.

## Fix and bounded validation

The paused observation fixes are preserved: terminal views use `realpath` plus
`lstat`, rather than silently replacing incomplete observed lstat identity with
different stat fields. Four pre-effect observation regressions now pass without
changing their oracles.

Opaque forwarding of a negotiating comparison method now returns unknown before
nested metadata or authority queries. This does not unwrap or certify the opaque
provider. Actual invalid/conflicting answers still fail EIO; cancellation retains
its exact reason. A focused regression asserts the complete metadata/query order
and verifies zero registered-authority calls through unrecognized forwarders.

| Cohort | Result |
| --- | --- |
| Immutable original4 + required49 | 53/53, included unchanged below |
| Focused frozen53 + helper18 + identity-scope9 | 80/80 pass |
| Scoped five-backend source/test noEmit | Exit 0 |
| Existing isolated source mutants | 6/6 detected; production hashes unchanged |
| Unchanged original S3 filter before fix | 12/15; opaque alias error plus two mixed-memory positives failed |
| Same exact S3 filter after fix | 13/15; opaque alias and byte guards pass, two mixed-memory positives remain red |

The original compatibility fixture SHA-256 remains
`9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734`.
No independent test, original53 oracle or existing immutable evidence was edited.
The S3 runs used concurrently edited remote sources, not a frozen qualified remote
delivery. Their before/after observations do not certify provider security.

The first complete-owned run is preserved as 665/677: four observation-guard
failures subsequently fixed, plus eight WebDAV Map-representation assertions.
Those eight fixture assertions belong to the WebDAV leaf and were not edited.
The intermediate shared-conformance 202/202 result is also preserved separately;
neither is presented as a final all-owned/integration pass. Two mutation-harness
anchor failures are retained: added guard sites made the old text anchors
ambiguous. Unique contextual anchors now run all six existing mutants without
weakening any semantic test.

## Open provider qualification

No Memory-vs-Mock callback or remote-source patch is included. Memory/real source
remains unchanged from `4fa4ba9`. A genuine HEAD/PROPFIND response proves neither
the complete transport operation mapping nor that subsequent GET/PUT accesses
that backing store. Custom transports can mix genuine metadata with local-alias
content operations. Metadata-only witnesses must not authorize mixed-store
distinctness unless the remote owner binds the full operation mapping.

The two mixed-memory existing-target cases remain mandatory red, not waived.
Secure provider qualification or an intentional input-factory change must go to
root; a new qualified fixture cannot close the unchanged manual/opaque-provider
acceptance input by relabeling it. No fake protocol, class, client or token
disjointness was introduced. Remote integration43 and full final validation await
qualified remote commits. Provider authentication, leases, ABA and pathname-race
guarantees are not claimed. All own bounded validation processes exited.

`manifest.json` records source, fixture and raw-artifact hashes and exact commands.
Remote hashes are explicitly post-run observations, not invented frozen provenance.
Raw TAP assertion diffs retain their original whitespace, including trailing
spaces; formatting those captures would change the recorded evidence hashes.
