# command-fmt wiring and acceptance

The requested command owner is the private `safe-bash-command-fmt` workspace.
Safe Bash's existing facades and qualified private-workspace profile expose
`@poe-platform/safe-bash/commands/fmt`; no default registration change or
standalone command publication was made. The package-pattern document has
already been moved to `docs/plans/archive/safe-bash-command-package-pattern.md`
in the supplied working tree; that existing move is preserved.

## Implemented SDK surface

`fmtCommand({ limits?, profile? })` remains the real command definition.
`fmtCommands({ limits?, profile?, replace? })` provides explicit plugin registration.
`fmt(context, options)` returns `Promise<FmtResult>` with `exitCode`.
Typed options are `width`, `goal`, `crown`, `tagged`, `split`, `uniform`,
`prefix` (string or bytes), and `files` (literal VFS paths).
Alternatively, `arguments` accepts literal byte argv. Mixing argv with typed
formatting options fails explicitly. Typed values are captured synchronously
inside the registered invocation cleanup scope, admitted against argument
count/byte limits, and passed through the same native-semantic parser.
A `--` separates SDK operands so flag-looking filenames stay literal.

The existing byte engine, bounded windows, arithmetic policy, VFS-only I/O,
stream ownership and explicit profiles remain intact. This change introduces
no runtime dependencies, ambient capabilities or host command fallback.

## Source and installed-artifact evidence

Freshly downloaded GNU coreutils 9.10 archive SHA256:
`16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25`.
Read released `src/fmt.c`, the fmt invocation documentation and upstream fmt
controls. Compared the pinned development `fmt.c` at
`b25722854370b8206d7f53f8934c36710cdd9974`: only initialization placement
and redundant initialization removal differ. The 9.10 `width.sh` controls
explicitly exclude LF from maximum width. These are source observations;
no host fmt utility was executed and no new native-oracle results are claimed.

The maintained selected build closure for `@poe-platform/safe-bash` passed.
`scripts/package-safe.mjs` staged public artifacts at version
`0.0.0-command-fmt`, using `resolvePrivateCommandBuild`. Public SafeFS,
SafeJS and SafeBash tarballs were packed with scripts disabled and installed
into a fresh consumer outside the checkout. The maintained fmt runtime fixture
passed, including actual Shell/VFS/pipeline/script execution, canonical argument
identity, raw byte prefixes, raw SDK argv, typed SDK options and plugin registration.
The fmt declaration consumer passed strict NodeNext compilation with exact
optional properties and unchecked indexed access. Neither private contracts nor
`safe-bash-command-fmt` was installed. Packed command implementation and declarations
use relative bundled contract paths. This establishes local Node artifact
integration, not publication or full GNU compatibility.

## Required checks and open safety gate

TDD: the three new typed SDK tests failed before implementation and passed
with the shared-parser wiring. Additional tests cover resource admission,
zero widths/goals, goal-only defaults, mode precedence and explicit plugin collisions.
All 65 private workspace unit tests, ESLint and source/test typechecks pass.
The qualified private-command bundle tests pass (three tests).

The broader fmt command/adversarial/registration selection reports 712 passes
and seven failures. Six `fmt Shell cancellation ... does not drain opaque metadata`
cases and `fmt cleanup closes admission without awaiting opaque capabilities metadata`
require cleanup to settle before pending `capabilitiesFor` work completes.
The private workspace test `cleanup drains admitted VFS capability acquisition
before settling` requires the opposite ordering for pending `capabilitiesFor`
work. There is no declared capability distinguishing the cooperative query from
the opaque query in these fixtures. The current `InputScope.close()` waits for
its tracked acquisition, reproducing those seven failures.

Both assertions and current cleanup behavior are preserved; no timeout,
expectation, skip or resource accounting was weakened to obtain a pass.
Safety acceptance remains pending reconciliation of the metadata acquisition
contract and these conflicting gates. Complete upstream combinations beyond
previously qualified cohorts also remain pending; no full GNU parity claim is made.

Temporary `/out` was read-only; task-owned evidence used ignored
`out/command-fmt` and an isolated temporary consumer, purged after recording.
Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No push or private package publication was requested or performed.

Follow-up: the metadata cleanup conflict above is resolved by closing resource
admission without awaiting capability metadata; acquired resources still drain.
The formerly conflicting private test now asserts this contract and failed before
the fix. All 65 package tests and all 755 selected integration tests pass after
the maintained build. Fresh isolated public-only runtime/types and screenshot
checks pass. See [the follow-up QA receipt](safe-bash-fmt-cleanup-qa.md) for scope
and remaining compatibility/runtime cells. The earlier seven failures remain
recorded above as historical evidence rather than current failures.
