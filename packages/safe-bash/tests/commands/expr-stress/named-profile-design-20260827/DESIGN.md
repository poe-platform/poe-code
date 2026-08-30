# Qualified named UTF-8 encoding: bounded design, not product acceptance

Date: 2026-08-27. Accepted source: `21220b465537bf45ffcfb36740956a69f43bf75e`.
This delegated leaf owns this new evidence directory only. Product files remain
read-only. No root/export/shared-protocol/client/worker edits are authorized.

## Exact proposed names and category selection

Resolve each category independently from the command's explicit `context.env`:
first nonempty `LC_ALL`, then its own `LC_CTYPE` or `LC_COLLATE`, then nonempty
`LANG`, otherwise the deterministic virtual default `C`. Empty strings do not
override a later value. Whitespace is nonempty and is not trimmed. Do not consult
`process.env`, installed host locales, filesystem locale files or ICU. Do not
validate an irrelevant category eagerly for arithmetic or literal values.

The exact existing encoding names are `C`, `POSIX` (byte) and `C.UTF-8`, `C.utf8`
(Unicode scalar). The only proposed additional encoding name is `en_US.UTF-8`,
the exact spelling authenticated by the original ten-case evidence. It selects
UTF-8 scalar character interpretation, NOT C classification or byte collation.
This is an explicit encoding qualification, not a claim to implement that locale.
No suffix/prefix matching, case folding, aliases, modifiers or path loading:
`en_US.utf8`, `en_US.UTF8`, `en_us.UTF-8`, `EN_US.UTF-8`, `en-US.UTF-8`,
`en_US.UTF-8@x`, `C.UTF8`, `C.utf-8`, `UTF-8`, `de_DE.UTF-8` and every other
unlisted name remain unsupported for character operations. Additional exact
spellings require separate qualification; this proposal does not invent approval.

Existing string comparisons continue to accept only `C`, `POSIX`, `C.UTF-8`,
`C.utf8` in the independently selected COLLATE category. Every nonnumeric relation
(including equality/inequality and ASCII operands) refuses `en_US.UTF-8` or any
other unlisted COLLATE name. Integer comparisons and arithmetic remain unaffected.
No `Intl.Collator`, Unicode normalization or C ordering relabelled as named collation.

## Inspected interface and minimum safe change

`internal.ts:utf8Profile` currently gates character operations using CTYPE only;
`requireByteCollation` selects COLLATE separately. `evaluate.ts:call` already uses
scalar stepping for length/substr/index; its colon and match paths forward a boolean
to the matcher. `index.ts:createExprCommand` closes over the actual command context
and sends the descriptor to `session.matchExpr`.

`ExprMatchDescriptor` has exactly `kind`, `pattern`, `profile`, `limits`; profile is
`byte | utf8-scalar`. `validateExprInput` rejects extra descriptor keys. Neither
selected locale category is carried to `bre-worker.ts`. The worker parses brackets,
uses ASCII class tables and ASCII ranges, and refuses class/non-ASCII-subject
combinations in scalar mode. Therefore merely broadening `utf8Profile` is unsafe:
ASCII named-locale classes/ranges would otherwise be accepted with C semantics.

No new protocol is needed for a deliberately conservative qualified subset:

1. In `internal.ts`, retain exact category selection and broaden only the encoding
   allowlist to the single additional spelling above. Keep collation's four names.
2. In `internal.ts`, add an internal budgeted bracket-admission helper. If BOTH
   effective CTYPE and COLLATE are existing baseline names, leave existing worker
   behavior unchanged. Otherwise scan the original pattern bytes from left to right,
   treating backslash plus its following byte as one escaped unit. On the first
   unescaped `[` refuse the entire BRE BEFORE worker dispatch, regardless of subject
   bytes, whether matching could reach it, negation, empty subject or ASCII content.
   UTF-8 continuation bytes cannot equal ASCII backslash or bracket, so this is a
   lexical admission screen, not a replacement regex parser. Never unescape or alter
   the pattern. Escaped literal `\[` remains admissible; paired backslashes before
   `[` leave an actual bracket opener. A trailing escape still goes to the existing
   worker's syntax handling. Existing word/alphabetic-escape refusals stay unchanged.
3. Call the helper in `index.ts`'s existing matcher closure, after encoding selection
   and before `session.matchExpr`. Preserve existing pattern/subject byte ceilings
   before a new scan (same status 3 and `regex input bytes limit exceeded` diagnostic),
   charge scan work against the existing invocation Budget, check cancellation, and
   compute remaining worker steps AFTER the scan. Use a bounded linear scan with
   no AST, unbounded copies or host regex evaluation. Refusal is status 2 with no
   stdout. Matching/captures/backreferences remain in the existing bounded worker;
   do not change lifetime/session cleanup, reply validation or descriptor shape.

This rejects ALL bracket expressions when either category is outside the baseline:
ASCII ranges `[a-z]`, classes `[[:alpha:]]`, equivalence/collating syntax, and also
literal/negated lists `[a]`, `[^a]`, `[é]`, `[[]`. That last group is a deliberate
conservative limitation, not a claim those constructs necessarily need locale data.
It also refuses classes when CTYPE is C but COLLATE is named, as explicitly requested.
An invalid bracket pattern can receive the admission refusal instead of a later BRE
syntax diagnostic in these previously unqualified profiles. C/POSIX/C.UTF-8/C.utf8
pairs retain their original worker syntax diagnostics. Mixed C byte/UTF-8 category
controls specify virtual policy, not cross-codeset native POSIX parity.

Plain literals, dot, first captures and length/substr/index under named CTYPE work
without class/collation tables. `LC_CTYPE=C, LC_COLLATE=en_US.UTF-8` still uses BYTE
character interpretation for plain matching. Unknown COLLATE alone does not block
dot/literals or character indexing. Unknown CTYPE does not block numeric operations
or a string comparison with explicitly qualified COLLATE. There is no universal
invocation-wide locale rejection. Existing untrusted backreference limits/refusals
are not relaxed; admitting syntax to the worker is NOT a guarantee it succeeds.
The sequencing author's lazy-evaluation design and Curie's nullable research remain
out of scope. No new assertions about inactive-branch evaluation are made here.

## Exact proposed diagnostics

- Unqualified character encoding: `expr: character operations require C/POSIX, C.UTF-8/C.utf8, or qualified en_US.UTF-8 encoding\n` (status 2).
- Nonnumeric unqualified collation: retain `expr: string comparison requires C/POSIX or C.UTF-8/C.utf8 byte collation\n` (status 2).
- New bracket admission refusal: `expr: unsupported BRE: bracket expressions require C/POSIX or C.UTF-8/C.utf8 LC_CTYPE and LC_COLLATE\n` (status 2).

These are proposed bounded English diagnostics, not GNU locale-message parity.

## Historical ten and control provenance

`HISTORICAL10.json` is an exact structural copy of the ten namedLocale rows in the
accepted original `c-profile-gap-review/frozen/CASE_MATRIX.json` at evidence commit
`6580859f176b3fc172b78a42f50a339576744190`, with its original
SHA-256 and pointers. Expected/actual tuples, original failures, inputs, profiles,
native argv0/path, provenance and all Unicode bytes remain unchanged. The matrix
describes historical candidate `27a7793526830768484885afba5832bf8bb248b5`, not the
currently accepted source. No historical mismatch is reclassified or overwritten.

The nine proposed scalar successes are unicode-length, unicode-substr, unicode-index,
unicode-regex-dot, unicode-capture, unicode-combining-not-graphemes,
utf8-whole-prefix-span, utf8-shifted-first-span and combining-first-span.
`unicode-collation` remains an explicit refusal and therefore a mismatch against
the original GNU 9.7 Darwin expectation, NOT a pass. Combining marks are individual
scalars, not graphemes. No normalization is introduced.

`CONTROLS.json` contains separately authored design expectations, not new native
observations or an implementation acceptance suite. `policy-model.mjs` executes
only the proposed category/admission policy, not a product plugin. Its outputs are
checked against those frozen expectations by the explicit opt-in `verify.mjs`.

The optional accepted-source runtime experiment builds a clean immutable Git archive
of all accepted source with its tracked package/build configuration, never live
product files or live dist. It replays original named invocations (still ten
refusals), then runs the nine character inputs under explicitly DIFFERENT C.UTF-8
controls to isolate existing scalar capability. Those transformed controls are
labelled counterfactuals, keep the original env beside the changed env, and do not
establish named-locale support. They do not implement or propose environment aliasing.
Worker backreference controls use that accepted scalar profile and preserve its
limits. No new native process oracle, nullable research or global test suite runs.

`MANIFEST.json` binds the complete owned evidence file inventory except itself.
Verification rejects added/missing/changed owned entries, including directories via
the complete recursive file inventory and directory inventory, before and after
execution. Runtime scratch is created only after precheck and removed before final
postcheck. Accepted archive source/config files are checked before/after build and
runtime, including new entries under src. This is not a whole-worktree gate.

## Required reconciliation before product edits

Root must assign `src/commands/expr/internal.ts` and the matcher admission hunk of
`src/commands/expr/index.ts`, reconciling the sequencing author's overlapping index
proposal. This leaf does NOT own those files now. `evaluate.ts` and `syntax.ts` need
no change for this minimum design; the sequencing author retains those paths.
The repeat author retains `bre-worker.ts`. No shared protocol/client/worker paths
or new product module paths are requested. Root should accept the disclosed broad
bracket refusal as the bounded supported subset before implementation. If selective
bracket-list admission is required instead, it needs an explicitly owned and reviewed
grammar-aware gate (or a separately approved protocol/worker category design); do
not silently weaken the guard or add category metadata to today's exact descriptor.

No product acceptance, nine newly passing named operations, full named ctype/collation,
GNU/Linux parity, superiority, global gate or 72-hour completion is claimed.

## Primary category references only

P1: POSIX.1-2017 XBD 8.2, official Open Group page, consulted via web.run 2026-08-27:
`https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/V1_chap08.html`.
Nonempty ALL/category/LANG precedence, implementation-defined default, and
cross-codeset-category qualification inform this design; virtual C default and
explicit refusal policy are product choices, not universal native behavior.

P2: POSIX.1-2017 expr ENVIRONMENT VARIABLES, official Open Group page, consulted
via web.run 2026-08-27:
`https://pubs.opengroup.org/onlinepubs/9699919799/utilities/expr.html`.
CTYPE governs byte interpretation/classes; COLLATE governs ranges/equivalence/
collating elements and nonnumeric relations. UTF-8 encoding alone supplies neither
locale classification nor collation. No nullable normative research was duplicated.
