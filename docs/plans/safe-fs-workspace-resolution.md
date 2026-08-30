# Private safe-fs workspace resolution

## Scope

The candidate contains only three package metadata changes and documentation:
the private `./core` export, a source-local package scope for
`#safe-fs-platform`, and inclusion of that JSON scope in TypeScript emission.
No runtime implementation, SafeJS facade, codec, dependency version, lockfile,
or unreleased language source is part of this change. Public consumers continue
to use the root `poe-code/safe-fs` distribution.

## Current-main reproduction — August 30, 2026

Baseline: `e0883bef8948a1e0cfeb9c10c50612b86c5723eb`.
The unchanged private package builds, but an ordinary native Node 18.18.2
workspace import fails with `ERR_UNKNOWN_FILE_EXTENSION` for
`src/platform/node.ts`. No loader or consumer source alias is involved.

Adding only `./core` does not fix resolution. A browser-conditioned bundle
includes both source and emitted error modules: the actual missing-entropy
`ENOTSUP` error fails canonical `FsError` recognition. An emitted-only consumer
also fails strict DOM NodeNext and Bundler type checking because the private
platform declaration cannot resolve without source files.

With all three metadata changes, the normal package build and ordinary root,
contracts and core imports pass on Node 18.18.2, 22.22.2 and 24.14.0. Memory
roundtrips and ENOENT identity checks pass across those routes. The same
browser-conditioned graph has one error module, no source inputs, and preserves
the original ENOTSUP instance without a filesystem write. This graph probe
executes in an isolated JavaScript VM, not a browser engine. Emitted-only DOM
NodeNext and Bundler consumers pass with strict checking, no Node ambient types,
no source aliases and active negative controls.

## Candidate qualification — August 30, 2026

The initial retained dependency trees each mismatched 14 baseline lock records.
A separate APFS-COW dependency view was reconciled with normal npm install and
SRI validation: all 479 applicable root records and two nested compiler records
match the exact baseline lock and resolve inside the candidate. The 465 already
matching packages retain their bytes; the protected donor tree is unchanged.
Two optional bundled records remain absent as in ordinary workspace installation;
their applicable workspace dependencies resolve inside the candidate. Npm's
unrelated lock normalization was archived and removed from the candidate, leaving
the original root lock byte-identical. No dependency upgrade or language source
is included in the five-path patch.

The candidate preserves the documentation-only main advance to
`c5a0c532a73653462f3826f050f4087d0c44f991`. All 68 workspace builds, ESLint,
production types, package-lint, workflow lint and signature verification pass.
The full root suite passes 27,641 tests with the 41 unchanged skips. The normal
smoke script passes with an explicitly isolated global prefix, HOME and cache.

The actual public tarball excludes both private `src/package.json` and emitted
`dist/package.json`; its root-selected platform declaration mapping is not
shadowed. Public runtime, adapter and CLI probes pass on Node 18.18.2, 18.20.8,
20.20.0, 22.22.2 and 24.14.0. Emitted-only Node/browser type profiles and browser
negative boundaries pass. Chromium, Firefox and WebKit each pass 17 public FS
checks in both page and worker contexts, totaling 102 checks. This is FS-only
coverage, not browser SafeJS execution or WebDAV streaming transport coverage.
The separate dependency advisory audit reports one high advisory; this patch
does not change dependency versions or claim a vulnerability-free tree.

## Publication remains pending

Before release, refresh and preserve current main and run ordinary commit and
push hooks. Commit only the five selected
metadata/documentation paths, push normally, monitor every release job and
verify the published registry gitHead and artifact. Do not infer public
packaging or browser-engine compatibility from the private workspace probe.
