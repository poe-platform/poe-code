# Hosted Darwin native metadata qualification

## Scope and authority

August 31, 2026. The user authorizes a metadata-only dispatch in the existing
release workflow, separate from the pending native prerequisite implementation,
camera allocation experiment and od changes. Those changes are not in this commit.

The repository is public and Actions-enabled. GitHub documents standard hosted
macos-26 arm64 usage as free for public repositories. No paid capacity, new
self-hosted registration or access to the user's Mac is requested.

## Dispatch and preserved release behavior

Run the existing Release workflow on main with the explicit choice
qualification=darwin-native-metadata. Its single metadata job uses macos-26,
permissions {}, a ten-minute deadline and fixed read-only observations. It has
no checkout, install, secrets, OIDC, cache, artifact upload or publishing step.
The script rejects a repository, ref, event, host or architecture mismatch.

Pushes to main and default/ordinary workflow_dispatch retain the existing release
job, steps, permissions and concurrency. Only the explicit metadata dispatch
selects the separate metadata job. Committing this workflow still triggers the
ordinary push release and schema workflows; their known failures must be reported
as failures, not hidden or described as metadata-job success.

## Evidence and profile policy

Capture the actual source SHA, workflow/run identity, image name/version, macOS
build, kernel, architecture, Node/Xcode/Clang versions, and exact system
diff/patch/bsdtar paths, sizes, modes, hashes and Apple code-signature descriptions
and verification results. Read-only inventory also records available
gtar/gdiff/gpatch/gexpr/gstat/gtouch identities; absence is explicit, not a pass.
Commands and output have finite bounds. Copy complete workflow logs promptly.

The official image reference is actions/runner-images commit
abac76dc78cf571e72be5c0296c061ee7ae594fb. It describes macOS26.5.2/25F84; it does
not prove which image a particular job receives. Historical26.4.1/25E253 tool
pins remain unchanged. All observations are UNREVIEWED_PROFILE, including matches.
A different hash is not evidence that hosted capacity is unavailable.

A separate fixed Darwin profile requires independent official image/Apple
platform provenance and actual unchanged Apple calibration observations, followed
by root review. A first observed hash never authorizes itself. Subsequent jobs
must check the reviewed identity before using it. No historical expected bytes,
GNU exact comparison, native calibration assertion or case inventory changes here.

## Operator procedure and remaining qualification

1. Validate only the workflow and this plan against fresh main, using YAML parsing
   and npm run lint:workflows. Do not add workflow unit tests.
2. Commit these exact two paths and push main with ordinary hooks and HTTPS
   authentication preflight. Preserve all unrelated work and existing identities.
3. Dispatch the explicit metadata choice on trusted main. Monitor that run and the
   automatic release/schema runs to their real conclusions; retain full logs.
4. Record actual metadata without admission. Propose the exact subsequent
   matching-host invocation for the unchanged Apple cases and explicit expr and
   independent-stat obligations. Both eventual native lanes must gate one source
   SHA before release. A successful metadata run is not that qualification.

Known ordinary release blockers at this checkpoint are the unresolved Linux
native prerequisite/host-lane setup and the actual CI camera deadline. This
metadata-only commit does not claim either fixed, a green release or publication.

Official references:
- https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://github.com/actions/runner-images/tree/abac76dc78cf571e72be5c0296c061ee7ae594fb
