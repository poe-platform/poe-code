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

## Remaining Reflect method directories

The same pinned, strict, in-memory procedure was applied to the remaining nine
Reflect method directories on Node 22.23.2 while runtime sources stayed fixed.

| Directory under test/built-ins/Reflect | Guest passes | Native passes |
| --- | ---: | ---: |
| defineProperty | 12 | 12 |
| set | 18 | 18 |
| setPrototypeOf | 14 | 14 |
| preventExtensions | 10 | 10 |
| get | 11 | 11 |
| has | 10 | 10 |
| isExtensible | 8 | 8 |
| apply | 9 | 9 |
| construct | 10 | 10 |

All 102 additional cases passed unchanged (eb479b, 04cc17, b9b32b, d0376a).
There were no metadata exclusions or failed native controls. Combined with
the earlier four Reflect directories, this qualifies 149 selected top-level
method fixtures across all 13 Reflect methods, plus the 54 separate Object
accessor fixtures. It does not cover nested directories or other Test262
areas that exercise Reflect, and is not full Reflect conformance.

Full-package session 94973 remained running at the latest observation
(211240). No second full-package process was started and no runtime source
changed. These read-only passes do not supersede its eventual result.
