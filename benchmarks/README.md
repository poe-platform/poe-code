# Pinned shell comparison

This optional, isolated development package compares the actual virtual shell
and available standard commands against **just-bash 3.4.2**. The library's root
manifest has no runtime dependencies and does not depend on just-bash. The
comparator and its transitive dependencies are pinned by this directory's lockfile
and are not part of the shipped `dist/` package.

From the repository root:

```sh
npm ci
npm --prefix benchmarks ci --ignore-scripts
npm --prefix benchmarks run typecheck
npm run benchmark -- --output benchmarks/reports/current.json
node --import tsx --test tests/stress/comparison.test.ts
```

The comparison command exits nonzero for any failure, error, timeout, pending or
unsupported result, a background worker error, or source changes during the run.
The JSON report is still written. Missing runtime components and an uninstalled
comparator are explicitly pending; they never become successful skips. Missing
commands in an otherwise available runtime are real failures, not pending cases.

## Scope and assertions

- Run all 88 oracle fixtures, including all 24 `advanced-pending` fixtures. No
  feature or tier filter exists. The corpus bytes and source files are hashed.
- Add 18 deterministic cases: 16 seeded multi-stage stdin pipelines, binary
  file writes, and a large file/pipeline roundtrip. `--seed` is recorded.
- Add concurrent same-shell pipelines, cooperative host-command cancellation,
  and streaming extension backpressure probes. Unsupported extension APIs stay
  in the denominator. Adapter conformance is independently owned elsewhere.
- Assert stdout bytes, stderr bytes, exit status, and the complete regular-file
  map under `/fixture`. Extra, missing, or changed files fail. Links and special
  entries are rejected rather than followed. The oracle does not establish
  empty-directory, permission, timestamp, or outside-root mutation semantics.
- Use explicit byte APIs for virtual-bash and filesystem reads. For just-bash,
  respect output-kind metadata; otherwise encode its public text result as
  UTF-8. Invalid-UTF-8 expected output cannot be established through a text-only
  result and is reported pending, not guessed from character values.
- Record exact installed/pinned versions, lockfile integrity, Node/OS/CPU,
  source fingerprints, all raw outcomes, and overall/per-feature/per-tier counts.
  Byte evidence includes size, SHA-256, and a bounded base64 prefix; comparisons
  themselves use complete bytes, not prefixes or normalized text.

Each engine runs in its own worker thread with a hard deadline and a 256 MiB
V8 old-generation limit, not a hard bound on RSS or external byte buffers.
Each fixture gets a fresh shell and in-memory filesystem. Only the concurrency
probe deliberately shares one shell. Scripts execute verbatim; the comparator
uses `rawScript: true`. No Bash subprocess, native command, host filesystem
adapter, or guest network access is used by the comparison.

Elapsed timings are descriptive and include filesystem snapshot work. They are
not a warmed, statistically designed performance benchmark. This corpus and its
probes do not prove full shell compatibility, security, tool-flag coverage,
adapter superiority, or the user's requirement:
**"IT MUST BE BETTER than just-bash, much better"**. No superiority claim is made,
even if every selected test eventually passes.

## Primary API references

The adapter was checked against the primary repository README and the installed
pinned package declarations (`dist/Bash.d.ts`, `dist/types.d.ts`,
`dist/encoding.d.ts`, and `dist/fs/interface.d.ts`). The report records source
locators, version, and package integrity. Main-branch documentation is background
context; the installed 3.4.2 API is the comparator used for execution.

## Invocation hook proposal

For future shell/tool agreement, an optional
`CommandContext.invoke(command, args, options?) -> Promise<CommandResult>` would
invoke an argv array without shell reparsing. Proposed overrides are stdin,
stdout, stderr, cwd, env, and signal; inherit the parent budget and cancellation,
isolate child cwd/env, and let xargs explicitly provide empty child stdin. This
is a proposal only; no shared-contract hook is introduced by this benchmark.
