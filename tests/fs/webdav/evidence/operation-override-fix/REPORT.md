# WebDAV original-operation authority correction

August 27, 2026. No earlier production commit existed: the protocol implementation,
provider delta and unsafe constructor snapshots were uncommitted work. This
checkpoint commits only WebDAV source/backend tests and new owned evidence. All
independent tests/oracles/evidence, contracts, core, mount and other FS sources
remain untouched. It supersedes the prior draft's safety characterization without
overwriting its raw captures.

## Reproduced data loss and correction

Exact unchanged independent test:
tests/fs/mount/identity-authority-review/implementation/remote-comparison.test.ts,
"WebDAV pre-construction data-method overrides cannot inherit resource authority
over another backing store". Frozen current fixture SHA256:
039cce5f0fc93b4e2e96a61448ac104e20aa5aaf767db4c33c53263598cb7660.

Fresh baseline reproduced the reviewer finding: comparison distinct; mounted copy
called overridden writeStream; EIO; source became "subclass destination damaged
source". Both subclass views actually delegated to the SAME local Memory file.
Constructor-time snapshots accepted the subclass data methods, incorrectly
inheriting the base remote metadata authority.

Corrected unchanged repro asserts exactly unknown, typed ENOTSUP, no effects and
the unchanged "source sentinel" bytes. No assertion or input weakening. It passes.

Authority now compares every original base prototype method with references
captured once during the WebDAV module's initialization, not from an instance in
its constructor. This covers all40 buffered/streaming, mutation, metadata and
private transport/parser operation methods, plus the base comparison method.
The enrolled transport reference must also remain unchanged. Pre-construction
subclass/base-prototype overrides and post-construction instance/base-prototype
replacements all invalidate inherited protocol/private-store proof. A subclass
with unchanged implementation still works; this is not a class-name whitelist.
Checks run before and after resource queries and again after both operands;
replacing an earlier operand's method during the peer query cannot leave stale
proof. Actual query errors and cancellation still propagate, not unknown.

Explicit external peer comparison authority remains independently queried once;
declining inherited WebDAV authority does not override its legitimate answer.
No helper registry, shared contract, mount behavior or broad trust option changed.
These are point-in-time integrity checks, not a lease or a sandbox against
malicious code that can directly mutate/import private implementation machinery.

## Exact final validation

Final isolated pin319299e7d24be17bed990242d605a4fc37d0d305 includes core0bee8e7
(ancestry asserted by runner). Only owned WebDAV source/backend-test overlay was
applied. Uncommitted qualified-Memory/S3/wrapper edits were excluded.

| Cohort | Exact result |
| --- | --- |
| Unchanged independent destructive repro | baseline0/1; corrected1/1 |
| Independent WebDAV metadata/transport/override selection | 16/16 |
| All owned WebDAV tests | 521/521 |
| Within521: existing backend tests | 324/324 |
| Within521: protocol/transport authority regressions | 33/33 |
| Within521: original-operation binding regressions | 164/164 |
| Selected WebDAV conformance | 52/52 (50 backend + 2 provenance) |
| Strict scoped TypeScript | exit0 |
| Original unchanged WebDAV compatibility selection | 13/15 |

164 binding tests comprise 40 methods times four override timings plus unchanged
subclass, transport replacement, peer-query replacement and explicit peer-authority
controls. Every override matrix case tests both comparison/copy directions,
requires unknown/ENOTSUP, no data requests, exact provider bytes/namespace, and
no private-store descriptor (including invalidating earlier observations where
applicable). These are intentionally conservative even for forwarding overrides;
automatic trust cannot infer what a replacement function will do later.

The independent destructive case is included in the16; do not sum overlapping
cohorts. All final executed tests have zero skips/cancellations/TODOs. Earlier
fixed phase is preserved:519/520 owned passed, with a newly written race test
mistakenly replacing a nonconfigurable property repeatedly during ordinary stat.
That test was corrected to mutate exactly once during the peer resource-ID query;
no product error was hidden. Final operation test explicitly asserts one such
replacement and unknown proof. No full repository/all-FS suite was run.

Original selection remains12/14 required positives plus1/1 alias guard. The two
existing-target Memory-to/from-WebDAV cases still require actual provider-owned
full transport qualification and qualified Memory recognition. Manual opaque
fetch wrappers cannot be automatically blessed, even when forwarding a genuine
MockDav PROPFIND Response. The raw original outputs show exact unchanged bytes
and namespace on both refusals. Original full38/43/53 counts were not rerun and
must not be inferred from this selection. Fixture hash remains
9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734.

## Safe provider/metadata implementation retained

The owned MockDav's explicit resource-ID feature delta remains: original Map
backwards behavior, actual resource records across PUT/MOVE/existing-target COPY,
new identity on creation/new COPY, deletion retirement. Old mock SHA256
f46b18da28ed03b8096dc2b8a10fc0aba768947b9af5ebf0ebae602b289d8ce0 and original
source/raw captures remain in ../resource-authority-5076b32/. New mock SHA256
e4f8a6806c1dd6f0622cce9f3b487f530011c39b7ca95cc2543002ce4da95266.
This is an intentional provider capability delta, not changed independent oracles.

Metadata-only RFC5842 comparison still uses strict Depth0 PROPFIND, full IDs,
requested href/namespace/propstat/error/conflict/cancellation validation and
existing bounds. No content/mutation or arbitrary-host ID fetch occurs. Real
loopback protocol tests remain. Protocol UUID versus local inode is never proof
of disjoint storage. Private mixed-store descriptors additionally require exact
registered whole MockDav.fetch/createFetch mapping, actual Map/resource record,
unchanged provider operations and now ORIGINAL adapter methods/transport.
Response provenance alone never qualifies arbitrary custom fetch routing.

ROOT must approve any intentional independent input delta from manual forwarding
to owned provider factory; this leaf does not change that fixture. Memory owner
must separately validate its actual closed store and this corrected descriptor.
No broad real-provider interoperability, ABA/snapshot guarantee or alias closure.
Safe empty-only remote rmdir remains unsupported; recursive deletion is not an
equivalent fallback. Prior immutable four-stress evidenceebe36d2 remains untouched.

## Source hashes and reproducibility

Bad resource-id.ts: bb1ad5de415ce3f4369aaccef3a3869162bc81a8f6eb66104df4e5c7db452916.
Bad webdav.ts: b03c53d4fd1e5c7da4d665d532dbf25b39e9555dc1cb47890edd2ffd2d9fa51b.
Corrected resource-id.ts: a85c9f8dc58496a0cfa4d65d60e3998a61a79f1f2a889e710bb0bf0d1d5b440f.
Corrected webdav.ts: b207b9949d0f824632362dd4bdab5718c182c021e7bcf4e143dc5c7c18e6c23c.

Each isolated phase preserves pin/argv/status/raw streams and before/after hashes;
all manifests stayed stable. input.patch reconstructs exact changes over each
committed pin. New unowned live changes are not silently included. Original
independent fixture/source/evidence hashes are recorded separately, with the
reviewer's raw observations retained as a copy. No original report overwritten.
Reconstruct each pin with run.mjs's archive paths, apply its input.patch at archive
root, link existing tooling, then run commands.json in a fresh TMPDIR. Run only
the narrow recorded commands, not broader acceptance inferred from their names.
Live outputs and coordination handoff: /tmp/safe-bash-webdav-override-1lISLE and
/tmp/safe-bash-webdav-authority-handoff.txt.
