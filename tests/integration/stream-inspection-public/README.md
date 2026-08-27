# Independent packed public/default verifier

Owned only by the DIFFERENT LEAF INDEPENDENT PUBLIC/DEFAULT VERIFIER.

Preparation began 2026-08-27T05:17Z at repository HEAD
`488cc2398a55326dd6efee809b71d7b9bf4edf4b` before public/default integration.
Read-only exposure before semantic fixture freeze: package.json, tsconfigs,
root exports, existing public Shell/ByteIO/FS/registry contracts and plugin
composition; stream-inspection index and the first 65 lines of shared.ts to
obtain existing options. This also exposed constructor/default limit logic;
it did not expose tac/expand/fold/strings implementations or any author tests.
An existing unrelated S3 public packaging verifier was inspected for conventions.

`cases.json` is synthetic, authored independently, and is not copied from
historical native/author/fixer corpora. Nine data cases plus ten additional
categories are intentionally bounded. Long bytes use an independent fixed-width
split formula. No native oracle is needed for these inputs.

Final execution requires root's `/tmp/safe-bash-stream-public-review.ready`
containing an actual closed author commit. No mutable checkout/dist run is final.
Build and pack an exact Git snapshot in a uniquely owned temporary directory;
install the tarball into a different clean consumer using offline npm with scripts
disabled. Keep executable, dependency, source, fixture, namespace and artifact
hashes, actual compiler resolution, and raw outcomes. Do not vendor dependencies
or tarballs into this directory.

Primary documentation consulted on 2026-08-27 via web.run: npm CLI pack/install
and configuration docs; TypeScript Modules Reference (NodeNext, exports/types);
Node module customization hooks. npm offline and ignore-scripts are separate
controls; effective network-denial must also be demonstrated. Strict consumer
compilation must use package declaration exports without paths/source fallback.

Historical 84/85/manual-dash conflict, separate native semantic 85/85, strict
68/85 with 17 diagnostic differences remain separate. This work does not rerun,
modify or supersede those cohorts and makes no general parity/superiority claim.
