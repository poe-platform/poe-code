---
title: Generator public properties and private execution state
---

# Generator own-property gap

Expanded native-oracle qualification has 14 failures and two passing controls
across 16 cases (`/tmp/poe-safejs-generator-own-properties-expanded-red.log`).
It also reproduces deletion of `channel` corrupting execution, frozen-generator
failures, ignored symbol properties, accessors and own method overrides, and the
async-generator equivalent. The current Float32 accounting suite explicitly
excludes this file, so these findings are not counted as passing coverage.

Implementation inspection identifies separate integration points: interpreter
assignment/deletion and method dispatch, object-model descriptor/prototype
lookup, own-key enumeration and integrity operations, retained-data accounting,
and portable guest-generator capture/validation/restore. Public property storage
must be separate from `state`/`channel`, and snapshot restoration must register
the generator identity before hydrating self-referential public descriptors.

Implementation separates public descriptors in a WeakMap from the channel and
execution-state fields. Reads, writes, deletion, object reflection, for-in,
coercion, integrity operations and custom prototypes use that public storage.
Iteration respects cached own next methods and dynamically read return/throw
overrides without replacing the private channel operations.

Portable generator heap nodes now include optional objectState, preserving old
nodes that omit metadata. Capture/restore retain descriptors, symbol aliases,
cycles, custom prototypes and frozen state. Hydration follows identity
registration. Retained-data measurement captures descriptors before visiting
callbacks, follows metadata and enforces budgets; graph depth sees public data.

Qualification expanded from 14 failures/two controls to 40 passing focused
tests. Additional red tests reproduced for-in exposure of runtime keys, ignored
coercion and iteration overrides, inherited undefined-property checks, readonly
generator prototypes and retained-callback mutation. A four-file generator and
restore cohort passed 149 tests before the final additions.

The direct portable-heap test checks restoration without source reexecution;
pending-effect cases additionally cover frozen aliases/symbols, overridden next,
overridden return, accessor properties and custom prototypes. Symbol identity is
checked against the restored symbol binding, not the host realm's Symbol.for
registry. Forged scope references are checked at the public restore boundary,
where scope-role validation runs; the local descriptor validator alone is not
that security boundary.

The complete SafeJS package suite now includes this generator test file. Only
the unresolved native-Promise import-policy tests remain explicitly excluded.

Read-only native-oracle probes after the property implementation identify the
next generator-intrinsic gaps: a default sync generator's Symbol.iterator and an
async generator's Symbol.asyncIterator are undefined instead of functions;
repeated reads of next create different functions instead of stable inherited
methods; and first.next.call(second) advances first, whereas JavaScript advances
second. These are validated prototype/method-receiver limitations, not solved
by ordinary own-property storage. Keep them on the completion inventory.

Additional probes confirm generator functions do not yet expose their default
prototype objects, assigning a replacement function prototype does not affect
new generator instances, and async generator Object.prototype.toString reports
Generator rather than AsyncGenerator. These belong with the next intrinsic
prototype/receiver change.

The first full package run passed 17,413 tests with 41 skips (507 passing files,
one skipped file, 234.03 seconds). Afterward, direct cursor-restore hardening
reproduced two failures when a generator's prototype changed after iterator
acquisition. Pending replay alone did not expose this: direct restoration must
preserve the cached private next operation without reacquiring the current
public protocol. The restored built-in cursor now bypasses that public protocol
check, while new iteration still respects prototype replacement. A clean full
qualification follows this correction and four additional tests.

Clean final qualification passed: 17,417 tests, 41 declared skips, 507 passing
files and one skipped file in 239.09 seconds. Only the native-Promise import
policy file was excluded. All 44 focused generator tests are included. Scoped
ESLint and TypeScript checks passed; the final generator/restore cohort passed
160 tests. No matching open GitHub generator issue was found to close.

Selected workspace build passed 23 dependency-closure tasks and four native
ESM smoke tests. The actual harness pair passed and its screenshot was viewed;
the screenshot route completed 70 uncached root build tasks in 61.45 seconds.
The separate eight-test intrinsic-prototype regression file was added only
after this change's full suite and selected build completed, and remains for
the next atomic improvement rather than this commit.

Read-only native-oracle probes on 2026-09-07 validate a shared object-model gap:
Object.defineProperty and Object.assign reject guest generator targets with
`TypeError: Expected a sandbox object or function`. Native JavaScript permits
both operations. Array.of with a constructor returning a generator, and Array
map with a species constructor returning a generator, hit the same rejection.

The common cause is objectProperties/isAssignableSandboxTarget explicitly
excluding SandboxGenerator. Fix this as an object-model improvement, including
descriptor writes/reads, symbols, integrity, prototype behavior, budget retention
and snapshots. Do not simply remove the exclusion without checking generator
representation and preventing public writes from corrupting private state.

Other custom species targets were checked independently: Map, Set, Promise,
Date, RegExp and Float32Array return the expected indexed values. Those results
do not establish support for generators. Add failing unit tests before changing
the object model; this plan is not a claim of completed support.

Further current-source probes confirm assignment is inconsistent with reads:
`value.extra = 2; return value.extra` returns undefined for a generator, whereas
native JavaScript returns 2. More importantly, `value.channel = "changed"`
corrupts internal state and causes `TypeError: value.channel.snapshot is not a
function` during retained-data measurement in values.ts. Native JavaScript
treats channel as an unrelated public property and next still yields 1.
Public reads of kind/state/channel are already hidden. Isolate public storage
from the interpreter's generator metadata before permitting descriptors.

The initial maintained regression suite now reproduces eight failures: assignment
visibility, channel corruption, defineProperty, assign, Array.of custom results,
Array species custom results, overriding next and overriding Symbol.iterator.
Receipt: /tmp/poe-safejs-generator-own-properties-red.log. These tests were created
and run after the Array iterator full qualification and remain separate work.
