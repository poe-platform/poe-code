# Owned Temporal PlainTime core

PlainTime is one of the missing public Temporal types. Its first component is
an internal owned value: six validated integer fields in private immutable
storage, with an extensible guest-facing object and no exposed slot properties.
This is not yet a public constructor or language-support claim.

The isolated candidate at `/tmp/safejs-replay-init.fNTLBZ` passed eleven tests,
the maintained selected workspace build (23 build tasks), all five fresh ESM
import checks, and built private-value checks on Node 18.18.2. Its scoped lint
rerun is session 87715 and remains pending at integration start.

Working-tree TDD: adding the tests before the module reproduced the missing
implementation (0cce75). Only then was the candidate core brought into main.
The tests cover exact field ranges, normalized negative zero, immutable private
copies, accessor rejection without invocation, inherited-field exclusion and
forged/proxied receiver rejection. They do not touch disk or query an LLM.

The allocator accepts already converted internal numeric data. Guest constructor
coercion and from/with overflow handling belong in public adapters; they must not
be inferred from this strict internal allocator.

Remaining integration includes public construction and methods, retained-value
budgets, original-realm prototypes, host copying, structured-clone rejection,
heap/replay codecs and validation, README and CLI qualification. The core is not
exported through the SDK or installed as a guest global yet.

The full-package result on the preceding source fingerprint remains historical:
25,954 passed, two Promise-admission failures, 41 skipped. Adding these files
changes that fingerprint; focused results cannot replace a full integration gate.
No push or release is authorized while the release hold remains in effect.

Working-tree value tests passed all 39 cases across PlainTime, Instant and
Duration (7740fc). The isolated scoped lint process completed successfully
(1852d4); the integrated core/test contents are identical to that candidate.
The maintained working-tree build is session 20092 and remains pending.

That build completed successfully (0ba6d4): all 23 selected workspace build
tasks and five fresh ESM import checks passed. This qualifies the internal core
component for a local commit, not the still-missing public PlainTime integration.
