# Initial conditional profile

2026-08-29. ROOT ratified design8266f184 and cap decision A/d959e051. Unit2 base
928be558 is now qualified accepted via fab0c099; eleven original open rows stay
unresolved. No native Bash execution/goldens in this author work.

New conditional AST uses original Word nodes, lazy logical evaluation, ordered
compound redirects and source display. Exported parseShell gains an additive
conditional variant. No default commands, public limits or registry APIs change.
4096 nodes/depth64 are grammar-complexity admission, diagnosed as ShellSyntaxError
before growth, including parsed skipped branches; not mislabeled resource errors.

Supported scalar/nonempty/n/z, basic quoted glob equality, C/POSIX collation,
literal/base signed64 numeric comparisons (empty0, expanded $#), supported VFS
metadata/access and v/o presence/options. Unknown option false. Canonical indices
0..2147483647 and @/* aggregate presence only. No names/expressions/assignments in
numeric comparison operands; general inherited arithmetic expansion unchanged.
Numeric parsing uses bounded modulo64 accumulation, matching existing literal/base
syntax without constructing arbitrarily large BigInts. Exact numeric whitespace,
array/arity and diagnostic native edge cases remain reference gaps.

Reached extglob/classes/collation features outside initial profile, regex =~,
timestamp/identity/device/owner/descriptor predicates explicitly refuse with2 and
budgeted stderr. Quoted extglob lookalikes are data. Skipped branches do not expand
or acquire resources; regex refusal creates no worker or BASH_REMATCH mutation.
Full unsupported regex/extglob lexical grammar is not a claimed Bash equivalent.
Non-C collation refuses; UTF8 Unicode strings not arbitrary non-UTF8 byte parity.

Errnos before execution: ENOENT/ENOTDIR false; access EACCES/EPERM/EROFS false;
ENOTSUP/EOPNOTSUPP/ENOSYS explicit2. Permission capability must be explicitly true
before access; unknown/false is unobservable2, not fabricated truth. Other provider
failures, cancellation, limits and sinks escape with existing identity/priority.
No ELOOP/EACCES-to-false shortcut for ordinary stat. Adapters remain trusted host
bindings; no OS permission or race-free metadata guarantee.

50 author identities=40 product-profile scripts+10 host protocols, not the frozen
40 design cases and not a native differential count. Keep original design UNRUN.
Retain unchanged Unit1-v2/Unit2/Git/apply/arrays/coherence cohorts separately.
Preparation cap35min/72children/peak3/128MiBcapture/512MiBwork includes prior
cap-decision consumption; actual grant starts only after concrete committed preseal:
60min/128ALLchildren/peak4/256MiBcapture/1GiBwork, case30s/build120s,
40 loader admissions/12 exact regex workers max (regressions only).
No native/private/engine/network/XAN/comparator/fullgate; safety/integrity/unknown
retirement stops. Source/installed/physically moved package and loaded controls
do not establish full GNU parity or hard preemption/RSS guarantees.
