# Foreign aggregate error members

## Validated failure

A built-runtime probe admitted a VM-created AggregateError but returned `undefined` for its `errors` property. Five regression tests reproduced lost members (including renamed errors and cycles) and inconsistent validation of executable payloads. The existing member import was gated on local `instanceof AggregateError`.

## Correction and boundary

Treat an own `errors` data property as standard payload on admitted native errors, regardless of realm, mutable name, or subtype. This intentionally also preserves an own `errors` payload attached to an ordinary native Error. Do not guess constructor identity from names, tags, or prototype constructors.

Only inspect the own descriptor; ignore inherited properties and accessors. Pass data through the existing error-data copier, retaining its function, promise, and accessor rejection rules and its shared-object identity map. Do not copy arbitrary additional properties or promote error-shaped records to native errors.

## Verification

- Foreign aggregate members, renamed errors, native errors with explicit member payloads.
- Cycles and aliases through public JSON replay, without repeating the host call.
- Function and promise rejection; own and inherited getters are not invoked.
- Existing local aggregate safety, host error identity, source exception, and snapshot/replay tests.
- Changed-file lint, maintained SafeJS workspace build and import tests, and Node 18 built-runtime probe.

## Discovered dependency

Removing the AggregateError constructor gate exposed a separate rejection: `<error>.errors: Array`. Host array admission requires the local Array.prototype identity. The experimental member correction was removed while foreign-array admission is addressed independently. Three payload/replay tests remained failing under that experiment; capability rejection must assert the specific error-data rejection rather than accepting an unrelated array-admission failure as a pass.

## Results

Foreign-array admission was delivered independently in `f724780cf`. After reapplying this correction, all 340 focused tests passed, including exact error-data capability rejection, cycles, and public replay. Changed-file lint, the 23-workspace build closure, all four built-import checks, and the Node 18 foreign AggregateError member probe passed.
