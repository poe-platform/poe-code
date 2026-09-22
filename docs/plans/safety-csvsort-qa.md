# safety-csvsort candidate verification

Status: sorting-stage checks pass; end-to-end safety acceptance is incomplete.

Candidate inspected on 2026-09-20: HEAD
`35d01c57f8078d8afa916dc59929395d857e9c55` plus the existing working tree.
The workspace is untracked, so HEAD alone does not identify the implementation.
SHA256 of `packages/safe-bash-command-csvsort/src/sort.ts`:
`8ed7d7843c6b43adab89945f84617eea68b090bf002a241e658d541da67bf2cb`.
SHA256 of its `src/index.ts`:
`e8e50e0eec43c7e915543be366b2c14778c53cfbcd337493a06a26a8c57893b8`.
SHA256 of its manifest:
`5d024c5e636174204f2be7b353cd2e7e61d93eeda2504110b7a32ec186df1a25`.
SHA256 of the added `src/safety.test.ts`:
`bc7d7216ed6fdd8de8a1b041261ad1ee849c4bebe4f7558c778f516f64d426a0`.

The requested package-pattern document has moved to
[the archive](archive/safe-bash-command-package-pattern.md). That unrelated move
was preserved. No held XAN source was opened, imported or extracted.

## Reproduction plan and executed manual checks

1. Search the safe-bash manifest, source, bundle/pack scripts and installed
   consumer fixtures for `csvsort`. Inspect the private workspace manifest,
   public entry and sorter. Confirm private ESM ownership and empty runtime
   dependencies. Search found no csvsort export, adapter or bundle entry.
2. Create a memory VFS and `new Shell({ fs }).use(agentCommands())`. Write
   `/input` containing `v,id\n2,a\n1,b\n`, and `/run.sh` containing
   `csvsort -y0 -c v /input`. Replace global fetch with a counting function
   that throws. Execute each source below independently, then read `/output`
   and `/input`. Always await Shell disposal and restore fetch in finally.
3. Build the selected command workspace. Load `dist/sort.js` as a
   `vm.SourceTextModule` in an empty Node VM context, rejecting all module links.
   Sort records with byte payloads `[255]`/`[0]` and keys `z`/`a`, using
   explicit limits `{ retainedBytes: 100, work: 100, records: 2, keyBytes: 10 }`.
   Check absence of process, Buffer, fetch and require in the context.

| Executed Shell source | Observed result |
| --- | --- |
| `csvsort -y0 -c v /input` | 127, empty stdout, command not found |
| `cat /input \| csvsort -y0 -c v` | 127, empty stdout, command not found |
| `sh /run.sh` | 127, empty stdout, script-path diagnostic, command not found |
| `csvsort /input > /output` | 127, empty stdout, empty `/output` created |
| `/usr/bin/csvsort /input` | 127, empty stdout, no such file or directory |

Fetch call count was zero; `/input` remained byte-for-byte unchanged. Shell
disposal settled. These are negative integration observations of an absent
command, not successful csvsort pipeline/script/cleanup cells. Redirect opening
belongs to Shell; an empty output on failure is not atomic publication. No
credential injection, host executable instrumentation or filesystem authority
matrix was performed, so do not infer comprehensive host/credential isolation.

The VM sorter produced `[[0],[255]]`. All four capabilities were undefined;
the module has no runtime imports. This qualifies only this dependency-free
sorting module in a Node-hosted realm. It does not authenticate cross-realm
brands, sandbox hostile objects, establish replay or qualify browser/workerd.
The host filesystem read of built JS is development QA, not product I/O.

## Automated verification

- `npm run test:unit --workspace=safe-bash-command-csvsort`: 16 passes,
  zero failures, skips, cancellations or incomplete tests.
- `npm run lint --workspace=safe-bash-command-csvsort`: exit 0, ESLint and
  source/test TypeScript checks.
- `npm run build:workspaces -- --workspace=safe-bash-command-csvsort --no-cache`:
  exit 0, maintained selected build closure, ESM and declarations emitted.

Six added independent tests cover invalid limits across every budget field,
zero-budget empty input, exact singleton work admission, repeated failure then
successful invocation, owned subarray payloads with non-text bytes and mutable
integer-key objects, cancellation during key admission with exact falsey reasons,
and comparator exhaustion on equal prefixes. They allocate only memory and use
no native oracle, LLM or filesystem. Existing signed-integer permutation controls
exhaust all 120 permutations. Cases are deterministic; no random seed is needed.

No sorting defect was reproduced, so no production code was changed. Tests
extend verification of existing behavior; no implementation change requiring a
red/green correction was made. Discarding an internal array after failure does
not prove GC timing, RSS reclamation or invocation-wide reservation rollback.
Logical storage quotas exclude engine object overhead. The synchronous sorter
can observe an already-aborted signal or synchronous abort during admission,
but cannot service event-loop cancellation while it is executing.

## Unavailable acceptance cells

The candidate exposes only `sortRecords`, not a CSV command or SDK invocation.
Its README explicitly states this limit. Adding an export for that helper would
not provide the requested command API. The prerequisite admission gates in the
[command plan](safe-bash-csvsort.md) and
[wiring review](safe-bash-csvsort-wiring-prerequisites.md) remain unsatisfied.

| Required cells | Current qualification |
| --- | --- |
| Chunked CSV, quoting, headers, selectors, encodings, hostile grammar | Unavailable: no admitted parser/selector |
| Boolean/Decimal/Unicode/temporal inference and mapped upstream variants | Unavailable: no inference engine; integer keys are not Decimal compatibility |
| Input/decoded/output/inference/exponent expansion quotas | Unavailable: stage limits account only admitted records and sort work |
| Parse/output cancellation, blocked sinks, invocation cleanup and disposal | Unavailable: no command acquisition or sink lifecycle |
| VFS-only operand access, alias identity, same-file hazards | Unavailable: sorter performs no I/O |
| Conditional/exclusive publication, rollback, bounded temp storage | Unavailable: no command publication path; no spill support |
| CLI/SDK parity and actual successful pipes/redirects/.sh invocation | Unavailable: command and SDK adapter absent |
| Public runtime/types export and installed artifact without private packages | Unavailable: export and bundle integration absent |
| Denied host/network/credentials and executable fallback | Limited negative Shell and VM observations above; complete matrix unverified |
| Original/checkpoint/replay execution | Unverified: no executable command/replay integration |
| Bounded performance and actual advertised runtime matrix | Not run; unit duration is not a performance qualification |

The [pinned compatibility matrix](safe-bash-csvsort-acceptance.md) remains open;
historical native observations are not candidate runtime passes. No oracle rerun
was attempted, and temporal clocks were not inferred from historical outputs.
Full `npm test`, repository-wide lint/build, packed consumers, and screenshots
were not run. This is a focused test-only change with no visible CLI change;
focused passes do not qualify any broad gate. No workflow was changed.

Only this document and `src/safety.test.ts` were added. Unrelated edits were
preserved. Local commits: none. Verified remote-main delivery: none. Successful
releases: none. Nothing was published, including the private command package.
