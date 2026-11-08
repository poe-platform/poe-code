# Runtime permission compatibility: author handoff

August 27, 2026. Source `774644f9ea39b41f824db4c829e7a97e6e1386be`;
**26/26 author controls (23 executed, three source-policy checks)**.
Independent Plato review is pending. This is external release tooling, not a
product API, dependency, engine-minimum or security-guarantee change.

## Defect and preserved baseline

The separate immutable8670 package attempt `2b26defd` remains failed: 19 strict
groups, packed70 registry, 25 imports, four workflows and public types passed,
but 16 runtime groups plus source-denial exited9 under Node24.11.1 because
`--experimental-permission` was unknown. No bodies ran in those 16 groups;
later fallback checks/final installed-package sweep were not reached. That
attempt was not rerun, edited or relabeled.

## Source/API delta

`scripts/verify-current-consumers.mjs` now exports:

- `probeConsumerPermission(report, executable = process.execPath)` records
  `report.permissionAdmission` and an exclusive JSON receipt in the fresh report
  directory. It resolves/hashes the actual executable, queries that binary's
  version/path/platform/architecture and permission flag set, prefers
  `--permission`, and uses `--experimental-permission` only if the former is not
  advertised. It then actually reads an allowed fixture, denies writing it,
  and requires an uncaught read of the actual candidate `src/index.ts` to fail
  with status1, `ERR_ACCESS_DENIED`, `FileSystemRead` and that resource path.
  Startup9, missing permission API, permissive behavior and wrong-resource errors
  are not denial. A recognized flag whose behavior fails is not silently retried
  under another mode. Refusal throws with `exitCode: 78` before the build.
- `consumerPermissionArgs(admission, consumer, workers = false)` rechecks the
  executable hash and supported admission before each invocation. It preserves
  the exact read grant, and existing worker/strict-unhandled flags where used.
  Wildcard read roots refuse78 rather than broadening the permission grant.

The runtime launch and final source-denial launch use the admitted binary and
arguments. Existing strict declarations, exact negative diagnostics, runtime
counts, source-denial status/code assertions and package comparisons remain.
The public current-consumer CLI preserves refusal78. The aggregate release
caller also rethrows admission78 and preserves that exit code rather than
continuing later phases; this required two narrow catch-site changes in
`scripts/verify-qualified-release.mjs`. Runtime binding failures inside the
group loop also propagate immediately.

This probes trusted host executables; it is not an untrusted executable sandbox
or a binary-replacement race-proof lease. Native Node permissions themselves
are a trusted-code guardrail, not protection against malicious native/host code.
No new ambient flags or host configuration are used.

## Primary version-specific sources

Inspected the official Node source/docs for both exact installed versions:

```text
https://raw.githubusercontent.com/nodejs/node/v22.22.2/doc/api/permissions.md
https://raw.githubusercontent.com/nodejs/node/v22.22.2/doc/api/cli.md
https://nodejs.org/download/release/v24.11.1/docs/api/permissions.html
https://nodejs.org/download/release/v24.11.1/docs/api/cli.html#--permission
```

Both documented profiles expose stable `--permission`. Selection does not
hard-code a version comparison: the actual binary reports its flags and must
pass real behavior probes. Earlier Node22 builds and the experimental fallback
were not positively executed here. Ordinary product Node >=22 metadata remains
unchanged. Node22 permission support here is separate from its previously
failed external loader-hook interoperability profile.

## Executed evidence and limits

Pinned host profiles, each checked before/after:

| Runtime | Executable SHA256 |
| --- | --- |
| Node22.22.2 | `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011` |
| Node24.11.1 | `4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0` |

Both use the actual unchanged8670 npm package, SHA256
`96d8256f3d763caa5442ba27b44e6b1f586d82d83d07d7d10369bed12426b5c1`,
extracted as a moved public package. The positive program imports public
`Shell`, `agentCommands`, `MemoryFileSystem`, runs a pipeline through a VFS
file and checks exact output/status, then asserts forbidden source reads and
host writes. Both positives pass. Separate uncaught source reads execute and
fail exactly with access denial, not an option error.

Per-profile invocation mutations distinguish: flag-only removal (actual
`ERR_MISSING_OPTION` startup failure), full permission removal (actual public
program fails its source-denial assertion), and widened read grant (same real
assertion fails). Changed binary hash, unsupported admission and wildcard grant
controls refuse78. Five synthetic **trusted test executables**, not product
runtimes, exercise no-mode, startup9, permissive, wrong-resource and forged
code9 diagnostics: none is admitted.

Three source-policy controls inspect admission-before-build, current/aggregate
exit78 propagation, and retained final denial/runtime-count assertions. They
are not three additional CLI executions. The complete current-consumer CLI and
16 original runtime groups have **not** been rerun after the repair. No existing
loader authentication hook was changed or disabled; these direct packed
permission controls intentionally do not certify the whole guarded loader.

Raw attempts remain separate:

- `attempt-v1-setup.json`: zero controls; incorrect guessed tarball filename.
- `attempt-v2-assertion-defect.json`: 22/24; two new test regexes incorrectly
  expected wording for flag-only removal. Actual Node refused startup with
  `ERR_MISSING_OPTION`; no product defect. Final tests assert that exact code
  and add two full-permission-removal controls that really execute the body.
- `AUTHOR_RESULTS.json`: final26/26, zero failures; all owned scratch removed.

Source and package tarball hashes are unchanged before/after. No private
checkout, product sources, package config or external service was accessed or
modified. Source/evidence hashes are in `RECEIPT.json`.

## Required successor overlay binding

Do not run this repaired script as though it were committed in8670. A followup
must be a new named **external verifier overlay** with its own source SHA,
while product/package/config/consumer inventory/helpers remain exact8670.
The intended overlay copies this verifier outside the archive, rewrites only
its relative import specifiers to authenticated frozen helper locations, and
imports the original8670 snapshot/finish functions. The original snapshot then
constructs its normal frozen consumer tree; no archive file is overwritten.
Bind the transformed verifier bytes, exact import-map transformation, original
verifier blob and both source commits. The overlay must not import moving
consumer mappings or silently revise statuses/denials. This overlay is a plan,
not yet implemented or executed. Independent source review precedes acceptance;
a new product candidate instead requires root approval.

Reproduce just these author controls with a unique output filename:

```sh
node tests/integration/runtime-permission-compatibility-20260827/controls.mjs /tmp/UNIQUE-permission-controls.json
```

The preserved package tarball currently resides under the immutable v1 output;
its filename/hash are explicit in the harness. No installation is performed.
