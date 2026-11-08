# Baseline-only breadth setup handoff

**PREPARED, NOT EXECUTED.** This leaf made no benchmark calls, installed nothing,
changed no product/test/harness/old-report file, and did not start a worker runtime
or local fixture server. Root must release a different executor after the exact-two
characterization worker closes. This handoff is not that release.

## Inventory boundaries

- Historical Curie `20b889b`: **53 frozen names / 3 primary recipes / 50 unmeasured**.
  The three recipes for `.`, `eval`, and `source` remain historical ours 0/3,
  just-bash 3/3; no old score or expectation was changed.
- At this inspection, `.`, `eval`, and `source` have actual current kernel routes
  to `sourceBuiltin`/`evalBuiltin`, not merely classifier entries. This is static
  availability, not an accepted runtime result or completion of those features.
- The current default baseline-only set is exactly the historical **50** unmeasured
  names. `inventory.json` lists all of them and concrete registry/kernel provenance.
- Optional-inclusive comparison adds **js-exec, node, python, python3**: **54**
  unmeasured names, of which **53** are operational candidates and `node` is a
  diagnostic-only stub. Do not hide the stub or treat it as a functioning JS engine.
  Optional `curl` overlaps both products; optional `safejs` is ours-only and is not
  a compatible alias for any baseline name.
- These counts describe this frozen-primary comparison lineage, not every test
  ever run in the repository. Registered, classified, concretely dispatched,
  runtime-ready, measured, and passing are separate states.

The baseline classifier also mentions `bg`, `caller`, `disown`, `enable`, `fc`,
`fg`, `jobs`, `kill`, `suspend`, `times`, `trap`, `ulimit`, and `umask` without
corresponding entries in the inspected registry/concrete dispatcher union. These
13 classifier-only names are explicitly recorded, **not** phantom implemented
commands or added passing coverage.

## Version and primary-source controls

Installed baseline is `benchmarks/node_modules/just-bash`, package **3.4.2**.
Its Node ESM entrypoint is `dist/bundle/index.js`, not the browser entrypoint.
Official tag `just-bash@3.4.2` resolves to
`a021f95f53f7e01df48dab71b46ffd4637fb4b53`. The pinned package README is byte-for-byte
identical to the installed README (SHA256
`3232b230a378c2d853029df513fc8740ce32819d531acc6faed41c2d780b44e2`).
Current main's monorepo layout does not authorize substituting current defaults.

`primary-sources.json` records primary URLs, UTC access timestamps, pinned commit,
response hashes and paraphrases. Research used web.open/search first, then
read-only git ls-remote and primary HTTPS GET. The attempted `v3.4.2` tag was not
the actual tag. No third-party instructions informed setup.

Publisher SRI matches `benchmarks/package-lock.json`:
`sha512-T0Vpy7YRgCjxJdqG3tkxn0ZnIDLJvVwb8hH4L+6NVdp+Te27jQxjxnszW9ODjEKbWxWujj83rP5S0GQxCSufgg==`.
This is **metadata agreement**, not re-verification of an installed tree against
a fresh tarball. No tarball, dependency, binary or optional asset was downloaded.
Installed package/entrypoint/assets have independent SHA256 manifests.

## Exact optional setup, without invented flags

`setup-profiles.json` is the machine-readable configuration plan. Constructor
names come from pinned `dist/Bash.d.ts`, `dist/limits.d.ts`, registry and workers.

| Target | Actual setup | Local prerequisite and boundary |
|---|---|---|
| Default commands, including sqlite3 | `new Bash(...)`, no `commands` restriction | No `sqlite: true` or `sqlite3: true` option exists. |
| sqlite3 | Node bundle plus normal constructor; bounded `maxSqliteTimeoutMs` | Installed sql.js **1.14.2**, local sql-wasm.wasm and adjacent sqlite3 worker exist; worker startup remains untested. |
| js-exec | `javascript: true` | Installed quickjs-emscripten **0.32.0**, local QuickJS WASM variants and JS worker exist; no download required by inspected loader. |
| node | Also registered by `javascript: true` | Export is `nodeStubCommand`: empty stdout, status 1 and js-exec guidance. No positive Node execution case is feasible without changing the product. |
| python / python3 | `python: true` | Vendored `python.cjs`, `python.wasm`, `python313.zip` and Python worker exist. This pin uses CPython Emscripten, not an assumed Pyodide CDN setup. |
| html-to-markdown | Default registration, file or stdin | Installed turndown **7.2.4**; no network needed. A direct URL operand is a VFS pathname, not a fetch. |
| curl | `network` allowlist OR injected `fetch: SecureFetch` | Only controlled loopback data later. No network case in this 54-name plan, because curl is shared optional. |
| ours curl | Explicit `networkCommands({authorize, transport?})` | Existing Node HTTP transport is public; host injection is supported. Never ambient networking or native curl. |
| ours safejs | Explicit `safeJsCommands({runtime:{run,createBudget,makeFsModule,declareHostOperation}})` | No SafeJS package found under either allowed node_modules root. Without a legitimate injected runtime, source returns 127; this is setup-unavailable, not evidence against a configured interpreter. |

The baseline public injected `SecureFetch` signature takes URL and request options
and returns `{status,statusText,headers,body:Uint8Array,url}`. An injected fetch
replaces built-in policy construction; the host must enforce its own exact URL,
method, signal and size limits. Alternatively `network` allows exact controlled
`http://127.0.0.1:PORT/fixture` prefixes, GET/HEAD only, `denyPrivateRanges:false`,
bounded response bytes and deadline. No `dangerouslyAllowFullInternetAccess`,
global fetch patch, private DNS hook, external server or user data is authorized.
Ours transport uses its different public streaming request/response contract;
do not cast one into the other or add an implementation adapter in this task.

Default-disabled JS/Python/curl must not be labelled operationally missing.
Conversely, successful constructor registration, file existence, or module
resolution does not establish worker startup or command operation. Future startup
failures are setup/runtime-unavailable until diagnosed and recorded, not automatic
baseline failures or ours wins. Existing optional zstd/lzma packages resolve, but
their native addons were **not loaded** and are unnecessary for these cases.

## Executor gates and known attribution traps

1. Obtain root release; re-freeze product, helper, native, baseline and input hashes.
   Source is live: `before.json`/`after.json` and `validation.json` expose drift.
2. Prepare fresh memory filesystems; scratch directory setup is a harness duty.
   Do not reuse state across cases. Stateful shell operations stay in one exec.
3. Verify launcher/argv/byte/path controls before native equality. The old helper
   only supplies its own fixed default command list, not all new names. Existing
   native GNU Bash 5.3/coreutils paths are recorded read-only in
   `native-and-helper-before.json`; absent oracle setup is not a product loss.
4. Use actual public Shell/registry/kernel dispatch. `time` must be reached via
   `command time`, not the Bash reserved keyword. Native `whoami`/`hostname` must
   not expose host identity; their synthetic virtual profile is separately unscored.
5. Keep dependency blockers separate: alias needs shopt, compopt needs complete,
   dirs/popd need pushd, arrays need shell support. Successful downstream output
   alone is not proof that the target command ran.
6. `exec` plan requires stopping subsequent statements; baseline's inline child
   invocation is not proof of replacement. `wait` returns empty success in pinned
   source: a synchronous background implementation can fake the simple workflow,
   so no job-control completeness score is allowed. `history -s` is a meaningful
   positive requirement not handled by the inspected list/-c implementation.
7. `du` uses logical VFS size while native du normally uses allocated blocks.
   Preserve raw differing observations, not a normalization or selected-dialect win.
   HTML/yq/xan/SQL use explicit format contracts when no native equivalent is
   available. `help` is inherently informational; no score from help/type alone.
8. For optional workers, keep default security enabled and constrain input, output,
   command count and runtime deadlines. Require child/worker normal exit and close
   only executor-owned resources. No native replacement, installs, source fixes,
   SGID retries, private package access, table changes, or indefinite waiting.

The five proposed batches are provisional engineering judgment, **not usage
telemetry**. There are no speed measurements, parity passes or superiority claims.
Case expectations are plans, not captured oracles. Different-agent execution must
retain raw losses, unsupported operations, unavailable setups and all denominators.

## Evidence files

- `inventory.json`: historical/current sets, optional delta, concrete dispatch paths.
- `case-plans.json`: all 54 scripts/argv/stdin, fixtures, expected effects, budgets,
  prerequisites, profile constraints and input hashes; no execution results.
- `setup-local.json`, `setup-profiles.json`, `primary-sources.json`: pin, dependency
  versions/entrypoints/assets, settings and primary-source provenance.
- `before.json`, `after.json`, `validation.json`, `native-and-helper-before.json`:
  temporal source/helper/baseline/native controls and explicit drift.
- `freeze.mjs`, `capture.mjs`, `refine.mjs`, `plan-cases.mjs`, `verify.mjs`: evidence
  generation/validation only. They never run case scripts. Do not rerun capture
  over accepted evidence; a new investigation should use a new owned directory.
