# Bounded executor design

This is a pre-execution design, not a runner implementation or recorded result.
The case declaration module may be imported to validate coverage without loading
either product. No preparation command may call `Shell.exec` or `Bash.exec`.

## Release and freeze transaction

1. Require an existing, nonempty root-owned
   `/tmp/safe-bash-baseline-coverage-execute.ready`; record its bytes and SHA256.
   Require and read the setup result, completed README/config guidance, inventory
   and primary evidence. A missing gate returns `BLOCKED`, not a benchmark loss.
2. Validate the 50-name exact match and preserve all 53 original row objects,
   four extra optional rows and their membership labels. Reconcile any final
   setup delta explicitly before inputs are frozen. Do not regenerate or edit
   the setup leaf's inventory.
3. Create a uniquely owned `/tmp/safe-bash-baseline-coverage-execution-<nonce>`.
   Copy the entire current source tree and package metadata once, preserving
   symlink entries. Reject source links resolving outside the copied tree rather
   than following a moving worktree. Record the original and copied manifests.
   No copied source is committed or changed; it is a test subject, not a shim.
4. Resolve Node, tsx registration, our snapshot entrypoint, baseline ESM export,
   optional workers/WASM/stdlib, and every dependency package from the actual
   launch location. Capture lexical path, realpath, symlink chain, hash, package
   version and lockfile entry. Do not invoke `node_modules/.bin` live aliases.
   A controlled `node --import <resolved-tsx-registration>` launch uses the
   installed tooling and records that dependency tree's before/after hashes.
5. Hash all snapshot source, both installed dependency trees, root/benchmark
   manifests and lockfiles, existing reused helpers, runtime executable, setup
   artifacts, and new recipes/runner. Preserve original git HEAD, dirty status,
   cached diff and full source manifest; a git hash alone is not a freeze.
6. Publish immutable `attempt-001/inputs.json` containing concrete cases,
   expanded fixture bytes, environment, budgets, public constructor options,
   authorization policy, network response bytes and resolved paths before
   spawning product executions. Record the exact loopback port if allocated.

## Execution boundaries

- One fresh child process per engine/case, one in-memory VFS and actual shell.
  The child uses a minimal declared environment; no user HOME data or arbitrary
  filesystem adapter. Do not preload private packages or native utility shims.
- Ordinary cases have a 30-second product signal budget; SQLite, Python and
  JavaScript have 120 seconds to include cold worker initialization. Set matching
  public runtime-specific execution limits, not only a parent timer. A separate
  10-second cleanup deadline distinguishes product timeout from unresponsive
  host work. Never count an exception during startup as command behavior.
- Use our `createMemoryFileSystem`, `Shell` and `agentCommands()` public exports.
  Enable `networkCommands` only for the shared curl control, with an exact origin
  and resource/method allowlist. Do not register missing names manually.
- Use baseline `InMemoryFs` and `Bash`; `javascript:true` only for js-exec/node,
  `python:true` only for python/python3, and documented network configuration
  only for curl. Use installed optional local assets and public APIs. Preserve
  `node`'s stub response without substituting js-exec or host Node.
- A native `node:http` fixture server listens exclusively on `127.0.0.1` port 0.
  It serves only GET `/fixture.txt` with the declared fixed bytes, returns a
  deterministic denial otherwise, and logs every request. A narrowly authorized
  existing transport is permitted; an implementation of missing curl is not.
- Do not disable baseline defenses, change optional configuration or narrow a
  failing case speculatively. On a known-safe setup failure, publish the exact
  provenance and error promptly. Any approved correction gets a new attempt.
- Track child PIDs, exit codes/signals and server close completion. Request normal
  shutdown after output collection; no parked workers, SIGSTOP or unrelated
  process cleanup. An unresponsive child requires an explicit exceptional
  cleanup record, not a successful or normal-exit claim.

## Captures and attribution

- Capture fixture setup and constructor errors separately. Snapshot before
  target execution, after fixture setup and product constructor effects.
- Record exact script, declared literal argv, stdin base64, cwd, environment,
  fixture type/content/mode/symlink definitions and expected success/effect intent.
- Capture public raw stdout text, any encoding tag, `stdoutAsBytes` result,
  raw stdout bytes from ours, stderr text and ours' stderr bytes separately.
  Any UTF-8 encoding of baseline stderr is labeled derived. Include native
  child stdout/stderr, exceptions, elapsed time and limit failures separately.
- No instrumentation wrappers replace command definitions in the main cohort.
  Ours' public middleware may record transparent command events if validated by
  separate uninstrumented controls. Baseline registry/kernel attribution comes
  from the pinned concrete source map plus successful actual execution, with
  its lack of public kernel trace stated. Loaded module traces should record
  realpaths and CommonJS cache entries; worker-internal paths require pinned
  asset manifests and remain explicitly limited if not publicly observable.
- Census `/fixture` and `/tmp` completely; also capture root namespace and
  built-in infrastructure separately. Use `lstat`, never follow a symlink to
  escape census or turn unknown type into a file. Record all available public
  metadata fields, raw dates and numeric values, file bytes and symlink targets.
  Limit 4096 entries, depth 32, aggregate 32 MiB; retain partial census and error
  if exceeded, never silently claim complete effect equality.
- Compare status, declared exact bytes or explicit text predicates, required
  file content/type and preservation of all fixture input bytes/types/modes.
  List every added/removed/changed path, including unexpected effects. Add a
  mode+symlink fixture control before full execution to validate this census.
  Do not compare opaque identity descriptions by string or infer absent fields.
- Preserve all raw unstable metadata; a documented stable effect projection is
  a separate field, not overwritten raw observations. Infrastructure differences
  are outside fixture semantic equality, but remain visible in census captures.
- `&&` prerequisites that fail leave the target `dependency-blocked`, never a
  target pass or runtime failure. For names such as compopt, dirs and popd, add
  separate direct-target attempts if needed to distinguish missing target from
  missing prerequisite, retaining both observations. Do not hide prerequisite
  failures by ending the script with an unconditional successful print.

## Reporting and closure

Generate one durable row per original name, retaining the complete source
inventory row, historical measurement status, current membership, recipe IDs,
engine observations, actual target reachability, success assertions, setup
configuration and classification evidence. Added optional names and shared
controls are separate groups. Classification must allow at least:

`functional-positive`, `partial-functionality`, `missing-handler`,
`unsupported-options`, `dependency-blocked`, `optional-default-disabled`,
`optional-runtime-unavailable`, `setup-unavailable`, `timeout`, `baseline-stub`,
`documentation-only`, `no-op-not-operational-proof`, and `harness-error`.

Both-failing and setup-blocked pairs are never parity successes or feature wins.
The first executed attempt is immutable even if a harness bug requires a
corrected capture. Compare all hashes again afterward and report snapshot,
dependency and live-worktree drift independently. Source snapshot integrity
must survive moving live HEAD. Supply bounded replay instructions and separate
raw and semantic checks for the later fairness verifier.

Final reports describe real breadth gaps, functional controls and unavailable
cases without full-parity/superiority/performance claims. Suggest 3–5 tool batches
as engineering judgment tied to concrete coding-agent workflows, not telemetry.
Select the smallest-coupling author batch with clear prerequisites, but implement
none. Stage and `git commit --only` exact new owned artifact paths; preserve the
shared index. Publish the commit, full names/counts, hashes/config evidence,
remaining limits and child/fixture cleanup in the owned `/tmp` result handoff.
