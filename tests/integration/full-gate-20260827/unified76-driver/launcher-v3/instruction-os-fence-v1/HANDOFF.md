# OS instruction-write fence — author review packet

2026-08-28. **Original author packet; later scoped acceptance is qualified below.
No full-gate release.** Historical results in this packet are unchanged.

## Fixed inputs and source

- Shipping primitive: `4e60fbeb`; integrated launcher/outer observer:
  `86038b27d1bee03333f13560e374ad407db417b8`.
- Additional native/dispatch/admission controls:
  `65bb898d17af8e674842e060ddd7ea61f91ff5bc`.
- Normalized `DRIVER.json` SHA256:
  `a99c9f24b9edee16ef959139b48905e943ee108080c0aa39511965103f32f26a`.
- Product remains `f5e9fc49b6abb38e180cc9de16c95fced102ff75`;
  expected package remains
  `c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`.
  This pass did **not** run npm pack or a package/runtime consumer phase.
- Product profile `8c9363ea17f6a319acc783b1e7ec2a4d4dc0a00529692b9f2331f60571ab149f`
  and exact-six projection
  `b74e575644c9476b26d96b6863aa2a2078931e73fe3251862d713edd1d7bbefb`
  are unchanged. No current78/timeout/CD/XAN/length source was overlaid.

## Mechanism and trust boundary

`os-instruction-fence.mjs` admits only pinned macOS26.4.1/25E253 arm64,
the authenticated sandbox-exec binary and the two specifically approved
ENOENT system-library references. These references are not file hashes or
full OS attestation. Original eleven system-reference pairs stay unchanged.

The trusted launcher creates a fresh mode0700 write root and the exact fresh
output root. The inherited OS profile denies writes/linking outside these
roots, and instruction-basename writes/linking inside them. `/dev/null`
data writes remain permitted. Literal POSIX backslashes are not separators.
Output/root identity, case/path handling and profile bytes are bound in the
per-run envelope; no preexisting directory or link alias is admitted as a fresh
initial root. This does not prohibit runtime inert outside symlink references:
they are allowed, while resolved writes through those references are denied.
Outside hardlinks and physical-directory rename/import remain denied.

Every target worker and phase is launched through sandbox-exec. Nested Node,
shell, git and tar targets cannot remove this guard by clearing their env or
preload. Default full entry remains explicit `--run`; imports remain inert;
the changed driver hash invalidates the former release receipt.

`fenced-supervisor.mjs` retains trusted **outer** observation. Worker setup Git
children use existing PID/group/birth-bound observation IPC. Phase requests
are ordered, bounded, restricted to the pinned Node executable, owned cwd,
exact output paths and owned HOME/TMP directories. Each phase is a sibling
group launched under the **same OS profile**, not an unfenced proxy. Existing
Node permission/source-loader arguments are retained; invalid request options
are refused. The observer never imports candidate code, accepts no foreign
PID registrations and signals only owned groups through existing supervision.

The launcher passes no writable regular-file descriptor. Its outputs and IPC
are pipes/sockets. A deliberately inherited writable ordinary-file descriptor
**does** bypass pathname acquisition controls (C21); the restriction depends
on not passing such descriptors. This is not a content-aware data-copy guard,
universal hostile-host-JavaScript sandbox or outbound-network firewall.

## Actual results, not an additive score

`evidence-v1/REPORT.json` maps all30 presealed groups to scoped witnesses.
It does not call them30 fresh independent passes or suppress auxiliary failures.

- Unchanged mechanism: original14/15 and current14/15. The same inside-`ps`
  assumption fails. `PS-DIAGNOSTIC.json` shows trusted outer `ps` succeeds,
  whereas both allow-default sandbox and shipping sandbox attempts return
  `spawnSync /bin/ps EPERM`. This does not identify an underlying kernel rule;
  no process privilege was added to the target.
- Outer protocol:6/6, then7/7, then9/9. Actual owned-abandonment and non-loopback
  listener controls correctly yield **non-clean target receipts**, reaped
  children and an intact foreign-process witness. They are not clean gate runs.
- Supplement: final6/6 records, including empty-env descendants, ordinary Git/tar
  positives, zero-byte instruction-member extraction refusal, envelope negatives,
  inherited-FD limitation, permissions and output channels. Original generated
  JS quote failure and wrong nested-sandbox exit assumption remain captured.
  The nested sandbox fails at apply with exact71; its target did not execute.
- Additional native control proves two distinct shell PIDs, six denial routes
  and ordinary native hard-link success. Eight admission cases include one
  positive and seven before-target refusals, with a target marker. Simulated
  platform diagnostics are not execution on Linux/x64.
- Fourteen unchanged projection-control groups pass, including actual duplicate
  tiny-compiler build rejection and prior observer controls. Two ordinary-name
  neighbors show APFS case folding and denial of its surrogate alias; they do
  not establish exhaustive Unicode equivalence.

## One actual production build/type slice

The only production slice in this successor ran:

```sh
env -u GIT_PAGER /Users/kjopek/.nvm/versions/node/v24.11.1/bin/node \
  tests/integration/full-gate-20260827/unified76-driver/launcher-v3/review-build-types.mjs \
  --candidate f5e9fc49b6abb38e180cc9de16c95fced102ff75 \
  --review-build-types /tmp/unified76-build-types-review-os86038b27-20260828
```

Result: **REVIEW_ONLY_BUILD_TYPES_PASS**. Cold prerequisite exit78, actual
typecheck-all exit0, **one production compiler invocation**,23 current consumer
groups,832 emitted files, exact declaration reuse, zero runtime-consumer
executions. Both phase targets carry the OS-fence receipt and settle naturally
without signals/survivors. Outer worker/observer receipts are clean.

The original37397 entries/2382440321 bytes were authenticated;37392 physical
candidate files exclude exactly five instruction bodies. The benchmark
dependency projection separately omits its one approved instruction body.
Source/extra-entry guards and final cleanup checks pass. An Xcode git shim
reports a denied cache write outside the owned universe; it does not fail the
typing group and no allowance was added. `/usr/bin/git` remains in the existing
authenticated tool list.

Compressed original reports and their raw/compressed hashes are in
`evidence-v1/RAW-INDEX.json`. Compression streamed the large reports; no source
tree, archive or instruction body was copied into evidence. Private SafeJS
checkout was not modified or executed by this slice. Native identities are
bindings, not native-semantic acceptance.

## Required next step

Different Dirac review of this source/packet and a **new root release** remain
mandatory before any full gate. Fourteen full-gate phases, zero-skip policy,
historical failures, exact-six metadata projection and opaque authenticated Git
provenance policy remain. This packet neither resumes nor rescales an older gate.

## Later scoped review and remaining executable-route hold

Root accepted independent `38a4e7b08f47139328f3a4ac5b4b50d83a6544b3` for five
resolved-write safety phases plus actual A10/real duplicate-build denial, not a
complete release binding. Runtime inert outside symlink creation is allowed;
required resolved writes through aliases/chains/renamed links are denied. The
historical tar refusal left216 ordinary neighbors extracted, without rollback.
Preopened-FD limitations and prior creation-proxy2pass/1fail remain unchanged.

The independent trace exposed unbound pre-execution `xcodebuild` and unresolved
`otool-classic` provenance. `../tool-routes-v1/PROPOSAL.md` records read-only
diagnosis, exact proposed direct routes and a narrow new tool/reference approval
request. Current shipping driver/profile bytes have not been rebound; no full
gate is authorized by either the scoped review or this qualification.

## Later approved route implementation — author evidence only

Root subsequently approved the exact direct inspector and its two absent
system-reference pairs, plus finite routing to the already admitted Git/core.
Source `fe15f1e406fa1039accddec25c696ae7187f6135` retains this resolved-write
profile and adds pre-execution tool bindings/selector denials. Evidence
`cdf2803e` and `../tool-routes-v1/HANDOFF-v2.md` record final author12/12, the
separate intermediate-source outer9 controls, and preserved5/12 and11/12
attempts. Exactly36 receipt-bound temporary roots were removed without signals;
the raw evidence remains. No new build/A10/package/full gate ran. Different
Dirac review and fresh root release remain required; earlier unbound trace
observations are not retrospectively authenticated.
