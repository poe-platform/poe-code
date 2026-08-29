# F0/F6 Published-Package Identity and Smoke

## Preparation checkpoint: not final approval

Independent delegated reviewer, August 29, 2026. Preparation is complete;
package execution remains blocked on root's exact-version authorization and
Kuhn's immutable release receipt. Kuhn alone watches the release. This worker
does not poll GitHub, npm, release status, or dist-tags.

The clean owned clone is
`/Users/kjopek/Workspace/poe-code-safejs-final-package-review`.
Clone and immediate `git pull --ff-only` finish on main at
`93dda91e9d0d7078e7940ba51bf73a81ed7aec49`, with clean initial status.
Workspace and repository instructions are read. This is source identity only,
not evidence that an artifact from this commit has been published.

Root reports publisher-verified `11.0.31` at
`c2be4cc64ba9cc00aa70b886a2edc532e48d8617` and the arity source commit above
as release-pending. These are attributed intake facts, not independently
refreshed registry observations. Version `11.0.31` is not final approval.
No next version is predicted or selected.

No package download, installation, build, test, public import, CLI execution,
or dependency/tool setup occurs during preparation. Only the authorized Git
clone/pull, instructions, source/config metadata, tracked plans, and prior
immutable manifest identities are inspected. No source, README, original audit
archive, private bundle, live home, other clone, or release is modified.

## Required root authorization

Before any artifact operation, require a specific immutable npm version and
the exact release receipt path plus SHA-256. Record its expected npm `gitHead`,
the approved source commit, and any supplied registry integrity/tarball values.
An absent or mismatching identity is a stop, not permission to substitute
`latest`, infer a version, build from this clone, or silently choose another
commit. Source commit and package `gitHead` remain separately recorded fields.

After authorization, make one bounded metadata intake for the named version
and one retained tarball acquisition. There is no watch or retry loop. If root
supplies retained publisher metadata/tarball, independently hash those bytes
and record their provenance before deciding whether any additional acquisition
is necessary. Do not perform redundant package fetches for the other reviewers.

## F0 identity and shared artifact

Preserve raw version-specific registry metadata and the release receipt before
normalizing any fields. For the exact downloaded gzip bytes, record:

- Package name, immutable version, expected and observed npm `gitHead`.
- Tarball location from that version's metadata and acquisition receipt.
- Byte length and SHA-256 of the complete compressed tarball.
- Computed SHA-512 SRI compared with published `dist.integrity`, including the
  actual algorithm if the metadata uses another supported SRI algorithm.
- SHA-1 compared with `dist.shasum` when supplied; absence remains explicit.
- SHA-256 and byte count of `package/package.json`, its name/version, complete
  `exports` and `bin` maps, and any embedded `gitHead` or its explicit absence.

Inventory the archive's published executable/type artifacts without executing
or rewriting them. Record normalized archive path, member kind, file mode,
bytes, and SHA-256; record link targets separately. Include the declared public
entry files, CLI wrappers, and every shipped chunk under `dist` and package
`dist` directories, not only filenames matching a guessed chunk convention.
Retain the inventory as a deterministic path-sorted JSON file and hash its
exact bytes. Do not equate source-file hashes with bundled-file hashes.

The installed package must match the retained archive for every inventoried
regular file. Record actual public export resolution and CLI executable paths
inside the owned installation; check that no repository/self-reference or
different global installation supplies the tested modules. Public imports use
the unmodified package's normal export map. Runtime identity checks include
the existing shared `run`/core assertion; no private registry access, export
injection, forged metadata, loader rewrite, or rebuilt bundle is permitted.

Freeze an artifact-only manifest before consumer execution. Its identity fields
are unavailable during preparation, never placeholder success claims. F1-F5
can pin that manifest SHA-256 plus the retained tarball SHA-256/SRI and reuse
the same immutable bytes. They must not share a mutable installation or fetch
another copy of the root package. Their own projections record the same
artifact identity and their dependency-lock/environment identities. Artifact
pinning alone does not prove identical transitive dependency installations.

The later F6 result manifest references the frozen F0 manifest instead of
mutating it to append test results. Validation receipts are not publication
source files or permission to publish anything automatically.

## Minimal isolated installation after authorization

Use one owned installation project, a clone-local npm cache/config/prefix, and
a short clone-root temporary directory such as `.t`. Set HOME and all XDG
locations to directories under the owned review clone. Construct an explicit
credential-free environment instead of inheriting the interactive shell.
Record absolute paths and the existing Node/npm versions at execution time.
Keep `TERM`, `NODE_OPTIONS`, `NODE_PATH`, and `SKIP_SYNC_SKILLS` unset for the
package smoke; keep lifecycle scripts enabled and avoid any shell login setup.

After inspecting the exact package's lifecycle metadata, install the retained
tarball into that project with normal npm lifecycle semantics. Use clone-local
`npm_config_cache`, `npm_config_userconfig`, and `npm_config_prefix`; do not
install repository development dependencies or globally into the user's
prefix. Disable npm audit/fund chatter, not lifecycle or smoke checks. Any
unexpected lifecycle requirement outside the owned directories stops the run.
Do not use skill synchronization or copy configuration from the real home.

Place the project's `node_modules/.bin` first on the controlled PATH and resolve
the actual installed CLI path before execution. This exercises ordinary package
bins without a user-global installation. Execute the SDK payloads with that
project as their resolution context. Record the generated installation lock
and dependency tree, install output, environment, and archive-versus-installed
hash comparison. Do not rebuild, repack, or patch the installed artifact.

## F6 actual released-package smoke

The pinned source contract is `scripts/smoke-test.ts`, SHA-256
`59f263851f8745cc64fda503c634a4310203efcbd94d266188f2e492ec79cf32`.
It is byte-identical to the independently reviewed earlier smoke repair.
Recheck the contract against the authorized release's source identity if that
identity differs from this preparation commit.

Do not run the repository's `npm run smoke` as the final artifact test: its
installer calls `npm pack` on local source. Instead, execute this Markdown
procedure against the retained, installed registry tarball. Preserve the exact
19 command strings, original 30-second per-command limits, finite dry-run/mock
semantics, and three generated public SDK/credentials/config payloads from the
pinned source. Materialize only the original smoke payloads in the owned
temporary project, with their decoded bytes and source pointers recorded;
do not create a standalone executable QA runner or change any assertion.

Capture command, cwd, environment identity, status, signal, stdout, and stderr
for every command and payload. Require all 22 checks, including the SDK and
later credentials/config imports. Preserve the SDK's values
`[14,1,2e+100]`, one host read, fresh `jobs-v7`, shared public entrypoints,
checkpoint/migration behavior, and its existing finite host/MCP/env controls.
The workflow prompt preview stays a preview; no provider/LLM request, guest
I/O expansion, workflow unit test, or security probe is introduced.

All failures stay in the result capsule. A smoke success establishes this
bounded public SDK/CLI gate on the authorized package after TOJSON and arity;
it does not replace the separate F1-F5 semantic reviews or prove a universal
behavioral guarantee. Root combines the independently pinned results before
deciding final readiness. No source fix or oracle weakening belongs here.

## Preserved earlier evidence

The original independent 19-CLI-pass/SDK-RED capsule remains unchanged at
`/Users/kjopek/Workspace/poe-code-safejs-ppr2-ci-smoke-review/out/safejs-ppr2-ci-smoke-independent/baseline-red/manifest.json`,
SHA-256 `774d6b1f6548cc1b35c620a5eaa321d1badc5ca68d895b1979c04e7a34674be2`.

The earlier independent packed 22-check GREEN remains unchanged at
`/Users/kjopek/Workspace/poe-code-safejs-ppr2-ci-smoke-review/out/safejs-ppr2-ci-smoke-independent/handoff/manifest.json`,
SHA-256 `8c5dd24e66b4d3d5b2749841b8c184da92e7626c0bd8e16e27694414b9734513`.

Those two manifest hashes are rechecked during preparation. Their tests are
historical pre-final results, not rerun or relabelled final-package evidence.
The old failed release, temporary-directory failure, formatting RED, genuine
v6 fixtures, and subsequent bounded repair evidence remain preserved.

## Ownership and stop point

Only this new Markdown plan and validation-only preparation metadata are
authored. The plan's preimage at the pinned source commit is absent. No source
change, new package test, executable QA file, README edit, commit, push, or
publication is proposed. Formatting/test tools are not installed or run during
this no-execution preparation phase. Later applicable gates remain pending.

Checkpoint: **PREPARATION READY; F0/F6 FINAL HOLD pending exact-version root
authorization and immutable release receipt.** No registry version, tarball
hash, package identity, or final smoke result is claimed yet.

## Authorized execution checkpoint: F0 artifact READY, F6 not started

Root subsequently authorizes exactly `poe-code@11.0.32`. The publisher receipt
at `poe-code-safejs-publish/out/safejs-remediation/releases/host-callback-arity/result.json`
is verified before network acquisition against SHA-256
`09d0da2070df019a5427fffc493dfe1fe6cddd5a8eec43c4b47639162bfecbbf`.
Its recorded completion is August 29, 2026 at `18:04:25.716Z`. Receipt-recorded
Release `33266722584` and Pages `33266722577` succeed. No release is polled.

One exact-version registry metadata request and one root tarball acquisition
independently confirm version `11.0.32` and npm `gitHead`
`93dda91e9d0d7078e7940ba51bf73a81ed7aec49`. The retained compressed tarball is
15,857,902 bytes with SHA-256
`94aca9a7f6fa9c79e64ac29f88580c4378d285743a7dcb6203a4803d87738ac2`.
Computed SHA-512 SRI exactly equals both authorization and registry metadata:
`sha512-oufK4GzaniPYTedVJxajUeAk8WBqS5z1UhHd0leRYcpzNbA5Ap3Z7CkzpcN4IeREUsp4ZlJDx2d8KpMUA1qyjA==`.
Computed SHA-1 also matches the registry shasum. The tarball package.json has
the correct name/version and no embedded `gitHead`; that absence is recorded,
not filled with a fabricated field. Registry `gitHead` is the provenance field.

All 3,348 archive members are regular files and have exact path, mode, size,
and SHA-256 inventory entries. The published-dist inventory contains 3,318
files, including every shipped chunk, declaration, source map, and asset under
the declared dist directories. All 25 export/bin target declarations resolve
to inventoried members. No guessed chunk naming pattern limits that inventory.

The actual retained tarball installs successfully into the owned project using
normal lifecycle hooks, Node `v22.22.2`, and npm `10.9.7`. The install log records
183 added packages and the ordinary dependency/root postinstall commands.
The package's unchanged skill postinstall naturally finds no shipped sync
script; no skip flag or actual-home synchronization is used. HOME, XDG paths,
npm cache/config/prefix, and short TMPDIR are clone-owned.

All 3,348 installed package files match the archive bytes. npm changes modes
from `0644` to `0755` for three declared CLI targets; these ordinary bin-mode
changes are explicitly retained, not called byte or runtime-code changes.
Node resolves all ten public export specifiers into this installed package,
and all five public bin paths point to its declared targets. Resolution does
not import or execute the SDK; no CLI command or smoke payload has run yet.

A separate 15-file functional source archive preserves exact committed
source/config bytes, including the current TOJSON `host-call.ts`, arity
`host-bridge.ts`, public entry source, smoke contract, and package lock. Its
scope is explicit, not a full repository snapshot. Full source identity is
commit `93dda91e9d0d7078e7940ba51bf73a81ed7aec49`, tree
`41267c29f07207269fca6cfa89629a622f9270f2`. No source-to-bundle reproducible-build
claim is made; no local pack, build, runtime patch, or private import occurs.

The immutable F0 handoff is
`out/safejs-final-published-package/artifact/manifest.json` in this review clone.
F1-F5 should pin its SHA-256 and reuse
`package/poe-code-11.0.32.tgz` from that capsule, not refetch the root package.
Public-entry, all-dist, all-member, and bounded source identities are separate
indexed artifacts. The installation lock and dependency tree are retained;
other validators use their own installations, not this mutable project.

This checkpoint supersedes the preparation authorization hold only. Historical
19-RED/22-GREEN evidence and the preparation capsule remain unchanged. **F0
artifact identity is READY; F6 and final combined runtime approval remain
pending.** Per root's priority boundary, stop here and await the separate F6
resume rather than hiding the shared identity behind a long smoke run.

## Subsequent F6 completion

Root later authorizes F6 execution. All 22 actual released-package checks pass
without rebuilding, repacking, changing assertions, or extending deadlines.
The standalone result and qualifications are recorded in
`docs/plans/safejs-final-f6-released-package-smoke.md` and the separate immutable
`out/safejs-final-published-package/smoke/manifest.json`. The original F0 capsule
is not amended; its identity-only checkpoint remains the consumer pin.
