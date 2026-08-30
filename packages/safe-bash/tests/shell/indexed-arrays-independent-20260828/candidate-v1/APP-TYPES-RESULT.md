# Complete-app type continuation: 8/9, no runtime admission

2026-08-28. Preseal/source `9027f94e`; exact candidate
`50117fc54fdfd650e8f57e84b82ba21297ab8a0f`, whole composed metadata tree
`d6c17f62d2d3062b5ab074044a86b8a455820373`, preserved full862 package
`0fadca03da4e100c7dd5b7df0a25d321467f9f1f9fbd288ebcc4456746945d26`.
No build retry, npm execution, product runtime import or native execution.

The approved complete app is regular-only and finite: 1,044 censused entries,
plus 276 entries in the separate tools root. Before dispatch, the concrete
TYPE-BINDING.json and TYPE-PRELAUNCH.json bound all paths, modes and payloads.
The nine children received only app/tools and the exact Node binary read roots,
not work/workspace/home or ambient dependency access. Source/npm/tool policies
and the nine consumer/validator bytes are unchanged. Successful declaration
resolutions are checked against admitted roots; no fallback allowance was added.

## Actual results

Eight cases pass unchanged: ast, negative-option, negative-limit, negative-export,
option-inverse, limit-inverse, export-inverse, ast-negative. Every exact negative
diagnostic matches. The public consumer now resolves the actual bound package,
but fails with these two genuine compiler diagnostics:

```
public.mts(5,39): error TS2322: Type '(context: ShellCommandContext) => Promise<CommandResult>' is not assignable to type 'CommandHandler'.
public.mts(6,3): error TS2722: Cannot invoke an object which is possibly 'undefined'.
```

`executor-v1/public.mts.fixture:5` incorrectly narrows a registered generic
CommandHandler parameter to ShellCommandContext (which requires invoke).
At6 it calls optional registerCleanup without narrowing. Generic CommandContext
declares both optional in `src/contracts/command.ts:34`. ShellCommandContext
requires invoke, but does not strengthen registerCleanup. `Shell.register`
accepts generic CommandDefinition, not a narrowed shell-only callback.

This is a **pre-existing reviewer fixture typing defect**, not an introduced
array API regression. Source command.ts/types.ts/shell.ts match the admitted
accepted DOTGLOB baseline. The actual packed root/command/shell-type/shell-class
declarations all match the accepted full846 b054 package byte-for-byte, modes
included; exact hashes are in APP-TYPES-01-SUMMARY.json. This is static/artifact
baseline evidence, not a separate baseline compiler replay. Original c290e6f1
0/9 resolution failures remain historical and are not rescored.

## Narrow root decision requested

Authorize an additive public-fixture-v2 only: infer the CommandContext callback
parameter; explicitly reject missing invoke/registerCleanup before their existing
calls. No any, cast, non-null assertion, optional-call skip or changed expected
exit. The existing ShellCommandContext import can remain exercised by assigning
the narrowed invoke to `ShellCommandContext['invoke']`. Keep the other eight
consumers and exact diagnostics byte-identical. Preserve the original public
fixture as the two-diagnostic negative countercontrol; no correction is applied
in this checkpoint. A versioned consumer mapping, exact type-control recipe and
actual positive replay would precede any runtime admission.

Because the required nine-case admission has not succeeded, runtime/mechanical,
installed/moved and loaded-mutant phases are stopped. No array semantic failure,
mechanical pass, capacity proof or acceptance is claimed from these type runs.

## Evidence and cleanup

APP-TYPES-CAPTURE-01.json preserves coordinator exit1. The compressed capsule
preserves the exact11,356,162-byte raw report, all nine argv/paths/resolution
traces, prelaunch binding, complete final stage census and baseline proof:

- Encoded SHA256: `1f1d85f2b253799cf2c60a4aff3f27e4bba706c2e696aa4f3284d4d5e8a2b31f`.
- Decoded SHA256: `ed570b4739dd278e64a2cdb882734d0c12412c9b67b5a540d1ca1d7e96fc18ca`.
- Raw report SHA256: `6a45e01a58ce76c87e580885fead5b0dd0abcb7792926b2b4b086f84fa71f3b1`.

All9 children closed with absent process groups, no signal/fault. App/tools,
whole package, Node and exact npm closure stayed unchanged. After capsule
reread/hash verification and append-aware stage verification, only the owned
`complete-app-LEJxv5` root was removed. No active validation process remains;
foreign staging, product, original fixtures and previous captures are untouched.
