# Issue 691: bounded mapfile and readarray

Implement `mapfile` and its `readarray` alias through the existing shell input,
array ownership, parser, command, and invocation budgets. The supported options
are `-t`, `-d DELIM`, `-n COUNT`, `-s SKIP`, `-O ORIGIN`, `-C CALLBACK`, and
`-c QUANTUM`; the default destination is `MAPFILE`. No native shell or external
filesystem is used by the implementation or its unit fixtures.

## Qualified behavior

GNU Bash 5.2.37 observations are recorded in `/tmp/poe-691-mapfile-oracle.json`,
`/tmp/poe-691-mapfile-edge-oracle.json`,
`/tmp/poe-691-mapfile-raw-callback-oracle.json`, and
`/tmp/poe-691-mapfile-flow-oracle.json`.

- Default reads clear the destination, retain delimiters, and store a final
  unterminated record. `-t` strips only the delimiter. `-O` preserves untouched
  slots and accepts scalar-to-array conversion through the existing rules.
- `-d` selects the first argument byte; an empty argument selects NUL. With other
  delimiters, NUL truncates the stored record while input consumption continues
  to its delimiter. Raw bytes survive array expansion, copying, and append.
- Counts use bounded decimal parsing, including ASCII surrounding whitespace,
  leading plus, leading zeros, and negative zero. Nonzero negatives, malformed
  numbers, and overflowing values fail before reading. Callback quantum zero
  is invalid. Repeated options use their last value.
- Callbacks run before assignment, every quantum records after skipping, with
  the destination index and safely quoted record appended to their source.
  The default quantum is 5000. Callback source uses the existing bounded parser
  and evaluator; input data cannot become executable source.
- Callback writes observe the original logical binding. Ordinary reassignment
  updates that binding; unset followed by recreation leaves the replacement
  alone. Already admitted writes remain valid if a callback marks it readonly.
- Direct callback break/continue is deferred until remaining records are stored;
  later callbacks are suppressed. Function callbacks retain their own loop
  scope. Exit, cancellation, and errexit preserve their existing propagation.
- Readonly targets and invalid options fail before input is pulled. Existing
  restrictions on exported/control indexed bindings and maximum array indices
  remain in force. Diagnostics use the product's command-qualified wording.

## Ownership and bounds

`mapfile.ts` parses options and coordinates records. `ShellInput.mapfileRecord`
shares the existing cursor, retains exact bytes, charges before block allocation,
and yields during long records and empty input chunks. Every read attempt,
including skipped records, consumes the loop budget. Count-limited reads leave
subsequent input available to the next command.

Raw array values belong to `OwnedText` tokens and share their existing retain,
copy, slot replacement, and release lifetime. Valid UTF-8 records use ordinary
text tokens after charged incremental validation; invalid byte sequences retain
an admitted raw payload and display projection. Temporary record and callback
allocation scopes close after each record. No external payload map or increased
quota is introduced. A captured named-binding identity and explicit pin preserve
callback mutation semantics without repeatedly cloning the writer's own pin.

Private callback state membership is keyed by the actual State in a WeakSet and
restored in finally, including nested calls. It is never attached to public
command or middleware contexts.

## TDD evidence

- `/tmp/poe-691-red.log`: initial 11 cases fail because both builtins are missing.
- `/tmp/poe-691-raw-copy-red.log` and `-green.log`: raw FF array copying loses its
  byte before the owned-value correction; 14 tests pass afterward.
- `/tmp/poe-691-expanded.log`: the default callback quantum exposed excessive
  retained metadata at 4433 ordinary records. The valid-text token path restores
  the 5001-record control under unchanged limits; 29 tests pass in
  `/tmp/poe-691-expanded-green.log`.
- `/tmp/poe-691-raw-append-red.log` and `-green.log`: scalar-style indexed append
  preserves raw bytes after the correction; 30 tests pass.
- `/tmp/poe-691-callback-number-red.log`: direct callback loop control and numeric
  admission fail before their corrections. The final focused run passes 37 tests
  in `/tmp/poe-691-callback-number-green-final.log`.

Independent review approved callback ownership, deferred flow, numeric bounds,
and raw token lifetimes. Public source acceptance is coordinated separately by
the root agent; native oracle fixtures use supported array observations rather
than unsupported `declare -p` or index enumeration.

## Final validation

From `packages/safe-bash`, run the maintained `scripts/test-reporting.mjs` with
`--import tsx` for the new mapfile file and adjacent indexed-array, prefix-name,
parameter-transform, select, shell I/O, and private invocation lifecycle tests.
Run `scripts/integration-inputs.test.mjs` after admitting the new test path.

Focused strict types:

```sh
node ../../node_modules/typescript/bin/tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --skipLibCheck --target ES2023 --module NodeNext --moduleResolution NodeNext --types node tests/shell/mapfile.test.ts
```

Final validation completed before integration build: 394 adjacent tests pass
(`/tmp/poe-691-adjacent.log`), 100 admission tests pass
(`/tmp/poe-691-admission.log`), and focused strict TypeScript exits zero
(`/tmp/poe-691-types-final.log`).
A final public control exposed missing cumulative input admission.
`/tmp/poe-691-input-budget-red.log` records the failing buffered-input assertion;
the regression also checks cumulative streamed input, no subsequent effect, and
recovery. Activating the existing cursor admission before record allocation
passes 244 mapfile/input/select/read tests in
`/tmp/poe-691-input-budget-green.log`; strict types pass again in
`/tmp/poe-691-types-input-final.log`. No quotas changed.

Normal build, installed runtime acceptance, screenshot, final maintained lint,
remote-main delivery, and release verification are coordinated by the root agent.

Final integration qualification completed:

- Normal `npm run build` passes (`/tmp/poe-691-build.log`).
- Source public acceptance passes 116 checks
  (`/tmp/poe-691-public-input-fixed.log`). Native observations use verified
  `[[ -v "A[i]" ]]` checks for indices 0–7, `${!A@}`, `${#A[@]}`, and
  element/member values. Unsupported declaration/index-enumeration fixtures
  were replaced and requalified against GNU Bash. Product diagnostic wording
  (`mapfile: A: readonly variable` and `invalid number`) is explicitly pinned;
  status, state, and input consumption remain exact checks.
- Installed candidate `/private/tmp/poe-691-public-al6ijbj2` passes 263 checks
  (116 new plus 147 retained) on Node, Bun, browser, and actual workerd.
  All three strict public type checks pass; dependency graphs contain 47/46
  modules. Root visually inspected `screenshots/node-demo.mjs.png`.
- Final `npm run lint` passes in 193.76 seconds: all 10,521 configured files,
  zero errors/warnings, 25 receipts, plus type and workflow checks
  (`/tmp/poe-691-lint.log`).

These are local qualification results; remote-main delivery and actual registry
publication are tracked separately.
