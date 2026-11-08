# Shared Python package environments (#751)

## Reproduction

On main after #752, two separately constructed environments sharing one cache
both successfully commit from the same empty snapshot. A fresh environment sees
only the second writer's requirements. Evidence:
`/tmp/poe-751-current-reproduction.log`.

## Required implementation

- Make a package environment an explicitly borrowed host-owned object for fresh
  shells. Disposing a shell must retire only its own sessions, never the borrowed
  environment, cache or sibling interpreter.
- Separate immutable artifact retention from mutable, tenant-scoped manifests.
  Shared artifact caches must not implicitly import another tenant's requirements.
- Publish shared manifests with opaque revision-based compare-and-set. Reject
  stale publication with a typed retryable conflict; never use read/check/write
  as a substitute for conditional publication.
- Bound built-in retained cache bytes, entries and manifest payloads; retain
  integrity checks, cancellation and observer ownership. Environment disposal
  closes admission, cancels its sessions and awaits admitted cooperative work.
- Preserve the explicit legacy single-writer canonical cache-directory workflow
  without claiming it provides cross-process conditional publication. Shared
  hosts use the new manifest-store protocol instead of that legacy mode.
- Document an ephemeral-shell host with tenant-scoped manifests and a shared
  artifact cache. Managed Cloudflare Python package sets are a different runtime
  integration, not qualified by the trusted Pyodide installer.

## Verification

TDD: manifest CAS and isolation, fresh-shell reuse, sibling disposal, host
disposal during acquisition, cancellation at publication, corrupted/evicted
artifacts and rejected/conflicting upgrades. Run real public Pyodide offline
replay across fresh shells; use a flat key/value manifest/cache fixture that
cannot perform directory operations. Validate maintained types, inventory,
targeted tests, bundle/packed exports and CLI-facing diagnostics if changed.

## Delivery

Implementation is ready for delivery; it is not yet committed or published.
The prior #745/#748/#752 fixes and #753 documentation shipped in scoped version
`0.1.653` after workflow `35247726840` succeeded. The separate CLI publication
remains independently tracked.

## Implemented behavior and evidence

- Borrowed environments, bounded host-owned caches, explicit scoped conditional
  manifest stores, retryable revision conflicts and cooperative disposal are
  implemented. Legacy directory manifests remain explicitly single-writer;
  shared hosts use the separate conditional-store protocol.
- External artifact caches no longer implicitly import mutable manifests.
  Canonical wheel URLs are reread in each invocation filesystem. Scope-key
  encoding preserves otherwise lossy Unicode identities. Late malformed store
  replies cannot override caller cancellation or masquerade as successful commits.
- Red cases include lost updates, implicit tenant leakage, stale revision
  ownership, unavailable shared-cache APIs, canonical wheel aliasing, invalid
  store replies, cancellation precedence, scope aliasing and missing diagnostics.
  Logs are `/tmp/poe-751-*-red.log` and the initial reproduction record above.
- 196 focused Python/export tests pass, including eight independent ownership
  stress tests. The maintained inventory passes 110 tests; the SDK wiring suite
  passes seven tests. Source/test types and all 26 current public consumer groups
  pass. Guarded ESLint completes with zero errors and two unrelated warnings.
  Evidence: `/tmp/poe-751-verified-unit.log`,
  `/tmp/poe-751-verified-inventory.log`, `/tmp/poe-751-sdk.log`,
  `/tmp/poe-751-final-types.log` and `/tmp/poe-751-eslint.log`.
- The selected workspace closure, root bundling and standalone packaging pass.
  A fresh `0.1.655-issue751` candidate installation passes the real public
  Pyodide test for offline fresh-shell reuse, reconstructed environments, tenant
  and interpreter isolation, simultaneous commit conflict/retry, rejected upgrade
  recovery and awaited worker retirement. Its package stores cannot create
  directories, and no package download occurs. Existing public Node startup,
  memory/quota binary I/O and pipeline checks also pass (three additional tests).
  Evidence: `/tmp/poe-751-final-public-environment.log` and
  `/tmp/poe-751-final-public-package.log`.
- The updated workerd fixture passes using the same installed artifact, without
  Node compatibility or network access; its browser bundle is 1,567,015 bytes.
  This validates host package-state handling and unsupported-executor diagnostics,
  not managed Cloudflare Python execution. Evidence: `/tmp/poe-751-workerd.log`.
- The offline-cache-miss CLI screenshot was inspected; it reports a fixed asset
  error without printing host loader/transport details. Screenshot command/output
  are recorded in `/tmp/poe-751-screenshot.log`.
- The maintained HTTPS provisioning fixture was migrated to explicit shared
  manifests and host-only diagnostics. Its full network-download suite was not
  rerun; the fresh public offline test and targeted unit tests are the current
  qualification for this change, not a full-repository test claim.
