# #631: configurable tee target admission

## Status and scope

Root-integrated candidate, September 5, 2026; not yet qualified for publication.
Root reproduced 72 failures and 29 passes before applying the target cap.
The expanded stream/lifecycle selection passes all 318 tests, including all
101 new tee cases and the #632/#633 regressions. Discovery registration passes
all 98 tests. This remains a separate atomic fix; a shared full maintained gate
with #633 is required before either commit is pushed.

The independently fetched issue is authored by `kamilio`; the saved issue was
open during validation. Its suggested default of 64 is an intentional new
admission policy. Existing `tee` opens every parsed operand before consuming
stdin, and no target-count option previously existed. Tiny in-memory controls
confirm 2/4/8 simultaneously live consumers at the first input byte. They do not
validate the issue's large-input OOM, per-target heap, timing, or descriptor
exhaustion claims. Existing output-byte charging is not a target-count cap.

Preserved baseline evidence:
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/631-readonly.AmcUKm/`
(`issue-631.json`, `probe.log`, reviewed identities and evidence hashes).

## Minimal correction

- Add `maxTeeTargets` to standard, agent, and browser command options and forward
  it through both command-factory and plugin registration routes.
- Validate a nonnegative safe integer at stream-command construction, default
  64; zero admits stdout-only `tee`.
- Count all parsed file operands, including duplicates, and refuse excess with
  the existing usage-error path before tee-owned opens, truncation or input.
- Leave the existing admitted output loop and Shell redirections unchanged.
  Do not batch, replay or deduplicate input/targets.

The four production files are `src/commands/streams.ts`,
`src/commands/index.ts`, `src/plugins/index.ts`, and `src/browser.ts`, all under
`packages/safe-bash`. Add one in-memory test file at
`packages/safe-bash/tests/commands/tee-target-admission.test.ts` and the non-README
contract `packages/safe-bash/src/contracts/tee-target-admission.md`.
No package registration, runtime helper, filesystem, or Shell change is included.

## TDD and bounded evidence

Candidate/evidence directory:
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/631-candidate.e4kyYF/`.

- `red-tests.log`: unchanged production, 101 tests executed; 72 fail, 29 pass.
- `green-tests.log`: candidate production, the same 101 tests pass, no skips.
- `adjacent-tests.log`: 13 selected existing tee tests pass, no skips; only tiny
  cases from `streams.test.ts` and `filesystem-output.test.ts` are selected.
- `scoped-types.log`: TypeScript 5.9.3, all actual package compiler options plus
  `noEmit`, four owned production roots and the new test root; zero diagnostics.
  This is not the entire source/test root set or a full type gate.

New controls cover seven registration routes, invalid limits, zero and exact
caps, duplicate counting, 2/4/8 live consumers, upfront truncation, partial open
and write failure, falsey cancellation reasons, deferred backpressure, borrowed
input ownership, shared output-byte limits, and prior Shell redirection effects.
Default 64 and explicit 65 boundary controls use tiny duplicate operands with an
immediately rejecting output backend: they never hold 64 or 65 consumers open.
Maximum-safe-integer acceptance uses stdout-only execution, not large operands.

The scratch runtime overlay supplies only the four copied production sources
and the new test while resolving other dependencies from the checkout. Logs
record loaded candidate hashes. Network/DNS entry points are blocked during
runtime controls; observed forbidden calls are zero. No real network, sleeps,
stress, CPU/RSS measurements, native resource exhaustion, build, or broad gate
was used. Browser factories are tested in Node, not a browser/Workers runtime.

## Integration and limitations

Root should review the apply-patch artifact and baseline source hashes before
integration, then run maintained integration gates. This work neither changes
README text nor claims release/public-consumer verification. The cap limits one
invocation's file operands; concurrent invocations, host overrides, persistent
filesystem state, and resource use outside tee remain separate responsibilities.
The artifact manifest and replay receipt bind the proposed seven-file patch;
all earlier RED and readonly evidence remains preserved.
