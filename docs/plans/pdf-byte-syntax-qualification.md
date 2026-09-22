# pdf-byte-syntax qualification

Status: draft qualification for strict object syntax, not a document-parser profile.

The implementation is original first-party code in `packages/pdf-parser`, a
private leaf workspace with an empty runtime dependency graph. No reference
source was copied or adapted. Its license is the repository MIT license.
Research context remains pinned in `safe-bash-pdf-parser-research.md` and
`safe-bash-pdf-parser.md`: PDF.js 579c4b700f23f7782234f03358b5e9eaa3f58889,
pdf-lib 93dd36e85aa659a3bca09867d2d8fac172501fbe,
qpdf 54d6053af283bbeb8b325f4886c0f65cc51f2b80,
MuPDF 89c1d183a7fb724898b2017d6ecd402a61886d4f,
Poppler 0595ca8e76f575e5f16ccc5ee6d4b552d31b0a46.
These revisions are research provenance, not adopted runtime dependencies.

## Evidence

In-memory unit cases cover all requested scalar/container kinds, comment
terminators and NUL whitespace, decoded name byte keys, malformed name/hex
escapes, nested literal parentheses, octal truncation, unknown literal escapes,
line continuations and specification line normalization, high-bit string bytes,
truncation, duplicate/null dictionary entries, source offsets, reference
integer/generation validation, direct and two-reference cycles, quotas, invalid
offsets and cancellation before parsing and during lookup. Every split point in
a mixed syntax fixture and one-byte chunks produce identical objects.

TDD first produced a missing-implementation failure; a later numeric-edge test
reproduced unsafe decimal magnitude rounding (`9007199254740991.1`) before the
checked-token repair. Tests use no filesystem fixtures or native oracle processes.

Verification routes: `npm run test:unit --workspace=pdf-parser` (nine passing
test groups), `npm run lint --workspace=pdf-parser` (ESLint and source/test
typechecking), and `npm run build:workspaces -- --workspace=pdf-parser --no-cache`
(the maintained selected workspace build). No CLI appearance changes require
screenshots. No push or release is part of this task's verification.

Strict behavior deliberately differs from researched PDF.js recovery: malformed
numbers, unsafe magnitudes, malformed name escapes, invalid hex characters,
unterminated objects and negative reference identifiers fail. Exponent notation
is rejected in object context. Duplicate keys are retained or explicitly rejected;
literal line normalization follows PDF syntax rather than the reference lexer's
observed raw-line retention. Quota/cancellation errors never become warnings.

## Boundaries

Runtime uses standard ECMAScript byte arrays and explicit synchronous input and
lookup capabilities, with no Node imports, process, files, URLs or asset lookup.
The API owns an admitted input snapshot and output token bytes. Cancellation is
cooperative within synchronous work; callers must yield between invocations for
event-loop driven aborts. This is chunk-invariant batch parsing, not a streaming
feed API. Allocation quotas model conservative retained payload/record costs,
not exact VM heap consumption.

No dependent command integration is changed by this task. The current pattern is
`docs/plans/archive/safe-bash-command-package-pattern.md` (the requested original
path has been moved). Future command adoption must declare this leaf dependency,
bundle required first-party source and qualify packed runtime/declaration exports
using that maintained pattern. No unused public parser export is introduced.

Recovery, object graph inspection, revisions/xrefs, filters, crypto, page graph,
fonts, extraction and graph writing remain unqualified independent gates. No
PDF.js overflow, stream scanning, asset fetching or recovery policy is adopted.

## Task-diff review

The byte-syntax review reproduced acceptance of `/A{` with a failing in-memory
test. Reserved braces now delimit names, and strict object parsing rejects the
remaining brace token; hex-escaped braces remain valid name bytes. An additional
ownership test confirms input mutation cannot change returned tokens and raw
token mutation cannot change decoded bytes or sibling tokens.

The nine test groups, package lint (including source/test typechecks), and
selected uncached workspace build passed after the fix. Review found no remaining
blocking finding in this syntax increment: no proxy-only abstraction, duplicated
parser path, host access, external runtime dependency, or snapshot/version format
change was introduced. Reference lookup errors and cancellation remain propagated;
cycles and quotas remain fatal. Existing byte representations, duplicate policy
and source offsets remain intact. This is local working-tree evidence only, with
no commit, remote-main delivery or release verification.

## Independent candidate QA (byte admission follow-up)

Execute this Markdown procedure against the selected uncached build:

1. Run the maintained `pdf-parser` unit and lint routes, then
   `npm run build:workspaces -- --workspace=pdf-parser --no-cache`.
2. Read the compiled `dist/index.js` into a Node VM `SourceTextModule` with an
   empty context. Reject every import and dynamic import. Supply no process,
   Buffer, require, filesystem, network or text decoder to that realm.
3. Parse host-created bytes in the realm and realm-created bytes in the host.
   Check decoded high bytes, duplicate entries and reference-cycle failure.
   Confirm host globals are absent. This qualifies a Node VM realm, not a
   browser, workerd or Bun runtime.
4. Confirm a token quota fails with `LIMIT` and a pre-aborted supplied signal
   propagates the exact reason. Inspect the empty dependency manifest and the
   compiled graph's absence of imports; hash source, tests and compiled output.
5. Keep all fixtures in memory; retain only the receipt here. No temporary
   evidence files, command exports, host file acquisition or native oracle are
   needed. No checkpoint/replay state or visible CLI behavior changes.

TDD reproduced rejection of a foreign-realm Uint8Array before the admission
fix. Admission now checks intrinsic typed-array kind and storage length, so
overridden `length` and spoofed `Symbol.toStringTag` cannot bypass admission.
Independent deterministic controls cover every byte (0–255) in escaped names,
hex strings and octal literals, plus malformed containers/escapes at every
chunk split. No random seed is needed for exhaustive enumerated controls.

Follow-up receipt: all 11 unit groups passed with zero failures/skips; workspace
lint including source/test typechecks and selected uncached build passed.
The Markdown QA above passed on the compiled candidate in an empty Node VM
realm: no runtime imports or supplied ambient host globals, cross-realm bytes,
duplicate/null retention, cycle/quota failures and exact cancellation reason.
The initial red realm-admission test is resolved. No incomplete verification
process remains. Runtime emitted only Node's experimental VM-module warning.

Exact SHA-256 candidate identifiers:

- `src/index.ts`: `5589d1df5910ff8d1c443cce997c1a3d016e2959606c63e89c269d782e6bdcf7`
- `src/index.test.ts`: `84b95ade68f23547d024bc3af3813c468192d88fb334592d7a167060d2073d3c`
- `dist/index.js`: `04791ba261ad11c1f7e3a609abcf3f48a8e51ae1ca00abad8931440e03c6929b`

Repository-wide test/lint/build gates were not run: this follow-up changes only
the private leaf parser and its qualification document. Actual browser/workerd,
Bun and older Node versions remain unverified; the VM result is conditional
realm evidence. No native/upstream execution or bounded performance measurement
was performed. CLI/SDK command parity, screenshots, installed safe-bash exports,
checkpoint/replay and rollback of host resources are not affected by this
syntax-only change. No runtime dependency, bundled asset or ambient acquisition
capability was added. Local commits: none; remote-main delivery: none; successful
releases: none. Publication and dependent command qualification remain separate.
