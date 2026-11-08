# r8 completion — ready for independent delta review, no window

## Exact candidate and policy

Pre-execution completion commit `8bb8e5830`; PRESEAL SHA256
`f7dd1f0d77217ddf01548272e2fc187ae7b1e5c0593869a8fae6ca44c906a708`.
Current runtime packet: **6945 bytes /32 files**, SHA256
`6df866e7990386218848061128777008bfbd6cdd93a7c0f658559fc0d0aa23f9`.
Its 32 runtime/harness file hashes are byte-identical to the prior r8 packet.
Only packet.mutableCachePolicy.rootDecision records ROOT acceptance. The supported
existing mutableCacheAuthority field is populated with
`ROOT_ACCEPTS_BEST_EFFORT_MUTABLE_CACHE_R8`; no new grant key or runtime API exists.
PENDING-AUTHORITY's packet hash is rebound. ReviewCommit and all dates remain null.

ROOT prospectively accepts128MiB pre-reserved within512MiB logical work for the
declared owned dev-npm cache. Native writes remain best-effort: no source-derived
upper bound, atomic snapshot, peak proof or kernel quota. Observed excess stops;
known post-close full strict reconciliation is mandatory. Immutable/cache-anchor/
non-ENOENT failures remain strict. Controlled other writes stay bounded. Dev npm
does not become a product command. ROOT-POLICY-ACCEPTANCE.md records the decision.

## Two executed follow-up groups

Single DATA helper PID57184 ran 2026-08-29 16:21:19.458–16:21:19.529 UTC,
exit/close0/no signals, empty stderr. **2/2 groups PASS**, no descendant processes.

1. Independent payloads `copy` and `copy.source.json` both create successfully,
   each repeat reports verified-existing-copy, with separate metadata receipts.
2. Same destination with different source bytes or a different source identity
   having identical bytes refuses without overwrite. Equal/nested/ancestor
   metadata roots and a payload aimed at the reserved receipt namespace refuse.
   A tampered destination is refused and its bytes are not overwritten.

Four source paths retain exact device/inode/size/mtime/byte hashes after all
controls. Publication-v2 source was unchanged from its earlier source-only seal:
SHA256 `f8ede5c4890135e0e68020cfc39007bd74f9d39d6402d6a31a6b031df2c9bf5f`.
The helper's final control-root snapshot was708 bytes before adding RESULT.json;
that is not a total campaign/RSS/physical-allocation measurement.

The usable publisher is `publication-v2.mjs`, with explicit five arguments:
source, destination, expected bytes/hash, owned payload root, disjoint owned receipt
root. Both roots must be included by its caller's accounting. For evidence use
separate `evidence-v2/payload` and `evidence-v2/identities` trees. Old
`publication.mjs` and `preserve.mjs` are historical v1 artifacts, NOT the successor
publisher. They remain untouched, including the actual sidecar collision failure.

## Reused scope, not rerun

The earlier eight control groups and two harmless churn fixtures (23 observed
SNAPSHOT_RACEs) remain their original cohort. This completion adds only the two
publication groups. No cache churn/npm/product/Worker/compiler/install/native
execution occurred now. All source309/StageA1012/package1014/672 fixture bytes remain
unchanged; full package SHA256
`2fe071e2bfac5ef5c81dc7e475e059091f6add65cd7411dfcfbf0ce7f51f2eca`.
Original224PASS/448UNRUN, two type roles/eight diagnostics and npm SIGTERM/ENOENT
remain unrescored. V1 publication-failure and earlier source-only history are kept.

Old packet/authority bytes are preserved as PACKET-before-root-policy.json and
AUTHORITY-before-root-policy.json. The older PRESEAL.json at the parent level binds
those old packet bytes; it is not relabeled as the new metadata composition.

## Pending actual authority

No r8 runtime root/capture/grant/window has been created. After independent review
and separately issued binding, the prospective command is:

```sh
/bin/zsh /Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-b2-preflight-20260829/completion-r8/staged/new/launch.sh /private/tmp/B2-R8-ROOT-GO.json 6945
```

Repo cwd/login:false. Existing64knownOS/peak3,41children,34functional async-loader
admissions,1800s anchored1620active+180publication,96MiBcapture/512MiBlogicalwork
remain. No runtime GO, no source-cache upper-bound claim, no full672 acceptance.
