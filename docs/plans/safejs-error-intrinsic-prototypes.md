---
title: Error intrinsic prototypes
---

# Validated error prototype graph gaps

Native probes and the initial error-intrinsic-prototypes tests show missing
Error.prototype, constructor inheritance, instance/call prototype links and
native property descriptors. SafeJS exposes enumerable own name/message/stack
fields even for an empty Error. A detached error still passes instanceof Error
because the named-error shortcut ignores its current prototype. Conversely,
Object.create(Error.prototype) cannot work because that prototype is absent.
String(new TypeError('x')) already matches native and is retained as a control.

The tests were added after the Symbol.hasInstance improvement was qualified and
pushed. That improvement intentionally preserved the old error compatibility
branch; this is the next separate atomic task, not evidence it was fixed earlier.

Relevant implementation: globals/error.ts creates nonguest sandbox constructors;
exceptions.ts createSubsetErrorValue returns plain objects with enumerable own
name/message/stack. Exceptions are created both by public constructors and when
converting caught host/runtime failures. A prototype-only patch to constructor
calls would miss those paths. Review error formatting, copying and snapshot
branding before changing own-property shape: host code that reads raw .name
cannot see a prototype link stored in the sandbox's private map.

Build normal Error/subtype constructor and prototype graphs, attach instances,
preserve diagnostics and budgets, and use prototype traversal for native-shaped
errors instead of the unconditional brand shortcut. Validate message/cause,
subclass/newTarget and AggregateError behavior before deciding which changes are
required for the constructor implementation. Preserve older snapshot heap shapes
through evidence-backed compatibility handling. Keep the separate Float32Array
graph gap open; do not claim it is fixed by error work.

## Validation in progress

The expanded native-oracle constructor cohort passes. Three additional failing
portable snapshot tests proved that the new guest-object representation lost
the private Error brand; guest heap capture, validation and restore now preserve
that metadata. The 1,215-test Error/snapshot cohort passed after updating the
outer checkpoint validator as well. A separately failing legacy-constructor
snapshot test showed restoration adding a prototype to an older constructor;
realm bootstrap now selects the captured Error constructor shape. The subsequent
39-test focused compatibility cohort passed. Full workspace qualification,
budget and diagnostic review, selected build and actual harness validation are
still pending; this change has not been committed or pushed.

The first full SafeJS workspace run completed in 221.91 seconds: 96 failed,
17,513 passed, 41 skipped. Only the two unresolved native-Promise import-policy
tests were explicitly excluded. Log: `/tmp/poe-safejs-error-package.log`.
This is a regression-discovery run, not qualification. No build ran concurrently.

Confirmed follow-up work:

- Stored host-call outcomes use `cloneSandboxValue` (`host-call.ts`'s
  `copyOutcome`), which rejects the newly explicit Error prototype links. Replay
  data encoding has the same generic guest-state rejection. Preserve Error
  descriptors, brand, cycles, diagnostics and replay identity without permitting
  arbitrary guest prototypes or executable accessors across data boundaries.
- Public normalization of thrown primitives/ordinary records needed an explicit
  normalization pass after creating the new Error shape. That path is patched;
  the 194-test boundary cohort now has 185 passes and nine remaining host-copy
  failures. Log: `/tmp/poe-safejs-error-boundary-focused.log`.
- Existing template-coercion tests exposed loss of the converted Error name
  while a message getter/coercion runs. `Error.prototype.toString` now retains
  its receiver and converted name through completion or throw. The subsequent
  Error/template cohort passed all 62 tests. Log:
  `/tmp/poe-safejs-error-retention-focused.log`.
- Still review nonenumerable Error data accounting, surfaced frozen errors,
  source/public error formatting and host-copy protections before rerunning the
  full suite. Do not count the earlier full-run failures as fixed by the focused
  retention or public-normalization checks.

The `.ajs` harness pair is authored but has not yet been built or executed.

Additional red/green validation: a 10,000-character Error message plus stack
was measured as only 398 units, and an uncaught frozen TypeError surfaced
"Cannot add property name, object is not extensible" instead of its original
message. Both new tests failed before repairs. Data measurement now includes
nonenumerable properties of privately branded errors. Public normalization
creates a separate diagnostic object when the source cannot safely be rewritten,
preserving the frozen guest object and its original message. The Error/template
cohort passed all 64 tests and TypeScript passed. Logs:
`/tmp/poe-safejs-error-accounting-red.log`,
`/tmp/poe-safejs-error-accounting-focused.log`,
`/tmp/poe-safejs-error-accounting-types.log`.

Host-outcome cloning/replay remains the next unresolved integration repair.
These accounting/diagnostic checks do not qualify the full change for delivery.

## Host boundary repair

Two additional failing sync/async host-error tests confirmed that recording the
outcome replaced the original message with the data-copy rejection. The host
bridge now explicitly creates its established data-only Error transport record;
the receiving realm resolves its default prototype from the private Error brand.
Explicit prototype overrides, including null, still take precedence. This does
not change guest-created Error descriptors or allow executable prototype graphs
inside the transport format. The new replay tests check canonical TypeError
prototype identity and exactly one host invocation.

Restoring a guest Error now applies its captured explicit prototype before the
brand, avoiding the default-transport prototype optimization dropping that
explicit link. The Error/host-boundary cohort passed 300 tests with one remaining
guest-to-host export failure in the existing string-coercion callback fixture.

That export failure is repaired with a dedicated native Error data path. It
preserves native type, own descriptors, cycles and extensibility, and uses the
existing explicit callback wrapper. It rejects custom or modified Error/Object
prototype chains and accessors rather than executing or copying them. New tests
cover frozen TypeError export, a self-cause cycle and those rejection boundaries.
The subsequent 42-test Error/export/string-coercion cohort passed; TypeScript
passed. The second full workspace suite is running, not yet qualified.

The second full workspace run completed successfully: 17,618 passed, 41 skipped,
514 passing files and one skipped file, 234.44 seconds. Only the two previously
documented native-Promise import-policy cases were explicitly excluded. Scoped
ESLint, TypeScript and `git diff --check` passed. Logs:
`/tmp/poe-safejs-error-package-second.log`, `/tmp/poe-safejs-error-lint.log`,
`/tmp/poe-safejs-error-transport-types.log`. Selected build and actual CLI harness
validation are next; no release is claimed for this uncommitted change.

Final local qualification: the selected closure built 23 workspaces and passed
all four native-ESM initialization checks. The maintained screenshot route then
completed 70 uncached root build tasks in 61.045 seconds and ran this harness.
The captured `screenshots/harness-run-docs-plans-safejs-error-intrinsic-prototypes.md.png`
was visually inspected and explicitly reports "Harness passed". Build and CLI
logs: `/tmp/poe-safejs-error-build.log`, `/tmp/poe-safejs-error-cli.log`.
No matching open GitHub issue was found. Local qualification is complete;
remote-main delivery and publication are separate milestones.
