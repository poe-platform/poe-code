# Final-route fixed76 release packet — NOT RELEASED

Prepared after root accepted scoped independent review
`97c081ec7c7f180889d3640c29d1cd5fd1b10752`. This packet creates no source archive,
build, package, private-engine copy, native execution or full gate. Prior GO does
not transfer. `ROOT-RECEIPT.template.json` deliberately fails actual
`launcher-v3/admission.mjs:19`; its action is pending and authorization is empty.

## Fixed binding

| Role | Identity |
| --- | --- |
| Product | `f5e9fc49b6abb38e180cc9de16c95fced102ff75` |
| Tree / base | `5687cbdebc46ec6d3618d32072c4de708118b9bb` / `44f00bf84278e3361b52106478d59c707ab7b2bc` |
| Expected full tarball | `c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd` |
| Shipping source / author evidence | `fe15f1e406fa1039accddec25c696ae7187f6135` / `cdf2803ee6d7956556819be484e5b632dc407a0d` |
| Parsed-object driver hash | `25ee4ded79df9c4fe0a9c8031721887dd7c8e22cb56f10d42b3d415eb30c0527` |
| Parsed-object profile hash | `8c9363ea17f6a319acc783b1e7ec2a4d4dc0a00529692b9f2331f60571ab149f` |
| Parsed-object projection hash | `b74e575644c9476b26d96b6863aa2a2078931e73fe3251862d713edd1d7bbefb` |
| Parsed-object tool-routes hash | `b440b32475d24642d0fbe5dc222356ac1f209a11597baa07d63d286b06b68ca9` |
| Parsed-object PACKET.json hash | `7e40e84c099d8eaa2e9bc4c1cc73274b4a174d699737f34b7015eb4eb706ec70` |

Parsed-object hashes mean SHA256 of `JSON.stringify(JSON.parse(bytes))`, not raw
file hashes. `VALIDATION.json` separately records raw packet/template hashes.
`PACKET.json` binds all38 regular shipping files (DRIVER plus37 members), exact
Git blobs, five accepted-review artifacts, full tool identities, native51 assets,
four dependency-tree manifests and the exact six projection records. Review
evidence is byte-bound to97c081ec because admission itself only checks that the
evidence string is nonblank. No new trust is inferred from that string.

The root-approved tool closure includes the direct inspector's exact binary and
two absent-library pairs; original11 plus sandbox2 plus inspector2 are sampled
tool/reference pairs, not15 unique libraries or file hashes. Exact macOS
26.4.1/build25E253 metadata, preopened-FD/TOCTOU and dynamic-image qualifications
remain. Tools/dependencies were freshly checked by the accepted reviewer, not
rehashed by this metadata packet; shipping admission rechecks before launch.
No unknown DeveloperTools, host library or PATH fallback is authorized.

This is76 defaults, not current78 or a combined CD/LET/stack/YQ/XAN composition.
WHICH, later helper373/578, Stage2fd1, timeout and subsequent product work remain
excluded. The new maintained200-entry inventory96ed7733 is also excluded: fixed
f5 retains192 classifications. Historical research files within the f5 input
superset are not promoted as production overlays. HTML74/DU75/expr76 prerequisites
are root-accepted scoped compositions, not new reruns or a global release.

## Required one-run authorization

Minimal proposed root text (not authority until root explicitly issues it):

> Authorize ONE full14-phase fixed76 gate using this packet's committed binding,
> product f5e9fc49b6abb38e180cc9de16c95fced102ff75, shipping source
> fe15f1e406fa1039accddec25c696ae7187f6135, driver25ee4ded79df9c4fe0a9c8031721887dd7c8e22cb56f10d42b3d415eb30c0527,
> profile8c9363ea17f6a319acc783b1e7ec2a4d4dc0a00529692b9f2331f60571ab149f,
> and expected packc109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd.
> Bind accepted review97c081ec7c7f180889d3640c29d1cd5fd1b10752 and all packet
> policies. Preserve failures; no rerun, permission widening, mutable overlay or
> old-GO inheritance. Stop dependent phases on admission/integrity/cleanup failure.

After that authorization only, seal a NEW external receipt at
`/tmp/unified76-release-f5-fe15-finalroutes-20260828-r1.json`. Required action is
`ROOT_RELEASE_UNIFIED76`, exact candidate/driverSha256/profileSha256/packageSha256,
literal true for public74/public75/public76/independentDriverAccepted, and nonblank
actual root authorization plus independently sealed evidence reference. Retain
the packet/review raw hashes in the receipt as additional provenance. Never
promote the template automatically or treat synthetic shape checks as approval.

From `/Users/kjopek/Workspace/safe-bash`, after receipt sealing and approval:

```sh
GIT_PAGER= \
RG_NATIVE_BIN=/private/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-bash-rg-recovered-gsSpuz/rg \
TREE_NATIVE_BIN=/tmp/safe-bash-tree-external-oracle-TbVJVK/tree \
/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node \
tests/integration/full-gate-20260827/unified76-driver/launcher-v3/run.mjs \
--candidate f5e9fc49b6abb38e180cc9de16c95fced102ff75 \
--run /tmp/full-gate-unified76-f5-fe15-finalroutes-20260828-r1 \
--release /tmp/unified76-release-f5-fe15-finalroutes-20260828-r1.json \
--committed-archive
```

This uses shell variable assignments, not an additional unbound env executable.
Only the known blank GIT_PAGER is neutralized; other ambient loader/Git/developer
injection remains a refusal, not an invitation to silently change permissions.
The output path and receipt path were absent at packet preparation. Do not create
the output directory beforehand. Launcher generates physical output under
`/private/tmp`, a fresh `/private/tmp/unified76-os-write-*` work root and an outer
`/private/tmp/unified76-supervisor-*` receipt directory. Actual paths/inodes and
rendered OS fence are bound at setup, not invented in this packet.

## Phase contract, bounds and evidence

Expected ordered statuses are: safejs-availability0, cold-typecheck78,
typecheck-all0, benchmark-types0, env-source-binding0, canonical0,
current-consumers0, pack0, public-runtime0, public-types0, negative-types2,
missing-root1, missing-contracts1, final-sweep0. Negative2/1 and prerequisite78
are narrowly expected for those phases, never generic success for another error.

Pinned Node24.11.1 SHA256 is
`4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0`.
The npm CLI's installation remains22.22.2 but it executes with pinned Node24;
this does not raise the product Node>=22 minimum. Explicit permission fences,
TAP/concurrency2, complete native49+2,632 canonical paths,192 classifications,
256 f5 cleanup inputs and one audited production build reused by typing remain.
Test-owned isolated builds are separately labeled. Private SafeJS is read-only,
with regular-file staging/guards; missing prerequisites cannot produce a
zero-skip green. Full14-phase finite-PATH compatibility is intentionally untested:
the authorized run will discover missing routes without widening permissions.

Bounds:37,397 logical archive entries/2,382,440,321 bytes;3GiB archive transfer,
8GiB opaque history transfer,1GiB per dependency tree,64KiB transport chunks;
setup600s, each phase at most1800s (maintained consumers900s), outer25,805s,
cleanup5s. Output is256MiB per phase/4GiB aggregate,1MiB setup stderr/TAP line,
100,000 TAP cases and8MiB secondary diagnostics. Observer requests cap4096;
that is not a universal process-count/RSS/disk bound. No buffer enlargement.

The exact five candidate instruction entries plus one benchmark entry remain
logical-only metadata: no plaintext instruction files, substitutes or snapshots.
Original authenticated opaque Git objects may retain them inertly, with no
checkout. Ordinary source/dependency bodies remain fully authenticated. Inert
outside symlinks are permitted; resolved protected/outside writes and physical
hardlink/directory imports are denied. Existing private/network/process fences
are unchanged. Never signal unrelated processes or infer cleanup from EPERM.

Retain inner `REPORT.json`, all phase stdout/stderr/receipts, canonical counts and
path coverage, package/load/resolution evidence, private pre/post guards, final
source/artifact inventories and outer receipt. Added/missing/changed entries fail;
post-inventories do not prove absence of every transient identical-byte write.
Zero fail/SKIP/TODO/cancel, all ordered phases, one build, complete bindings and
natural owned cleanup are required for green. Ordinary failures remain recorded;
missing binding, unknown route, guard breach, timeout/output overflow, forced
cleanup, observer error or survivor yields nonzero/HOLD and halts dependent work.
This packet neither rescales old8670/d98b/334 results nor claims superiority.
