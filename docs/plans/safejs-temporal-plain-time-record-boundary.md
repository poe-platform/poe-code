# PlainTime private record boundary

## Reproduction and repair

The private PlainTime factory accepted primitive/function inputs as empty
records and executed descriptor traps on Proxy inputs. Five added regression
cases failed before the implementation changed (b14c3a); null was an already
passing rejection control. Add the same early object/null/Proxy validation as
the other private Temporal record factories. This does not alter the public
Temporal constructor's specified guest conversions.

The factory audit also inspected PlainDate, PlainDateTime, PlainMonthDay,
PlainYearMonth and ZonedDateTime: each already checks input before descriptor
reads. Duration was repaired separately; Instant accepts only a BigInt.
This bounded audit is not a claim about every host/guest boundary.

## Core reconciliation

The same private PlainTime module has existing uncommitted host-brand adapters.
Reconcile those with their copy tests: captured getters preserve private fields
independently of shadowing properties, reject forged brands and proxy traps,
and admit tracked null-prototype exports. Native and backend constructors must
both be checked. Cross-cutting copy/snapshot/public wiring remains uncommitted;
the results below qualify the current working tree, not an isolated complete
Temporal implementation.

## Checks

- Node 22: six selected files, 98 tests passed: private storage, copying,
  retained-data/structured-clone boundaries, public construction, snapshots,
  and replay.
- Package TypeScript no-emit check passed.
- Focused ESLint passed for the core, storage and copy tests.
- Node 26.8.1: 37 tests passed across storage, copy and public coercion files,
  including native-host copy cases.
- Node 18.18.2: 35 tests passed across storage, public construction and coercion.

Full-suite failures, including locale behavior and replay timing, remain open.
No CLI appearance changed. Commit locally only under the release hold; no push,
release or issue closure. Preserve unrelated staged Safe Bash changes.
