# safety-csvstat resource and failure boundary verification

Disposition: incomplete; runtime verification blocked by an absent candidate.

## Candidate and concrete inspection

Inspected on 2026-09-20 at HEAD
`35d01c57f8078d8afa916dc59929395d857e9c55`, with existing unrelated working-tree
changes. This identifies the checkout base, not a frozen runtime revision.

Fresh filesystem and parsed-manifest checks found:

- No `packages/safe-bash-command-csvstat` directory or manifest.
- No `packages/safe-bash/src/commands/csvstat` facade.
- No `./commands/csvstat` export, `safe-bash-command-csvstat` dependency, or
  corresponding private-workspace admission in safe-bash's manifest.
- No package-directory names containing `csv`, `decimal`, or `inference`, and
  no csvstat/csvsort-named command source files.
- XAN reader/selector paths remain listed in `integration-boundaries.json` and
  excluded by `tsconfig.build.json`. Their contents were not inspected or reused.

The requested package-pattern path is absent due to existing changes. Its
[archived copy](archive/safe-bash-command-package-pattern.md) was read; neither
path was restored or edited. The [engine prerequisite finding](safe-bash-csvstat-engine-prerequisites.md),
[wiring prerequisite finding](safe-bash-csvstat-wiring-prerequisites.md) and
[independent acceptance controls](safe-bash-csvstat-acceptance.md) remain applicable.
Missing code is concrete evidence of an unavailable candidate, not a reproduced
cancellation, quota or authority defect. No substitute Number/Date engine or
placeholder command was introduced.

## Pending manual QA and independent test cells

Execute this Markdown plan after the real shared engines and command are admitted.
All unit fixtures use memory VFS/memfs and mocked external capabilities. Construct
expected results from the independently specified acceptance controls, before
implementing fixes. First demonstrate each reported defect with a failing test.

| Boundary | Independent execution and acceptance |
| --- | --- |
| Shell and SDK | Run actual `cat input.csv \| csvstat -y 0 --mean > result.txt`, then the same command in a VFS `.sh` file dispatched through `sh`; compare stdout, stderr, status and VFS bytes with the SDK. Use `v\n2\n4\n6\n` and expect `4\n`. Verify command registration remains opt-in. |
| Chunk ownership and grammar | Partition UTF-8 BOM, multibyte Unicode, CRLF, quoted newlines and escaped quotes at every byte boundary; repeat with a producer reusing its buffer. Compare whole-input controls. Independently cover invalid encoding, NUL, strictness, quoting modes and malformed EOF with declared versioned profiles. |
| Cancellation during parsing | Block a cooperative source between chunks, abort with both ordinary and errno-shaped reasons, and assert no statistic success/`None` fallback. Verify the source settles, registered cleanup drains, reservations return, and a fresh invocation succeeds. |
| Cancellation during output | Block an enrolled sink after an admitted write, abort, release the cooperative write and await invocation/disposal. Check no later writes or acquisition, no unhandled late rejection, and idempotent overlapping cleanup. Record already-written bytes as partial effects. |
| Quotas and rollback | Exercise input bytes, field bytes, rows, columns, inference work, Decimal expansion/precision, temporal microseconds, distinct maps, frequency ordering, retained memory and output limits exactly at and beyond each published bound. Failure must remain quota failure, never an unavailable statistic or silently truncated success; test reservation rollback and reuse. |
| Host and realm authority | Run admitted runtime graphs with process/Buffer/require absent and poisoned host-file, executable, fetch and credential capabilities. VFS-only success must not consult them. Missing network/host authority must fail explicitly with no fallback or download. Node VM checks alone do not qualify actual browser/workerd engines. |
| Write identities | Through actual Shell redirects, test literal same path, symlink alias, backing-identity alias and unresolved identity. Verify the responsible redirect contract and exact mutation order; never infer safety from lexical path differences. Distinguish shell truncation/partial output from any command-owned atomic publication. |
| Conditional publication | For any real command-owned file output, inject destination replacement between validation and publication; require supported conditional/exclusive publication or explicit refusal. Assert no read-then-recursive-delete, orphan temporary files or unbounded staging. Test rollback and cancellation at every admitted write stage. |
| Error classification | Singleton stdev is unavailable (`None\n`); cancellation, quota exhaustion and injected internal failure must remain distinct failures. Conflicting `--sum --mean` is argument status 2. Negative frequency limit is empty; zero means default five. |
| Hostile output growth | Bound custom format width/precision, JSON indentation and output expansion before allocation. Qualify nonfinite JSON policy explicitly; do not silently stringify NaN/Infinity as null. Include many unique fields, oversized exponents and malformed duration grammar. |
| Replay and checkpoints | Where the eventual API supports original/checkpoint/replay execution, compare byte identity, fixed clock/locale/timezone behavior, budget ownership and cleanup. Unsupported execution modes remain separately reported. |
| Installed artifact | Build and stage through maintained guarded routes; install only public tarballs outside the checkout. Import `@poe-platform/safe-bash/commands/csvstat`, compile strict NodeNext declarations, execute Shell/SDK controls and verify no private package installation or leaked private specifier. Do not publish the private workspace. |

Pin reproducible generated-case seeds and retain minimized failing byte fixtures.
Use explicit fixed invocation clock/timezone/locale controls for relative dates;
historical unfrozen oracle observations are not current expected outputs. Native
csvkit/agate controls are authenticated manual QA only, never unit dependencies.
Inspect CLI screenshots when a real visible command exists. Run the narrowest
maintained workspace lint/test/build closure for focused changes; shared changes
require complete `npm test`, repository lint and `npm run build` receipts.

## Results for this checkout

- Passed: candidate absence and manifest absence checks; held-path metadata
  inspection; archived package-pattern inspection.
- Runtime passes: none. Runtime failures reproduced: none.
- Incomplete/unverified: every runtime cell above, syntax/runtime/lint/build of
  csvstat, CLI/SDK equivalence, screenshots, installed exports, compatibility,
  realm authority, cancellation/disposal, rollback, quotas and replay.
- No runtime gates were executed: there is no command workspace to target.
  Unrelated workspace passes would not qualify this absent command.
- No runtime compatibility profile or deliberate semantic deviation was admitted.
- Only this QA record was added; unrelated edits and task statuses were preserved.
- Local commits: none. Verified remote-main delivery: none. Successful releases:
  none. No package publication was performed.
