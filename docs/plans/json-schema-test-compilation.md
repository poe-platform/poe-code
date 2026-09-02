# Reuse compiled schemas within conformance groups

## Improvement

The JSON Schema conformance fixture compiled the same schema separately for
every data vector. Compile once in each schema group's `beforeAll` hook, then
retain one independently reported assertion per vector. This removes 1,586
duplicate compilations: 640 schema groups instead of 2,226 data vectors.

Each group owns its compiled schema. There is no process-wide cache, test-result
reuse, production change, concurrency change, registry reduction or removed
schema/vector. Keeping compilation in a named group hook attributes preparation
failures to the relevant draft, fixture and schema group.

## Validation

- Original fixture: all 2,226 assertions pass.
- Revised fixture: all 2,226 assertions pass with exactly the same ordered full
  names and statuses, despite the additional schema-group suite structure.
- Each compiled schema also passes its vectors forward, in reverse, then forward
  again: 6,678 successful validations across all 640 groups. This checks that
  reuse does not contaminate later validation calls.
- Entire `toolcraft-schema` source test selection: 2,281 assertions pass.
- Observed original/revised fixture windows: 3,924.531 / 1,130.073 milliseconds.
  This single co-loaded local comparison is not a full-suite or CI guarantee.
- Reports: `/tmp/poe-json-schema-baseline.json`,
  `/tmp/poe-json-schema-candidate.json`, and
  `/tmp/poe-json-schema-package.json`.

Commit and push this improvement separately; confirm publication through the
release workflow rather than treating a successful push as a release.
