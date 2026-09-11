# New-expression and cross-realm qualification

## Bounded upstream selection

At 5ffb77ffa, the 59 top-level files in Test262
`test/language/expressions/new`, pinned to
`72faf8ec1445c55149615e8b35187830783aba1a`, report 58 passes and no guest
failures (63862a, 7c2a8c). No metadata exclusions were needed. One case,
`non-ctor-err-realm.js`, is native-unqualified because the VM probe does not
provide the $262 cross-realm harness. It is not counted as a guest pass.

The probe parses metadata, loads original sta.js/assert.js and declared includes,
checks each fixture in a fresh strict native VM with a one-second timeout, then
runs it in a fresh guest with a two-million-step budget. Per-file output precedes
the terminal count. The selection covers constructor-reference capture,
argument evaluation before constructibility validation, spread iterator failures,
and spread-object copying. It is not the official Test262 runner or complete
new-expression conformance.

## Adapted cross-realm behavior

The omitted fixture checks that attempting to construct another realm's parseInt
throws the caller realm's TypeError, both with and without constructor arguments.
An adapted read-only probe uses two native VM contexts as a control, then two
SafeJS `run` results and an exported guest consumer closure's call method.
For both syntax forms, native and guest results are identical:
`[error instanceof TypeError, error.constructor === TypeError,
error instanceof otherTypeError]` is `[true, true, false]` (121efb).
The probe terminated normally. This validates the adapted internal transport
path; it does not retroactively qualify the unchanged upstream fixture.

## Public live-realm admission limitation

Two other adaptations deliberately used `createRealm().evaluate` exports.
Injecting those exported callbacks into ordinary `run` bindings is rejected as
nonportable live capabilities (67239c). Injecting them into another live realm's
bindings is also rejected, with `Foreign realm guest callback` (5e68c5).
Both temporary realms were closed in finally blocks.

The latter rejection follows the explicit callback-owner identity check in
`importHostCapability`; it occurs at admission, before the test's constructor
expression executes. Therefore it is a live-capability transport limitation,
not evidence that the new operator selects the wrong error realm. The internal
raw-value result above must not be presented as public live-realm interoperability.

Do not remove the owner check merely to admit the fixture. A portable transfer
design must specify identity, originating globals/prototypes, ownership, budgets,
cancellation, revocation and behavior when the original realm closes. Existing
isolation checks and unrelated user changes remain untouched. No runtime fix,
dependency change, push or release follows from these probes.
