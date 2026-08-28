# NP1 independent contract findings

## Scope and decision

Root's useful, optional, injected-provider direction is coherent. It excludes native
subprocess/eval fallback, ambient filesystem/process authority, npm/npx product
commands, core runtime dependencies and default-bundled claims. Keep `safejs` and
`node` distinct. Offering `readFileSync` or a synchronous return value requires real
guest-synchronous behavior, not an exposed Promise or source rewrite.

**HOLD** concerns below are design completeness and qualification gates, not bugs
observed in a product. No execution occurred. References A1-A8 and D1-D10 resolve
in `SOURCES.json`; local byte bindings do not authenticate uninspected dependencies.

The updated A4 report supports a possible same-engine internal intrinsic route.
This review does not repeat its call-flow analysis or infer experimental success.
Root has already chosen to permit an explicitly supplied, version-bound private ABI;
asking again for a public export or calling that route impossible would be wrong.

## Documented differences that are already honest

Do not turn declared restrictions into false defect reports:

| Area | Official fixed baseline | NP1 qualification retained |
| --- | --- | --- |
| CLI | Node documents print as eval plus printing its result (D1). | One expression, primitive result, explicit formatting, no REPL or fake version. This is deliberately narrower. |
| Streams | Writable `write` reports buffering/backpressure; it is not a completion promise (D4). | Guest-blocking sink completion then boolean true is an explicit serial virtual profile, not Node event-loop parity. |
| JSON require | Missing resolution throws MODULE_NOT_FOUND; cache is by resolved filename (D2). | N12 **already labels** ENOENT as preserving VFS errors, not Node diagnostic parity. No N12 correction is requested. |
| Modules | ESM JSON uses mandatory type attributes; builtin named/default exports have specified relationships (D3). | NP1 JSON modules mean CommonJS JSON require only; ESM JSON/local executable modules remain explicitly excluded. |
| Process | Node permits a larger exitCode domain and has process.exit; unresolved top-level await can imply 13 (D5). | NP1 exitCode-only integer0..255 and no process.exit are restrictions, not full process compatibility. Completion of unresolved jobs still needs a profile rule. |
| Files | Node exposes more overloads, Buffer/URL inputs and unsynchronized promise I/O (D6). | Text-only, limited flags, no buffers/transactions/host descriptors, and no implicit concurrency or atomic-write claims. |
| Authority | Node's permission model is not a hostile-code sandbox (D8). | Qualified interpreter plus granted VFS authority is a separate trust design; Node permissions do not establish it. |

The POSIX path-only profile, exported-env copy, inert NODE_OPTIONS/NODE_PATH,
virtual execPath, rejection of process internals, and caller/control precedence are
appropriate explicit constraints. Do not replace these with host values to improve
apparent compatibility. None of this accepts the whole NP1 profile yet.

## Seven bounded findings

### R1 — Close the language and intrinsic inventory

A1 section 3 lists broad syntax and JSON/Promise operations, but not a closed set of
constructors, prototype methods, JSON overloads or property semantics. Agent JSON
editing needs predictable primitives, not an arbitrary subset discovered at run time.
For example, Array.map/Object.keys, JSON.stringify's replacer/space/toJSON behavior,
Promise construction, and guest Error creation are not settled by saying “arrays,”
“plain records,” or “bounded JSON.” N10 requires Promise.resolve/then; N18 requires
a meaningful SyntaxError name; these must be guest objects, not host capabilities.

**Required binding:** list exact syntax, intrinsic members, arities, argument and
return types, receiver rules, callback admission, mutability and charge points.
Keep JSON keys such as `__proto__` and `constructor` inert and round-trippable;
refusing host escape must not erase ordinary JSON data. For a first slice recommend
one-argument JSON.parse; JSON.stringify(value) plus the useful numeric indentation
form `(value, undefined, 0..10)`; defer revivers/replacers/toJSON invocation unless
explicitly supported and metered. This is a proposal, not an adopted restriction.
Do not infer unspecified methods from a provider's wider engine dialect. H08/H11.

### R2 — Deny-by-default grants need their own negative proof

A2 grants **all eight operations including dataWrite** by default. N15 reaches a
read-only VFS and catches EROFS; it does not test absent write authority. N17 proves
a proposed source confinement boundary, not every module/data path combination.

**Required binding:** exact absent/empty grant validation, each request's purpose
matrix, denial catchability/code, and metadata-resolution authorization. Recommend
JSON reads require both jsonModules and dataRead; sourceRead must not imply either.
Source stdin versus data stdin and diagnostic stderrWrite need explicit treatment.
`resolveJson(from, specifier)` must not let the provider invent a different calling
entry or invocation namespace. Requests after admission closes must not acquire.
Test forbidden traversal/symlink/alias requests at the real bound adapter, before
the underlying forbidden operation. No string-prefix or realpath-then-open fix.
All-grants, absent-write, absent-json and malformed-grants cases remain distinct.
Trusted provider JS is not made hostile-code-safe by record validation. H05/H06.

### R3 — Preparation and retained-data charging are not yet executable contracts

A1 has useful finite caps and explicitly disclaims RSS. It does not assign finite
preallocation charges to incoming argv/env/cwd, long specifiers, ancestor metadata
searches, diagnostics, retained guest graphs or repeated failed resolutions. Input
can be large before the 256KiB source check. Limits that are checked only after
host decoding or guest copying cannot establish a bounded-allocation claim.

**Required binding:** one accounting table covering preparation through retirement:
units, reservation point, debit/release, overflow arithmetic and failure route.
Include source/package metadata in finite read/call allowances, bound path scans,
charge failed cache loads and promise continuations, reserve before host acquisition,
and charge mutable cached guest data without counting an alias as a second object.
Use the proposed caps or separately propose missing ones; do not increase limits or
invent a new Shell Budget. Identify unbounded provider read primitives and refuse
strong memory claims if they cannot meet the bounded-allocation contract. H12/H13.

### R4 — The private ABI is a trusted adapter obligation, not qualification by label

A4 explicitly notes bypassed copy/journal allocation, limited identity scopes and
engine settlement that may precede owned-operation retirement. These are now the
critical provider obligations; an internal factory's existence is not enough.

**Required acceptance record:** exact engine/build/adapter/entry/closure identities,
host-supplied factory route, and actual same-instance factory/evaluator witnesses.
There must be no guessed deep import, brand manufacture, autoload, public-export
claim or engine write. A duplicate distribution at the same version is not proven
the same engine instance. A5's three additional files require fresh selected-closure
binding; this review authenticates the report, not their execution membership.

The adapter owns guest-native builtin objects and JSON cache values per invocation,
validates each ABI result before exposing it, accounts retained graphs/errors/closures,
and prevents reused GuestValueRef/PreparedEntry/host channels from crossing sessions.
Do not fresh-copy cached JSON on every return; do not export a host object to preserve
identity. Charge branded values that bypass ordinary copying; no replay guarantee.
Keep raw caller/control provenance outside guest errors, with explicit presence for
undefined rejection reasons. Creation/prepare/stop/close failure and late completion
all need tracked cleanup. A declared implementationId is an identity label, not a
certificate. Actual qualification needs changed-source and wrong-provider controls.
H09/H13/H15/H16 extend the contract; Locke's seven engine experiments stay separate.

### R5 — Complete the job, failure and output-closure selection rules

“Drain the admitted guest job graph” leaves an unresolved guest-only Promise, late
rejection handling, and uncaught unawaited failure timing insufficiently bound.
Node's TLA exit13 is not automatically NP1's local-limit124. Neither a host event
loop becoming idle nor an opaque unresolved promise proves cooperative retirement.

**Root choice:** if module mode remains, specify no-live-host-work unresolved TLA
and guest-only pending-job outcomes. Recommend a declared NP1 local deadline124
after cooperative closure, not a Node13 parity claim. Also specify when an unhandled
guest rejection becomes terminal and whether later handling can precede selection.
Do not let an ordinary fs-error catch bypass a raw caller/control/local limit.

N30 correctly leaves outer Shell policy unbound and forbids sibling cancellation.
But the closed stdout call's guest-visible completion and raw-handler outcome must
also be bound: return/throw/terminal selection, subsequent guest scheduling and
stderr behavior. Preserve admitted sibling work and cleanup; do not solve it by
whole-session abort or claiming every public pipe is no-acquisition. Freeze raw and
actual Shell observations separately, including an escaping handler error mapped
by Shell versus genuine root-caller rejection. N27/N28/N30/N31 are not executable
byte oracles where their fields are still null. H14/H16/H17.

### R6 — Define text, option, directory and exclusive-write contracts

Replacement decoding is explicit, but source BOM handling does not settle raw data
BOM versus JSON-module BOM. The pinned Node JSON loader strips a leading BOM (D10);
do not strip it from all readFileSync text merely because a default decoder does.
Bind byte-split UTF8, trailing malformed sequences, lone UTF16 surrogate encoding,
and exactly which API accepts `{encoding:'utf8',flag:'wx'}` versus a string option.
Unsupported callback/options must not run or coerce getters before refusal.

Readdir needs an exact return type, option refusal and ordering profile. Prefer
controlled provider-order receipts for unsorted native-style results, not unannounced
sorting or a universal native order oracle. Promise writes to the same file need
controlled scheduling and an explicit nontransaction qualification; no arbitrary
global serialized-order claim. `wx` needs actual exclusive-create support: refuse
unsupported authority instead of check-then-write emulation. No cancellation rollback
or full-file atomic replacement is promised by the text API. H10/H11/H18.

### R7 — Freeze CLI and outcome schemas, not broad failure matching

The finite CLI table should enumerate empty source versus missing operand, `--`,
long forms including equals spelling, conflicting selectors, input-type with a
file, and script argument tails. Preserve declared string argv; do not let a guest
`--inspect` argument become a host option. `--version` remains a real refusal.
Virtual `__filename`/`__dirname` are currently absent under the “other globals” rule;
document that common script idiom gap or propose them explicitly, not accidentally.

Before executable admission, close Entry/Limits/InvocationState/GuestDiagnostic,
HostRequest/HostReply and terminal Outcome schemas: finite own-data fields, absent
versus undefined, integer ranges, bounded text and exact discriminants. Existing
N36 names accessors/extras, but missing/inherited/holey/coercing records and malformed
terminal outcomes must also refuse without a host call or generic success.
Keep the scoped diagnostic grammar, status2/1/124/127 classes, output-cap omission
and failing-stderr propagation. Bind the remaining individual diagnostic bytes and
null statuses before their tests; a generic error regex is not a repair. H01/H02/H06.

## Minimal useful delivery option — not a silent NP1 amendment

**Recommend CJS-first as an explicit root-selected slice**, still conditional on a
qualified genuine-sync provider. Keep `-e` statements, `-p` primitive expression,
explicit `.cjs` script and stdin source; argv/env/cwd/exitCode; fd0 text input;
serial string stdout/stderr; JSON parse/stringify and basic record/array indexing
and loops; text sync and promise fs through async functions; the listed POSIX path
functions and CommonJS JSON cache. Require only the grants the invocation needs.
This already supports reading JSON, changing a field, serializing it back to the
authorized VFS, extracting a pipeline value and setting a nonzero result status.
H03/H04 supply exact useful program oracles rather than factory-success checks.

Defer `.mjs`/TLA, ambiguous `.js`/extensionless package scans and directory listing
from that first slice; they remain planned NP1 work, not passes or deleted cases.
No process.exit, timers, fetch, Buffer, packages, local JS graph or npm/npx; no claim
that scripts using those work. Indentation support is the R1 proposal, not required
for the already representable compact JSON editing example. This is not an
async-only rebranding and is not proof that the provider implements CJS grammar.

Alternative: retain **all original NP1** before first delivery; then R5 module/job
and R6 directory/R3 package-scan bindings are first-gate prerequisites. The 36-case
denominator stays 36 in either option. A different finite slice denominator, if
root selects one, must be separately frozen rather than rescoring the original.

## Root decisions and separate acceptance gates

1. **Delivery scope:** explicit CJS-first slice (recommended) or full original NP1.
   Do not revisit settled optional injection/private ABI/no fallback directions.
2. **Finite profile:** ratify the author's declared Node differences, choose R1's
   exact intrinsic/option inventory and R2's purpose-grant matrix, then require the
   author to supply the accounting/schema tables. N12 stays its labeled ENOENT case.
3. **Outcome boundaries:** bind unresolved guest jobs and closed-output semantics;
   approve exact per-case raw/Shell diagnostics, not a blanket error category.

**Gate A, design:** choices above, schemas and all expected outcomes sealed. This
packet alone does not pass A. **Gate B, provider:** separately authorized finite
actual same-engine experiments, authentic loads, sync/job/guest-value behavior,
allocation, wrong-instance/no-fallback and cooperative cleanup evidence. The
source-only A4 conclusion and historical A7 SafeJS workflows do not pass B.
**Gate C, command:** actual installed/moved qualified provider, strict options/types,
root/subpath surfaces if authorized, real VFS/stdin/output and source-varying
programs, raw/Shell lifecycle, finite budgets and scoped negative controls. No
successful stub, version string, static presence or package bytes can substitute.

Acceptance would establish only the selected, version-bound virtual NP1 subset on
the qualified provider/adapters. It would not establish full Node, bundled default,
arbitrary packages, hostile trusted-host isolation, Node timing, native parity,
remote-service transactions, RSS bounds or overall completion of the user's node
requirement. The independent holdouts are prospective data, not a new engine GO.
