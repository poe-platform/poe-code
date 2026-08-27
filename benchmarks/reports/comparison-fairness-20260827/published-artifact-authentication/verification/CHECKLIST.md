# Published baseline: independent verification preparation

Status: **PREPARED, NOT FINAL AUTHENTICATION OR RERUN APPROVAL.** No author handoff/root resume has been consumed. No product, dependency, native, network, performance or224 execution/import. Scripts use Node builtins and only their own helper; no installs, subprocesses, package resolution/imports, extraction, archive vendoring or source changes.

## Authentication sequence

1. Bind author final handoff, exact raw pinned registry response, HTTP capture, actual compressed tarball and package extraction by explicit path/hash. Preserve response body, URL, status, retrieval time, headers/redirect/error history; a rewritten metadata subset is insufficient. Record isolated HOME/cache and no install/lifecycle scripts. Tarball/extracted package stay in an identified `/tmp/safe-bash-baseline-auth-*` tree, never committed.
2. Compute SHA512 SRI and SHA1 shasum over **compressed downloaded tar bytes**, independently of author totals. Compare both to the raw official pinned3.4.2 metadata, plus SHA256 for local custody. Record exact requested/final URL; redirects need separate review rather than silently accepting an arbitrary host. This proves consistency with the captured official publication, not independent publisher-signature verification or a future latest tag.
3. Parse the archive offline with checksum, framing, bounded expansion, canonical `package/` paths, duplicate/case/Unicode collision checks and regular-file/directory-only rules. Reject links, specials, file-as-parent, traversal, dangling metadata and unsupported extensions. The helper implements a conservative authentication profile, not universal tar/PAX semantics. No extraction is performed by this verifier. Verify the author's extraction has independent regular files, no aliases/hardlinks, and an exact complete content map matching the tar.
4. Compare **every package file**, not just package.json/version/bundle. Retain complete published/extracted/frozen maps, missing/extra/changed paths, modes and package.json field differences. npm-generated bookkeeping is an explanation to investigate by exact path, not an automatic wildcard waiver. Any difference stops a blanket full-package identity statement. An identical entry alone is weaker than identical package bytes; no replacement, normalization or deletion of installed files is authorized here.
5. Bind the existing c2902a6-plus-dirty/untracked source SHA76deb591783ac168ca5daef04c4351d7e80b159c003cd27d3a445190ca6fd74c and frozen-files SHAa133f8cf113866657155396038293ff54fbb8767cf92c96372804ab775bafdc9. Compare the actual frozen package to its seal, and published package to that actual tree. Preserve read-only mode normalization as a separately recorded mode distinction. The script rehashes its inputs and rewalks both package trees before returning.
6. Verify isolated lock version/resolved/SRI against primary metadata, separately from full installed dependency-tree identity. A lock graph says what was pinned; file maps say which installed bytes were frozen. Downloading just-bash authenticates neither all transitive/optional dependencies nor private runtime bytes. No dependency-wide supply-chain claim, registry-signature claim or lifecycle-script provenance claim.

## Rerun preflight: route before execution

- Root must authorize exact representative recipe IDs, scripts/input/golden hashes, profile, both engines/order, exec counts and initialization/startup/control budgets. Explicitly disable automatic224, performance, warmups, transport, inventory or neutrality loops unless separately budgeted. No rerun is authorized by package matching or this checklist alone.
- Preserve original222/224 and aligned223/224 versus baseline155/224. A selected rerun is a separate identity/control witness, not replacement scores, independent unique coverage, an additive denominator or a new current-product freeze. Same source and exact historical recipe/profile code must be bound; new orchestration remains explicit and hash-reviewed.
- Authenticate **the bytes actually used**: canonical absolute entry URL/path, actual on-disk entry hash joined to the published tar map, frozen root and package map before/after, exact worker argv/cwd/env, and awaited import/startup/result evidence. Version output or `require.resolve` alone does not prove use. Resolve/load instrumentation must state whether it records attempts, returned loads or awaited entry imports. No universal evaluation/CJS/WASM/syscall claim.
- Inspect measured-path constructor options and command registration code, not just installed package contents. No `customCommands`, custom stub/prelude, alias/function replacement, patched dispatch table, shadowing registry, source overlay, alternate `NODE_PATH`, uncontrolled `NODE_OPTIONS` or loader remapping. Any observer wrapper must call the exact captured original implementation and preserve args/return/async effects. Actual selected handler dispatch and raw outcomes distinguish unshadowed execution from mere inventory/module presence. Do not introduce automatic extra neutrality calls without budget.
- Match baseline entry used by the new runner to `dist/bundle/index.js` from the authenticated package and existing accepted frozen entry hash70dd1320d921b736e965b1545e50ab57af2b2807a26de7fa624d4f519a953b7c. Original worker code imports that absolute bundle after checking version, and its instrumentation forwards `definition.execute(...args)`; the new runner must be reviewed independently, not inherit approval merely by name.
- Preserve byte API differences: terminal invalid-UTF8 output is not internal pipe/file corruption. Compare literal raw stdout/stderr/status/VFS observations; no expected-output regeneration from the rerun. Retain all failed/missing/timed-out calls and exact lifecycle status.
- Capture known managed children, awaited calls/entry handshake and shutdown, loopback binding/close if a network recipe is explicitly authorized, outer deadline/census, leaks/escalation/residual. Routine session SIGTERM is distinct from guest retention; a real leak fails. Do not invent missing historical telemetry or rerun to repair it without authorization.

## Prepared script interface

After completed handoff and explicit root resume, create a reviewed input JSON via apply_patch (not provided as READY now):

```json
{
  "schema": 1,
  "status": "ROOT_AUTHORIZED_OFFLINE_REVIEW",
  "rootAuthorization": "Exact later root authorization text, not this preparation",
  "authorHandoff": {"path": "/tmp/safe-bash-baseline-auth-author-detail.txt", "sha256": "REVIEWED_HASH"},
  "metadata": {"path": "AUTHOR_RAW_METADATA_PATH", "sha256": "REVIEWED_HASH", "url": "https://registry.npmjs.org/just-bash/3.4.2"},
  "tarball": {"path": "/tmp/safe-bash-baseline-auth-ID/just-bash-3.4.2.tgz", "sha256": "REVIEWED_HASH", "url": "https://registry.npmjs.org/just-bash/-/just-bash-3.4.2.tgz"},
  "httpEvidence": {"path": "AUTHOR_OR_REVIEWED_HTTP_MAPPING_PATH", "sha256": "REVIEWED_HASH"},
  "extractedPackageRoot": "/tmp/safe-bash-baseline-auth-ID/extracted/package",
  "frozenProductRoot": "/private/tmp/safe-bash-comparison-replay-20260827-EuLV2d/product",
  "sourceManifest": {"path": "benchmarks/reports/current-integration/comparison-replay-20260827/source-manifest.json", "sha256": "REVIEWED_HASH"},
  "frozenManifest": {"path": "benchmarks/reports/current-integration/comparison-replay-20260827/frozen-files.json", "sha256": "REVIEWED_HASH"}
}
```

`httpEvidence.responses` expects one successful metadata and tarball row each with `role`, `status`, `requestedUrl`, `finalUrl`, `bodySha256`, `receivedAt`. This is a proposed offline adapter shape, not a demand to overwrite author capture formats. If mapping is needed, retain raw source hashes and exact selected fields in a new owned mapping; never rewrite author records. Failures/retries/redirects remain additional historical evidence and require review.

Future invocation (not run during preparation):

```sh
V=benchmarks/reports/comparison-fairness-20260827/published-artifact-authentication/verification
node "$V/verify-package.mjs" --input /tmp/safe-bash-baseline-auth-verifier-READY.json --out "$V/package-review-attempt-1.json"
```

Output is exclusive-create and never final acceptance. Nonempty package differences return exit1 and exact path evidence. Even a byte-identity pass reports runtime resolution/evaluation **not proved** and requires independent measured-path/code/lifecycle review. No final seal, commit manifest or score update is produced in this preparation.
