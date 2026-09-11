# Proxy array identity

Three cases failed with two passing controls on e9b9dc6e7 (75323): Array.isArray
returned false for Proxy-wrapped arrays and failed to reject revoked targets.

Follow private Proxy target links without invoking traps, checking revocation at
every hop. Use an iterative, step-budgeted walk; preserve ordinary Array.isArray
behavior for arrays, objects, typed arrays and primitives. Other internal array
identity consumers need separate integration.

Verification: 20 tests across two files, TypeScript and scoped lint passed
(48143). Expanded nesting-budget cases plus concat/primitive regressions passed
34 tests across three files and test lint (98184). After simplifying test types,
the final six-test identity file, lint and diff check passed again (52735).
Public construction, callable identity, snapshots and
remaining consumers are incomplete.
