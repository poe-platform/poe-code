# Object accessor and Reflect qualification

## Procedure and scope

Read top-level JavaScript fixtures at Test262 revision
`72faf8ec1445c55149615e8b35187830783aba1a` from the directories below. Load source,
`sta.js`, `assert.js` and declared harness includes in memory. Parse metadata
with YAML and exclude negative, noStrict, async, module and raw fixtures.
Prefix strict mode; execute each native control in a fresh Node 22.23.2 VM
context with a one-second timeout, then execute in a fresh SafeJS run with an
explicit completion sentinel. Report native failures separately from guest
failures; no fixture in this selection was excluded or failed its native control.

This is a bounded source-level probe, not the official Test262 runner or full
conformance. It does not qualify sloppy mode, unsupported harness realms,
checkpoint replay, all supported runtimes or resource-limit behavior.
No upstream files were installed and runtime sources remained unchanged during
the separate full-package integration gate.

## Results

| Directory under test/built-ins | Guest passes | Native passes |
| --- | ---: | ---: |
| Object/prototype/__defineGetter__ | 11 | 11 |
| Object/prototype/__defineSetter__ | 11 | 11 |
| Object/prototype/__lookupGetter__ | 16 | 16 |
| Object/prototype/__lookupSetter__ | 16 | 16 |
| Reflect/getOwnPropertyDescriptor | 13 | 13 |
| Reflect/ownKeys | 13 | 13 |
| Reflect/deleteProperty | 11 | 11 |
| Reflect/getPrototypeOf | 10 | 10 |

All 101 cases passed unchanged (8ddbf0, 25a5a4, ffacec, 65fe16). No runtime
repair is justified by these results. The separately completed 63-case primitive
reflection probe is recorded in [the integration gate](safejs-post-json-iterator-gate.md).

At the final observation in this qualification, full-package session 94973 was
still running (756711). Silence from its JSON reporter is not a passing result.
No push, issue closure or release was performed.
