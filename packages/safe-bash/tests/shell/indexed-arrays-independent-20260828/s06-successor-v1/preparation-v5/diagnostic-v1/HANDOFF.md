# Finite SOURCE/DATA diagnosis — no new execution authorization

2026-08-28. Follow-up to14179c5e; no candidate, compiler, native oracle,
private engine or mutant was executed. No product/fixture expectation was edited,
no staging was removed. **No verified new product counterexample to assign to
Faraday follows from these failures.** Two rows contain identifiable reviewer
assumptions; one shared adapter lacks the phase evidence needed for a product
verdict. This is not acceptance or a rescore of the consumed attempt.

## Authenticated inputs and observation limits

The full437-record archive was decoded and compared byte-for-byte, including
modes, with every retained raw record. Archive SHA256
`3dbb6dc3708156e0c895b04aacf78f508322b6b08336acff78a6aa53cd707a0c`;
raw records116,980,358 bytes. The index is independently bound to committed
14179c5e bytes, SHA256
`f7976df7cef3c0e747f0e998f1ee2b6dbaac7f2342f954fb6ab21f7364a8485e`.
All269 source inputs and108 sealed roles remain authenticated. See
DATA-AUTHENTICATION.json for exact source paths/hashes, raw failed rows and
loaded-mutant observations. This DATA check itself executed zero candidate cases.

All source line references below mean the **admitted c0ada/30f source**, located
under `../RUN-ARRAY-S06-20260828-02/source/`, not current live production.
`src/shell/runtime.ts` SHA256 is
`ce770214b1f712b2e8f6fde9290ca4b4f0d89ea5f71ad98274e165d95a1ac9cd`;
its actually loaded JS SHA is
`ecac8e40fa3a650008cf852f955813c4c78928586b6b9265c64f1d0de8e12a80`.
Reviewer adapter references mean unchanged `../../preparation-v3/complete-adapter.mjs`.

| Layout | M22 record | P04/P09/P10 record | Actual failed rows |
|---|---|---|---|
|source-build |body-6.json |body-7.json |M22, P04, P09, P10 |
|installed |body-13.json |body-14.json |same four |
|moved |body-20.json |body-21.json |same four |

These six worker processes completed/reaped; each failed row emitted generic
`settled:true, disposed:true`. Those booleans are **not numeric cleanup counts**:
worker.mjs:69–76 emits them after the adapter returns/throws. The adapter's
mandatory finally/unsafe-error path provides additional facts described below.
body-24.json also preserves the fourth M22 failure in the before-mutant cohort.

## M22/P04 — primary check reached, failed private-state snapshot

Exact script for each subphase:

```bash
a=([0]=first [2147483647]=last); __drive
```

`__drive` is the registered reviewer bridge at adapter:35–43, not an ordinary
shell builtin. It captures the actual Runtime frame, registers cooperative
cleanup, and runs adapter:120–137:

1. Outer `runtime.arrayZero(state, 'a', expand)` admits a target/watch.
2. RHS increments `effects`, performs inner `arrayZero(a, () => 'newer')`, then
   actual `readonly a` through `runtime.builtin`.
3. Readonly subphase returns `outer`; caller subphase first aborts with the
   frozen `{kind:'array-publication-caller'}` object; escaping subphase throws
   `{kind:'array-expansion-escape'}` instead.
4. Expect exactly one RHS effect; require an error; require `/readonly binding/`
   for readonly, or exact object identity for caller/escaping; then expect
   `[[0,'newer'],[2147483647,'last']]` from the private store.

**Actual:** all three layouts, and the before cohort, fail only at the last
snapshot assertion: `[]` versus that two-entry expectation. The earlier effect,
error-presence and selected subphase reason assertion were necessarily reached
and satisfied in the failing call. That does **not** identify which subphase:
adapter:263 evaluates readonly, caller, escaping sequentially in one object
literal, and no completed-phase receipt is emitted before a later throw.

The public `Shell.exec` primary is stored at adapter:47 but not published on
failure. Callback assertion failure is rethrown at:55 **before** the public
caller-identity/result check at:56–57. Consequently neither the public primary
identity nor all three precedence branches can be certified from this row.
Do not substitute the AssertionError for a product execution reason.

**Source-supported explanation, not a new observed fact:** root array cleanup
is enrolled at arrays/state.ts:26. InvocationScope.close starts owned callbacks
and child closure together (cleanup.ts:43–54). ArrayOwner.drain waits holds,
then releases children/admissions (arrays/ledger.ts:236–249). arrayZero releases
its hold in finally (runtime.ts:1210). After caller abort, the private store may
therefore retire before the awaiting callback's next inspection. Its lifetime
is not a promise to retain entries after cancellation. The capture lacks the
phase/timeline evidence to prove this was the particular interleaving here.

**Cleanup evidence:** adapter:63–66 necessarily completed after the ordinary
failure: awaited dispose, at least one root and monitor, each observed root's
four live counters zero, each store's bindings/watches empty. Failure there
would be tagged unsafe and would not produce this ordinary row. Numeric roots,
monitors, cleanup-callback invocations, phase count and public primary identity
were not recorded; they remain unknown, not invented as1 or3.

**Necessary versioned diagnostic/fixture proposal, not applied:** split the
three subphases into named receipts; preserve per-phase private reason identity,
public primary outcome and cleanup counts even when an assertion fails. Capture
the exact retained two-entry value immediately after inner RHS/readonly and
**before** caller abort. For readonly/escaping keep the post-rejection retained
value check; for caller cancellation separately check original public reason and
terminal empty store/live-zero state, rather than requiring a cancelled private
store to stay populated. Safe ordinary failures aggregate only after cleanup;
observer errors must not bypass cleanup. Original M22/P04 stay failed. Root must
approve any versioned expectation movement; no product patch is justified yet.

## P09 — ordinary command failure incorrectly required to reject exec

Exact script for all its variants:

```bash
a=([0]=😀); __emit "${a[@]}"
```

The registered command writes UTF-8 through the provided sink. At adapter:185–212,
two cap variants (4 then3 bytes) precede backpressure, sink-error, caller-abort.
The latter command registers cleanup that increments `cleaned` and releases
the gate, awaits the one write, then increments `after`.

**Actual all three layouts:** the sink-error assertion at:207 expected the exact
frozen `{mode:'sink-error'}` object in `outcome.error`; it was `undefined`.
Before that assertion, the code checked one write, one cleanup, and unsettled
execution while the gate was held. Thus `writes=1, cleaned=1` are confirmed for
each sink-error variant, not merely guessed from disposal. The preceding
backpressure variant likewise completed `writes=1, cleaned=1, after=1, exit0`.
The 4-byte exact emoji write and 3-byte zero-write limit rejection checks were
also passed on this control-flow path. These subfacts are not separate newly
run tests. Sink-error `after` is checked only after the failing identity assertion
and was not recorded; the final caller-abort variant was **never reached**.

**Classification: reviewer boundary assumption.** runtime.ts:1557–1580 checks
caller cancellation, rethrows escaping control/limit/syntax failures, but maps
this plain command exception to a diagnostic and status1. It is not a cleanup
failure: the registered cleanup fulfilled. The bound contract command.md:120–133
preserves the rejection **selected by the existing execution path**, and also
allows a completed nonzero result; it does not turn every sink/command exception
into a public rejection.

The raw fulfilled result/diagnostic was not emitted. A narrow P09-v2 can require
that existing path's exact source-derived result: exit1, stdout `😀` (bytes
`[240,159,152,128]`), `shell: line 1: [object Object]\n` stderr, no reason-identity
requirement for this mapped branch. shell.ts:209–219 captures the bytes before
awaiting the external sink: a rejected delivery does not erase that capture.
Retain its write/after/cleanup counts. Keep caller-abort as a
separate exact-identity branch and keep a genuinely rejecting cleanup control
separate. These are proposed expectations from source/contract, **not observed
bytes from the old run**, and require versioned approval/preseal before execution.

## P10 — stack-only Symbol assertion incorrectly applied to plain cd

Exact script is the same `a=([0]=first [2147483647]=last); __drive`.
The callback creates VFS `/next`, then directly invokes, in order:
`getopts a flag -a`, `let counter=2`, `shopt -s dotglob`, `pushd /next`, `popd`.
Each must return0/change the monitored epoch. It checks flag=`a`, counter=`2`,
dotglob=true, cwd=`/`, then invokes plain `cd /next` and demands both epoch and
`directoryStackCwdPublication` Symbol change. Finally it would invoke `__noop`.

**Actual all layouts:** the five earlier status/epoch checks and state assertions
were reached/satisfied. Plain cd returned0 and changed epoch; the second
assertion at adapter:225:52 failed because the stack Symbol was unchanged.
The later `__noop` and final cwd assertion were not reached. Public primary
outcome and numeric cleanup counts were not emitted; the same terminal
live-zero/store-empty finally checks as M22 completed.

**Classification: reviewer assumption, not missing mutation coverage.**
runtime.ts:2953–2956 writes OLDPWD/cwd/PWD and invokes an optional stack hook.
Only directoryStackBuiltin supplies the Symbol-changing hook at:3004–3006.
Plain cd does not. The epoch-change requirement already passed here.
Proposed P10-v2: retain all earlier checks; explicitly require marker change
for pushd/popd, and marker equality for plain cd alongside epoch/cwd/PWD/OLDPWD
checks. Preserve the final invoke. Do not change the product or the historical
P10 result to make this assertion green.

## Mutant routing — preserve10 loaded /9 activated /8 kill predicates

- **U08:** no package/load/activation was attempted. Its same-candidate M22
  predicate failed in body-24; dispatcher correctly blocked it. The mutation
  swaps readonly/stale checks in arrayZero, changed JS SHA
  `8cc9ec1edaacd0aa06643936b955b0a9551bbbf8349118877273adeee6569279`.
  After an approved phase-labelled M22-v2, use its readonly phase as the
  designated failing predicate, caller/escaping as specificity companions;
  require clean original positives first. No existing kill is inferred.
- **U09:** actual runtime SHA
  `04f5b3b4c49fa6cf4255bb24f93b40f533549d12586b86be9bc75564e79abe87`
  loaded and emitted one first-hit activation. It replaces array-members
  expansion with one concatenated member. S01 (`a=[A,B], b=[C,D]`, word
  `"${a[@]}:${b[@]}"`, expected argv `["A","B:C","D"]`) actually captured
  `["AB:CD"]` and failed as intended (body-36's exact assertion diff).
  O15 (`a[7]=tail`, positional `[left,right]`, word `"${a:-$@}"`) retained
  expected argv `[left,right]`. The source fast-path at runtime.ts:3674–3681
  splices the alternate before the mutated members branch at:3686. O15 is a
  useful unaffected companion, not a required casualty of this mutation.
  Proposed U09-v2 keeps all case and mutant bytes unchanged; requires S01 fail
  **and O15 pass**. Preserve the original two-failure predicate as unsuccessful;
  do not rescore body-36 under the proposed predicate.
- **U11:** actual changed runtime SHA
  `636da6d2400ac6ad4f9b82f13a0e30c8be5e2c8612ec47562ad7354300e52485`
  loaded, but zero activation events; P06 passed. It changes the scalar arm
  inside `typedSavedVariables` restoration (runtime.ts:2110–2113). P06 changes
  only scalar `context.env.a`; even its unrelated-array variants leave that
  array untouched. `typedEnvironment` at:1953 is therefore false, the ordinary
  overlay path at:2000–2013 does not prepare typed saved records, and the
  mutated expression is never reached. This is an exact route mismatch, not
  a loader failure or product survivor. The sealed activation stop was correct.

  Proposed bounded U11-v2 route: add an explicitly versioned mixed-overlay
  companion, rather than changing P06. Initialize `a=A; b=([7]=tail)`; middleware
  for `__overlay` sets `env.a='B'` **and** `env.b='overlay-b'`, then awaits next.
  Script remainder:

  ```bash
  __overlay() { a=B; }; __overlay; __capture "$a" "${#b[@]}" "${b[7]}"
  ```

  Expected capture `["A","1","tail"]`, empty stdout/stderr, exit0 under the
  ratified scalar-equality/typed-restoration profile. The indexed b collision
  admits typed saved records for both keys; a's record has no indexed binding,
  selecting precisely the mutated scalar arm. Add the finite `a=C` neighbor
  expecting `["C","1","tail"]` to disallow blind restoration. These are
  source-derived proposed inputs/expectations, unexecuted; require exact load,
  activation, original positives and designated rejection before any kill claim.

U12, actual-loaded S06 reversion and all four restored-after cohorts remain
unrun. No new dispatch, new seal or new grant is requested by this diagnosis.
The current guard is not weakened to accept a loaded-but-unactivated mutant.

## Mechanical qualification and raw ownership

Each21/22 result comprises **15 other successful specified checks +5 mixed
checks +1 SOURCE-ONLY check**, with M22 failed. M21 is the source-only acyclic
ownership argument; M03/M07/M14/M15/M20 combine specified dynamics with bound
source premises. Many other rows use loaded private helpers, not public limits.
M01/M02 private near-ticket hooks and M14 F4/F128 qualifications remain. Neither
21 dynamically closed obligations nor universal allocation/RSS bounds follows.

Owned raw root (created fresh by the sealed dispatcher) is exactly:
`/Users/kjopek/Workspace/safe-bash/tests/shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v5/RUN-ARRAY-S06-20260828-02`.

| Child directory | Regular files | Descendant dirs | File bytes |
|---|---:|---:|---:|
|source |269 |44 |2,506,887 |
|build |1,244 |100 |9,362,019 |
|tools |247 |29 |26,147,198 |
|apps |3,893 |223 |25,700,664 |
|artifacts |12 |0 |9,454,924 |
|scratch |565 |19 |2,138,323 |
|records |437 |0 |116,980,358 |

Total192,290,373 bytes; all seven root names match, no linked/unknown/changed
members; exact census hashes/modes are in DATA-AUTHENTICATION.json. The retired
U11 app remains inside apps. Earlier U01–U10 app paths were intentionally reaped
by the original dispatcher; reading U09's former path during DATA inspection
found ENOENT, not a new candidate failure. Its exact load/census records remain.
All349 actual children remain recorded retired, final active0; no new product
children or cleanup actions were taken in this diagnostic.

**Cleanup proposal only:** after root approval and a fresh exact archive/census
check, the437 owned raw `records/` files can be removed as duplicates of the
byte-and-mode-verified committed archive, recovering116,980,358 bytes. Leave the
six other directories (75,310,015 bytes) intact for now: the record archive
contains their censuses but is not a byte archive of every generated staging
file. A separate approved archive/rematerialization decision must precede their
removal. Never remove a member that fails the exact census, an added file, a
foreign untracked scope, the external tool tree, or any previous attempt.

**Root routing:** no speculative product fix; authorize only the narrow versioned
reviewer deltas above if desired. M22 public primary/phase evidence remains
genuinely unobserved. All old failed rows, outcomes, grants and qualification
history stay immutable. This finite handoff closes the SOURCE/DATA task, not the
array implementation acceptance.
