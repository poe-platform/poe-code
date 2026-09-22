# ship-csvgrep task-diff review

Reviewed the working candidate on 2026-09-20 at local HEAD
`ab1fa8d34101e1e7f61272973f3bc28a842043d8`. This receipt records a new local
verification run, not remote delivery or publication. Unrelated edits, including
the package-pattern move to `archive/`, were preserved.

## Findings

No additional validated implementation defect was found in the command,
matcher, CSV engine or public csvgrep entry. No code simplification was justified
by the existing tests. The command-definition execute callback and plugin setup
adapt required public interfaces; removing them as proxies would remove those
interfaces. Safe-bash's entry only re-exports the private command API.

The command remains TypeScript ESM, `private: true`, with no external runtime
dependencies. Production sources have no host executable/file imports, implicit
network, dynamic download, native/WASM fallback or JavaScript RegExp execution.
The compact package README describes flags, examples, output/status, default
limits, VFS ownership and versioned runtime/compatibility boundaries; safe-bash's
existing support table links that profile.

Reviewed pattern precedence, short/missing cells, physical numbering, argument
snapshots, byte-buffer ownership, invocation-local quotas, best-effort bounded
diagnostics, cancellation propagation, idempotent producer return, execution and
cleanup error aggregation, and output backpressure. Retention is deliberately a
cumulative conservative ledger, not exact live memory measurement. Streamed
failure can leave partial output; same-source redirects can truncate input.
Those behaviors are documented. No snapshot or compatibility version changed;
checkpoint/replay execution was not qualified.

## Executed Markdown QA

1. Inspect the archived package pattern, manifests, command/matcher/engine,
   public re-export, READMEs, acceptance ledger and maintained packed fixtures.
2. Run maintained csvgrep unit and lint routes: **55 tests passed**, no skips;
   ESLint and source/test typechecks passed.
3. Run maintained CSV-engine unit and lint routes: **9 tests passed**, no skips;
   ESLint and source/test typechecks passed.
4. Run `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`:
   selected dependency closure and safe-bash postbuild passed. Shared cache was
   enabled; this was not a full-repository or explicit no-cache run.
5. Stage public artifacts with `scripts/package-safe.mjs` at version
   `0.0.0-ship-csvgrep-review`, then `npm pack --ignore-scripts` each staged
   SafeFS, SafeJS and SafeBash package. All passed.
6. Offline-install only those public tarballs, without lifecycle scripts, into
   an isolated OS temporary consumer outside the checkout. Inspect its lock:
   no private command, contracts or CSV-engine workspace was installed.
7. Execute the maintained private-command fixture under Node, browser and
   workerd conditions. All passed, including csvgrep CLI/SDK equality, actual
   branded contract identity, producer ownership and failure controls.
8. Compile the maintained csvgrep declaration fixture with strict ES2023
   NodeNext, exact optional properties and unchecked indexed access, for default,
   browser and workerd custom conditions. All passed.
9. Bundle that installed runtime fixture for browser and workerd conditions;
   execute each in a separate VM realm with explicit web capabilities and no
   Buffer, process or require. Both passed. Actual browser/workerd engines remain
   unqualified; this proves conditional packed graph behavior.
10. Run scoped `git diff --check`: passed. No visible CLI or document renderer
    changed during this review, so new screenshots were not applicable.

SafeBash tarball SHA256:
`1b1868d702be425607f64fc63c2d13cf701533b23df3b834a92f647864dd2861`.
Command, matcher and CSV-engine source hashes match the earlier
[ship verification receipt](ship-csvgrep-verification.md).

`/out` creation failed because the host filesystem is read-only there. Used
ignored `out/ship-csvgrep-review` and a task-owned OS temporary consumer instead;
both were purged after verification. No native executable oracle was used.
This review changes documentation only; full repository routes were not rerun.

## Unresolved compatibility findings

The [acceptance ledger](safe-bash-csvgrep-acceptance.md) still leaves broader
Python regex grammar, native codec/quoting/NUL/error behavior, selector open/zero
range qualification, shared-stdin match files and complete adapter
containment/cancellation/replay cells unresolved. Native eager admission of
losing match-file arguments also differs from this candidate's lazy acquisition.
These block full compatibility completion; packed-export success does not
resolve them. The README explicitly advertises the supported subset.

Local commits created by this review: none. Verified remote-main delivery: none.
Successful releases: none. No private package or public artifact was published.
