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
disabled and no lifecycle hooks in the product manifest. Keep executable, dependency, source, fixture, namespace and artifact
hashes, actual compiler resolution, and raw outcomes. Do not vendor dependencies
or tarballs into this directory.

Primary documentation consulted on 2026-08-27 via web.run: npm CLI pack/install
and configuration docs; TypeScript Modules Reference (NodeNext, exports/types);
Node module customization hooks. npm offline and ignore-scripts are separate
controls; effective network-denial must also be demonstrated. Strict consumer
compilation must use package declaration exports without paths/source fallback.

## Preparation control discovery

The initial non-product lifecycle canary failed its setup expectation: npm
10.9.7 `pack --offline --ignore-scripts` executed `prepare`, wrote the private
sentinel, and exited 91. This is an npm setup finding, not a virtual-bash bug or
product test failure. The original result is retained. Official npm CLI tag
v10.9.7's `node_modules/pacote/lib/dir.js` calls prepare without testing the
ignoreScripts option; this primary source was inspected via web.run.

Before any product execution, the runner was tightened to reject all product
pack/install lifecycle hooks without changing the product manifest. A refined
independent control reproduces the prepare bypass, proves prepack/postpack
and preinstall/install/postinstall suppression with prepare absent, and records
ENOTCACHED for an uncached offline lookup. Network denial remains an OS policy,
not just npm configuration. The control intentionally ran only a private
prepare sentinel; no install lifecycle ran, and no product code ran.

`freeze.initial.json` preserves the initial full harness freeze. The amended
`freeze.json` records this helper-only guard correction before first execution;
all nine input/expected fixtures and 27 runtime checks are unchanged.

## Reproduction

After root creates the exact closed-author commit gate, run from the repository:

```sh
node tests/integration/stream-inspection-public/verify.mjs FULL_COMMIT_SHA /tmp/safe-bash-stream-public-independent.UNIQUE/attempt-1
```

The destination must not exist. The runner uses already installed TypeScript,
Node declarations and undici declarations as copied isolated development tools,
not package runtime dependencies. It never emits into repository dist. Each
attempt retains its own logs, exact snapshot, tarball, consumer and manifests.
The macOS sandbox-exec network policy is a prerequisite; this is not a portable
Linux network-isolation claim. Frozen runtime has 27 checks and strict typing
has one positive consumer plus four independently checked TS2322 controls.

Historical 84/85/manual-dash conflict, separate native semantic 85/85, strict
68/85 with 17 diagnostic differences remain separate. This work does not rerun,
modify or supersede those cohorts and makes no general parity/superiority claim.
