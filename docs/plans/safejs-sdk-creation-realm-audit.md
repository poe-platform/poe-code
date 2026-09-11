# SDK creation realm audit

Built ESM probes at local 5159ca99e, after the maintained build passed, compare
values created during run with values created by an exported closure after run
cleanup. The eight native controls all satisfy Object.getPrototypeOf(value) ===
the originating constructor.prototype. No production code changed for this
audit. The source suite remains running against its recorded digest.

Each SDK probe returns [Object.getPrototypeOf, () => expression, C.prototype],
calls the factory after run cleanup, then calls both the originating exported
getter and a getter exported by a second run. These are supported SDK calls,
not only observations through the internal budget-free prototype helper.

| Expression | Originating SDK getter matches | Other-realm SDK getter matches | Data copy after SDK creation |
| --- | --- | --- | --- |
| ({}) | No | No | Accepted |
| [] | Yes | Yes | Accepted |
| new Array(2) | Yes | No | Accepted |
| new Uint8Array(2) | Yes | Yes | Rejected |
| new Map() | Yes | Yes | Rejected |
| new Set() | Yes | Yes | Rejected |
| new Date(0) | No | No | Accepted |
| new String("ab") | No | No | Accepted |

Data-copy rejection is "Guest prototype links and custom descriptors cannot be
copied as data." The same eight values created during run all permit data
copying. This validates a creation-time asymmetry, not permission to discard
custom guest prototypes during serialization. Preserve pristine defaults and
reject lossy copies of modified chains.

The internal budget-free helper finds originating links on during-run array
literals and Uint8Array only in this probe. After-cleanup creation additionally
links Map and Set. The new Array case demonstrates why internal-helper absence
alone is insufficient evidence: its originating SDK getter still succeeds via
the retained budget fallback, but a getter from another realm returns the wrong
prototype. That cross-realm failure is observable evidence requiring a fix.

Further work must add failing native-backed tests before changing each creation
path. Include ordinary literals, Array constructors and methods, Date, boxed
primitives, Map/Set, prototype mutation, realm separation, and data-copy/replay
behavior. This is a bounded inventory, not full JavaScript conformance.

The first ad-hoc tsx source probe failed before execution because its CommonJS
loader could not resolve generated Intl data. Results above come from the
successfully built native ESM artifacts, not that failed probe. No source or
test files were changed, and no release or push was triggered.
