# Strict extension: author STOP, not accepted

2026-08-29. No retry, new product execution, fixture rewrite or production repair
after the X10 case deadline. Independent/root disposition is required before any
continuation. The original attempt and its retained roots remain unchanged.

## Immutable candidate

- Runtime-only source commit `9bb91c370a0672687399c0a9da4ce1b161f79615`.
- Base `7a5c620005fb04518d44bb284f4e99284e4a7c33`, derived base tree
  `74dfe69135a3fc5ba89396b20dd32d9c9daae131`; no live HEAD/Node integration.
- New derived tree `37e793ce6dce48a958030e7cc86fa8315d0b112e` (computed from
  authenticated tree witnesses, not a claim that this is a stored Git object).
- SOURCE.json SHA256
  `9924773241f116d4cd5008fa7cd7f7fc3d95521f5e57b33299dbf2ed7cc2bf69`;
  293 admitted inputs, only `src/shell/runtime.ts` differs from the base.
- Runtime SHA256 `b14268b38f9a156c45cae80e6871a646086746654803c2b05eb0a7ec7438443b`.
- Executable preseal commit `f5895188`; exact identities, tools and bounds are in
  PRESEAL.json, EXECUTOR.json and ACTIVATION.json, not an inferred HEAD snapshot.
- Full954-member package,871837 bytes, SHA256
  `aaabea71bc3a7f1982a2ded488cbf5a905de304f0bc6f39302d15e293da8495f`.
  The whole package and per-member manifest are preserved under results-v1-stop.
  Read-only post-stop data inspection rechecked all293 source inputs and954
  built package members; it did not continue a test or prove a moved install.

## Production scope

Scalar arithmetic reads check presence lazily under nounset, through the existing
variable Proxy. Direct assignment stays write-only; present-empty, recursive,
short-circuit and signed64 semantics remain. OPTIND, arithmetic commands, LET,
arithmetic expansion and substring catches preserve private nounset/control and
genuine resource errors. No parser/arithmetic grammar or public API changes.

Ordinary Bash set applies supported e/u and terminal-o options incrementally;
invalid tails produce a budgeted diagnostic/status1, with existing errexit rules.
The old sh branch and no-argument set behavior remain. Bare-o/+o prints exactly
the ratified three-option subset, not GNU's complete table or spacing profile.

Explicit parameter failure uses the existing guarded nounset diagnostic-sink
path. Caller priority, genuine ShellLimitError and raw falsy rejection identity
remain; successful diagnostics retain nonisolated127/isolated1. Generic errors
outside this branch are not rewritten. Aggregate DISCARD remains unimplemented.

## Actual execution and stop

One self-contained launch, 06:43:14.165Z–06:43:56.111Z:

```text
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/compatibility/bash-strict-extension-author-20260829/launch.mjs --run
```

- Strict selected production build and offline scripts-disabled full pack exited0.
- Source-layout retained Unit1:48/48; Unit2:50/50; conditional:67/67.
- New extension emitted32 completed PASS rows,0 ordinary assertion failures;
  X10 emitted no result, hit its30-second deadline and explicitly exited78.
- The runner and outer supervisor exited1. **197 completed PASS rows plus one
  deadline is not a passing33-case extension or the planned630-row campaign.**
- Source arrays12, every installed/moved consumer, six public type groups/24
  negative diagnostics, six loaded mutants/restores and two binding refusals
  were **UNEXECUTED**. Build success is not their acceptance.
- No native Bash/Git, private engine, network, Node command or oracle execution.

Raw stdout/stderr,7 runner child receipts,4 loader bindings/traces, all package
bytes and the outer terminal record are retained. The runner measured2855932
captured bytes and56169951 scratch bytes; compact publication is5762037 bytes.
The finite grant was not reset.7 runner children plus the outer runner closed;
4 loaders are reservations, not measured OS children; observed RegexWorkers0.
Administrative/development/publication tools are separate from these measured
runner counts; the preseal reserve is not a global kernel census.

The32 completed extension rows record47 Shell creations and47 fulfilled disposals.
**X10 cleanup is unobserved at forced process exit.** No cleanup-success, no-leak,
all-workers-zero or kernel-descendant claim follows from the process exiting78.
Neither the outer supervisor nor runner recorded TERM/KILL signals.

## X10 source finding / proposed correction, not applied

`extension.mjs` X10 first awaits two isolated parameter cases, then registers:

```js
context.registerCleanup(async () => { await gate.promise; cleaned++; });
return { exitCode: 0 };
```

It runs `guard; printf ...${missing:?required}...`. The release code waits for
the later printf's diagnostic sink to resolve `entered` before releasing gate.
Candidate runtime.ts:1993–2001 creates a child invocation scope and awaits
`scope.close()` in dispatch finally. cleanup.ts:33–55 registers and awaits the
callback. Thus the third X10 subprotocol contains a source-proven cycle:

```text
guard settlement -> registered cleanup -> gate release
gate release -> later diagnostic entry -> guard settlement
```

The raw file contains only `CASE_DEADLINE X10-parameter-isolation-caller`, not
per-substep telemetry. Consequently this source finding **does not establish
which X10 await was actually pending**, or separately pass its first two checks.
It is not evidence of a product cleanup regression or an opaque-provider issue.

Minimal proposed versioned fixture: use the already-tested H28 shape, register
the cleanup in guard, then `return context.invoke('f', [])`, where f performs the
explicit-parameter expansion. Hold diagnostic/cleanup until caller abort, then
release and assert exact caller reason and cleaned1. Add literal substep events
for the two isolated checks, diagnostic entry, abort, cleanup entry/release and
settlement. This uses the existing supported contract and does not change the
asserted precedence or production. Original X10 remains immutable; neither this
change nor a continuation was executed or authorized by this report.

## Qualifications / review request

ACTIVATION.json maps all28 design IDs:23 activated product-profile identities,
five OPEN/unexecuted: U27, S-U27-INPUT-UNIT-v1, S-U28-PRESENCE-v1,
S-U31-STDIN-v1, E23-source-discard. All native tuples remain UNRUN; arithmetic
status1 and the finite option listing are ratified product choices, not native
goldens. No aggregate recovery boundary or universal GNU status claim.

Please independently review the runtime delta and X10 source finding before
authorizing a versioned fixture/continuation. The source/package remain available
for that review; the stopped campaign cannot supply installed/moved/type/mutant
proof. No shared docs, root exports/default count, Unit3 fixtures or foreign
staging were changed.

Retained roots: `/tmp/conditional-author-dEbqvd`,
`/tmp/strict-extension-launch-aUwe2j`, `/tmp/strict-extension-prep-8wtcJy`.
Machine summary: results-v1-stop/SUMMARY.json; original result:
results-v1-stop/raw/RESULT.json; publication manifest:
results-v1-stop/RAW-MANIFEST.json. Harmless post-stop source-display helpers had
two ENOENT lookups for guessed log filenames; original files were not changed,
and no product retry followed. The source transcripts remain tool-context only;
author admission and product raw captures are preserved in the manifest.
