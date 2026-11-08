# Indexed-array foundation author audit — 2026-08-28

This is a candidate-specific implementation map, not independent acceptance of
the closure's 33 semantic vectors and 22 mechanical obligations. The separately
executed author controls are in FOUNDATION-HANDOFF.md and the original capsules.
The authoritative G4A and G8 overrides remain in force.

## Implementation and ownership

| Area | Candidate mechanism | Author controls / qualification |
| --- | --- | --- |
| Parser/private AST | arrays/syntax.ts WeakMaps attach assignment/subscript records to existing Word/WordPart objects; parser.ts admits canonical decimal element/compound/append forms without public AST changes. | Four historical helper groups remain separate; integrated inactive-branch and script-file whole-preflight cases execute the parser. Explicit indexed operators remain syntax errors. |
| Binding kind | BindingStore owns named IndexedBinding objects, sparse numeric Maps and cached maximum. Scalars remain ordinary string variables; missing zero is not serialized into env. | Empty, absent, sparse maximum, empty zero, scalar conversion, unset element/aggregate/whole binding and append controls. DIRSTACK is ordinary storage, not magic. |
| G1 staging | arrayAssignment plans certain overflow before RHS; unknown arity evaluates once, then checks domain. A separate staged binding publishes only after readonly and watch validation. RHS effects remain live. | Static-overflow and final-stale loaded mutants fail executed assertions; empty append validates without publishing; deleting maximum scans present entries, never a dense index range. |
| G2 tickets | ArrayLedger uses one local tentative cursor for generation, version and epoch, then checks seven counters before committing either counters or cursor. | Near-MAX private unit and atomic-cursor mutant; synthetic initialization is not a public limit. |
| G2 watches | Observer records are separate from table ownership. Last external observer synchronously detaches the table/name admissions; reacquisition receives new identities. | Loaded retirement/ABA checks and retirement mutant; table slots count under F. |
| G3 snapshots | StateMonitor proxies clone-visible State, variable records, Maps/Sets, positional/local arrays, getopts and directory-stack objects, including Symbol property writes. snapshotState checks a captured whole-state epoch across cooperative copying and typed saved-state preparation. | Interleaved dotglob mutation refuses without retry; epoch-removal mutant is detected. Actual cloned local, subshell, invoke and inline-input function workflows run. No independent exhaustive writer-coverage certificate is claimed. |
| G5 ownership | Session cleanup is synchronously registered before the first private owner. Root owns children and intrusive admission lists; child-to-parent links are borrowed. Payload refcounts are separate. close seals admission and returns one preallocated completion. Root holds cover admitted cooperative work before children/resources drain. | Root-drain and overlapping-close controls, root-drain mutant, owned byte backpressure and caller cancellation; opaque registered work is not forcibly stopped. |
| G5 restoration | Typed saves reserve name/attribute storage, watches, restore tickets and work before temporary publication. Function/source/eval/command depth and cwd/status/loop controls have prepaid restoration permits. Scalar-phase permits enroll when arrays activate. | Typed local restore/save-once/readonly, scalar-local-to-array conversion, scalar middleware A/B/write-B restoration, typed supersession and clone flows. No finally-time fallback allocation is used for typed restore admission. |
| G7 bridges | Exact thirteen controls refuse indexing; exported conversion and array export refuse. read/getopts/for write element zero through checked staging. Host env uses scalar own string keys with null prototype. Explicit invoke env shadows typed bindings in the child only. | Thirteen independently listed control cases, export/readonly/local cases, read/getopts/for and own __proto__ host-key check; existing scalar middleware compatibility retained. |
| G8 expansion | Bare-name supported operators view zero with existing lazy branches. Explicit indexed operator forms refuse. Aggregate members sort numerically; repeated fragments splice left-to-right. | Scalar/indexed lazy-default, assign, alternate, error-inactive, substring, removal, global replacement, length; repeated aggregate mutant; quoted/unquoted/Unicode and empty IFS cases. |

## Logical accounting and phase boundary

Let B be the existing maxExpansionBytes and F the existing maxExpansionFields.
The seven caps remain, in refusal order: F wrappers; F private Map/WeakMap slots;
B payload bytes; 128F metadata; 8B+512F cumulative allocation bytes; 8F cumulative
slots; 32B+256F reserved work. Derivation is lazy, exact and refuses the first
unrepresentable equation. Ticket exhaustion is checked generation/version/epoch
before demand counters. Only released live ownership refunds the first four
counters; cumulative counters and issued tickets never refund or reset.

Every Admission additionally charges metadata64 and work15 for its own record,
checks and release. Role charges include owner headers/completion state, typed
wrappers128, text-token metadata32 plus UTF-8 payload, sparse/name/watch slots,
saved WeakMap entries, state proxy-map enrollment, staging copies, and vectors.
Vector storage charges metadata/cumulative slots, not the Map-slot cap. These are
logical accounting roles, not estimates of JS engine object headers or RSS.

Sparse copies share immutable OwnedText with explicit pins and independently
charged slots. A copied slot's release only removes that exact slot, not a newer
replacement. Aggregate sorting reserves two overlapping index vectors. Joins
reserve destination payload while source ownership remains live. Word assembly
charges overlapping value/pattern fields and returned tokens before argv transfer.
Snapshot scalar/name/positional/attribute copies are admitted before publication;
typed local saved references are retained separately in the destination snapshot.
Conservative root retention can refuse earlier than an optimally compact ledger;
F is not a promise of F usable array elements.

The peak notation is **private logical storage + E_input +
E_post-transfer-command-formatting**. The old 2610 illustrative private peak
remains illustrative, not a measured candidate peak. Existing registered commands'
post-transfer formatting/escaping/encoding and sink-owned output remain under
their existing Budget/IO contracts. No basic.ts/internal.ts/io.ts hooks, budget
reset, transferred-memory exemption or new public limit was added. New shell-owned
array staging, snapshots, joins and argv bridges remain on the private side.

Long private scans/copies/sorts/drains checkpoint cooperatively. Flat primitive
operations and opaque host work are not preempted; caller cancellation cannot
undo completed effects. The author evidence does not establish a combined bound
on every array-derived allocation, total invocation memory or RSS.

## Explicit proof limits

- Real public B/F controls use zero/tiny profiles and actual default expansion
  overflow at B=16777216 and F=10000. Near-MAX tickets and seven-cap units use
  deliberately lower private profiles. They do not certify every attainable public
  private-cap boundary or the full 33+22 independent acceptance matrix.
- Scoped LET/CD/STACK/DOTGLOB flows protect exercised interactions, not their full
  historical cohorts. Root STACK remains 136 qualified, C06 partial, S13 unsupported.
- Source basicCommands selects only printf/echo. Installed public consumers import
  the public root (thus loading its exports) but register only explicit custom
  record/emit/copy/nested handlers. No broad aggregate registry is executed.
- No native Bash/oracle/comparator/provider/network/private-checkout execution,
  new dependencies, public exports/options/limits, full-product gate, Bash/POSIX
  completeness, performance/superiority, 72-hour or RSS claim is made.
