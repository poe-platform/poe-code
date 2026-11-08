# Evidence and future private integration map

Source inspection only on August 28, 2026. No modules imported; no source,
product, test, build, native shell, version/help, comparator, package or private
engine executed. No network or installation. Forbidden unrelated command modules
and private checkout were not inspected. Reading a ratification's reference to
another command's error class is not importing that command's status policy.

## Authority receipts

Paths in this section are repository-relative; full commits and content hashes
are bound in AUTHENTICATION.json. They are immutable references, not old files
rewritten to match this revision.

| Label | Exact receipt and role |
| --- | --- |
| R | `7719f39e416a401588c83d355888f6b82202c109:tests/shell/declare-independent-20260828/ratification-v3/RATIFIED.md`. Sole explicit current ROOT choice of P1–P4/DC plus earlier RP/AR/RC/SL/AST approvals. |
| R detail | `3d340bbdddcda6573abfcaae49d5c9268ee531b8:tests/shell/declare-independent-20260828/policy-v2/DECISIONS.md`: P1/P2 phases, P3 table, E01–18, P4 phase table. Earlier PENDING labels preserved; incorporated choices resolved by R. |
| Independent earlier | `78ed08f009e9a9f1b8e2683655cae82027556139:tests/shell/declare-independent-20260828/{REVIEW,HOLDOUTS,PROVENANCE,SOURCES}.md`; 48 holdouts remain unexecuted history. |
| A | `2832fdf1b6fb790995e2fcfcb9b203c71a13680e` author packet and `bd5a3d34205b41b3d49d71fb805ff0f6282e62a7` attribution correction. Old DESIGN/MATRIX/PRESEAL/MANIFEST/HASHES/scripts preserved. New A labels carry fixed mechanics forward, not newly ratified user mandates. |
| I:G1–G8 | `3a363f2f9d749771a73a0e5b2f87688dbcfa02d4:tests/shell/indexed-arrays-author-20260828/PRECODE.md`; ROOT GO/G8 attributed by the array author. `2a9d59c77c9a4d94fa56d61962c5d6dfd01c189f:tests/shell/indexed-arrays-independent-20260828/closure-v1/DECISION-TABLE.md`, E1/E3 and G8; earlier `c54db6863aa96c537778cf4dc85bd104a3155e90` addendum-v3. These are not a newly located direct historical ROOT transcript. R:P2 now explicitly settles the separate +x path. |
| I:G4A | `tests/shell/indexed-arrays-author-20260828/CONTINUATION-G4A.md` at c0ada; existing registered-command post-transfer E exclusion versus new shell-private bridge work. R:SL explicitly admits new declaration formatting into the private ledger. |
| I:command/IO | `src/contracts/command.md`, `src/contracts/command.ts`, `src/contracts/io.ts` at c0ada: literal invoke, replaceEnv, borrowed cancellation, cleanup/owned-output contracts. Root/live AGENTS read in place, never copied/edited. |
| Coordination | ROOT-RESPONSE.txt is the exact relayed agent-to-leaf response, NOT a new user/ROOT normative ratification. It resolves source-tree attribution and the required R/I/A labeling; it grants no source changes. |

Two exact questions were sent via the authorized /tmp question file. The response
resolves both: distinguish fixed A mechanics from explicit R, and identify the
composition tree correctly. No remaining behavioral fork is invented or left to
an implementer. Independent design acceptance remains Dirac's task.

## Frozen successor identity, without acceptance

Inspected Git commit: `c0adae539c736db0e4023d401562ce958d9ebb00`.
Its repository tree is `d58b443e477e7b5127ea93dc30f8e8b84f16c783`, src tree
`d2f7a99d5830c0b13a9b297949c5c08ab2441228`, src/shell tree
`c597e1ad9cb7fd832b6c9270789e5a86e5c9b511`. These are NOT the selected composition.

`90811f46`'s `tests/shell/indexed-arrays-author-20260828/s06-v2/HANDOFF.md` and
SUCCESSOR-SEAL.json bind composition `30f88590b66b88dc9694a56c85f1ee690f02218b`:
265 accepted selected base inputs plus four private array modules, preserving c7
inputs except committed runtime/parser/arrays/syntax repair overlays. They report
862 package files, 787736 bytes and SHA256
`e12ed19882b6722503a8fb962ca88e0d6c40300a7e76acc3f81aef5961e0a3a3`.
Those package facts are inherited receipts, not a rehashed/extracted artifact or
a reconstructed composition. No other owner's execution claims are adopted as
this packet's proof. **FROZEN UNACCEPTED; Plato review still required.**

All 17 src/shell files were read as Git bytes for hashing; relevant code excerpts
below were inspected at that exact commit. Their live hashes matched at the
baseline; final equality is recorded separately. This selected-source seal is
not full-source/package qualification and does not inspect forbidden modules.

## C: exact source signatures and call sites; A/R: necessary FUTURE changes

Line numbers refer ONLY to c0ada, not old 50117fc5 or future edited code. These
are private module signatures unless explicitly labeled public. Export from an
internal TS module is not a root package export or an integration guarantee.

| File / inspected signature or state | Callsites and necessary FUTURE change (no code changed) |
| --- | --- |
| runtime.ts:47 `shellBuiltinNames`; :52 `implementedBuiltins`; :3155 `async builtin(context: CommandContext & IO, state: State, assignments: Map<string, SavedVariable>, diagnose?: (error: unknown, diagnostic: string) => void, suppressSpecial = false): Promise<number \| undefined>` | Neither declaration builtin is currently registered. Add the two genuine builtin routes/discovery names and one shared implementation in the future runtime; not registry defaults or a new dispatcher. Existing family at :3203 is export/local/readonly and cannot stand in as the complete declaration surface. |
| runtime.ts:188 `State`, scalar `variables: Record<string,string>`, exported/readonly sets, `locals: Map<string,SavedVariable>[]`; :168 `SavedVariable { value: string \| undefined; exported: boolean; readOnly?: boolean; getopts?: GetoptsBinding; superseded?: boolean }` | Add lazy optional INTERNAL declared-scalar membership and saved presence/barrier metadata. Existing fields cannot distinguish absent from declared-unset. Own value keys/attributes remain visible before activation; array kind wins over scalar bookkeeping. No public State/AST/option expansion. |
| runtime.ts:302 `async function cloneState(state: State, signal: AbortSignal): Promise<State>`; :343 `saveVariable(state: State, name: string): SavedVariable`; :347 `restoreVariable(...): Promise<void>` | clone uses snapshotState, clones local saves and re-enrolls typedSavedVariables at :317–329. Extend exact presence/barrier copying and save/restore; current functions have no declaration bit. Function finally :2050–2074 restores saved locals; nested ordinary unset MUST NOT invent a new frame save. |
| runtime.ts:998 `writeVariable(state: State, name: string, value: string, origin: "assignment" \| "arithmetic" \| "getopts" = "assignment"): void`; :1022 `private unsetVariable(state: State, name: string, internal = false): void` | Wire membership on actual scalar writes/removal, retaining OPTIND sync and readonly checks. :3281 unset dispatch distinguishes member/whole unset and PATH flag. Whole local unset keeps hidden owning save; :3221–3277 local integration needs exact presence without changing its established listing behavior. |
| runtime.ts:1049 `async prepareVariable(state: State, name: string, saved: SavedVariable, scalarLegacy = false): Promise<void>`; :1068 `prepareArrayObservers(state, owner): Promise<void>`; :1081 `discardVariable(saved): Promise<void>` | Existing typed saves own pinned binding/watch/name/tickets and prepay restoration. Extend declaration membership/absence and attribute atomicity; enrollment of dormant local/overlay saves must happen before new declaration activation. scalarLegacy preserves old scalar overlay behavior. |
| runtime.ts:1126 `unsetIndexed(state: State, name: string, index?: number \| "members"): Promise<void>`; :1165 `arrayZero(state: State, name: string, expand: () => Promise<string>, append = false, freeze = false): Promise<void>`; :1219 `arrayAssignment(assignment: ArrayAssignment, state: State, io: IO): Promise<void>` | :1221–1256 entry guards/range planning; :1275–1287 one RHS expansion; :1289–1303 cancellation/readonly/stale/publication/drain. Extract the finite preparation/publication roles for declarations, preserving standalone behavior, not invoking twice or reparsing spelling. Enroll all target attrs/membership/save atomically. |
| runtime.ts:1764 `assignment(word: Word): { name: string; value: Word; append: boolean } \| undefined`; :1772 `simple(command: Extract<Command,{kind:"simple"}>, state: State, originalIO: IO, inputs: Set<ShellInput>, outputs: Set<() => void>, fileShortcut = false): Promise<number>` | :1777 consumes standalone array metadata; :1782–1787 finds literal command chains but declaration context covers only export/local/readonly; :1878 redirects, :1906 dispatch. Add declaration scalar no-split/no-glob and private prepared operands with exact middleware binding, keeping prefix/redirect timing. No scalar-only middleware repair. |
| runtime.ts:1906 `dispatch(name: string, args: readonly string[], state: State, io: IO, assignments: Map<string,SavedVariable>, bypassFunctions = false): Promise<number>` | :1922 exports only defined scalar strings; :1932 context invoke; :2033–2078 function versus builtin. Validate real builtin resolution and transparent context for compounds; named print must not create locals. Scalar dispatch continues existing env/forwarding semantics. |
| runtime.ts:1090 `indexedEnvironment(state: State, env: Readonly<Record<string,string>>): Promise<void>`; :2257 `processState(context: CommandContext, state: State, arg0: string, args: readonly string[]): State`; :2772 `invoke(name: string, args: readonly string[], options: ShellInvokeOptions = {}, context: ShellCommandContext, state: State, parent: InvocationScope): Promise<{exitCode:number}>` | :2385–2398 middleware child clone and :2782–2817 invokeScoped clone/env/frame reset/quoted literal Word creation. Extend membership clearing/copying consistently; process initialization imports no unset/readonly/array attrs. Keep replaceEnv exact map, no new PWD in true mode, parent isolation and borrowed cancellation. |
| runtime.ts:2554 `scriptFile(context: CommandContext, state: State, io: IO, target: string, args: readonly string[], direct: boolean, errexit = false, loadedSource?: {path:string;source:string}): Promise<number>` | :2590–2603 parses ALL units, :2605 child then :2610 runs; preserve this order. :2620 runCurrentText and shell.ts:233–277 are unit-wise. New declaration grammar must not defer syntax errors to runtime where earlier VFS effects could escape. |
| runtime.ts:994 `diagnostic(io: IO, text: string): Promise<void>`; :1557–1579 execute catch | Existing diagnostic builds/writes text directly; ArrayFailure uses an uncaught awaited write distinct from the generic catch. FUTURE declaration diagnostics need checked private admission and DC stop-with-no-diagnostic without recursively entering this uncharged fallback. Preserve ShellLimitError rejection/EPIPE141/expansion/control/caller paths; do not globally rewrite stderr. |
| parser.ts:7 public `WordPart`; :14 `Word`; :60 `Command`; :755 `parseShell(source: string, depth = 0): Script` | Keep public signatures/shapes. :702–725 recognizes compound heads then rejects mixed command words. Add finite declaration context and authenticated private positions; reject malformed element syntax at parse even in inactive branches. :717 currently only authenticates elements while all preceding words are assignments. |
| arrays/syntax.ts:4 `LiteralIndex { readonly decimal: string }`; :12 `ArrayEntry { readonly index?: LiteralIndex; readonly value: Word }`; :17 `ArrayAssignment` element/compound union | :34 `literalIndex(source: string, offset: number): LiteralIndex`; :44 `numericIndex(index: LiteralIndex): number \| undefined`; :95 `elementAssignment(word: Word): Extract<ArrayAssignment,{kind:"element"}> \| undefined`; :112 `compoundHead(word: Word): {readonly name:string;readonly append:boolean} \| undefined`; :120 `compoundEntry(word: Word): ArrayEntry`. Reuse finite syntax/domain split; add private declaration metadata/copying, no public node/exports. |
| arrays/syntax.ts:21 assignments WeakMap, :22 selectors WeakMap, :23 quoteMarkers WeakSet; `setQuoteMarker(part: WordPart, synthetic: boolean): void`, `isQuoteMarker(part: WordPart): boolean`, :63 `copyArraySelector(original: WordPart, copy: WordPart): WordPart` | :66 copies marker with selector. :70/:74 set/getArrayAssignment bind Word identity. :78 removePrefix reuses intact parts and slices consumed text. Future declaration lowering must preserve/validate these identities and mutable contents; provenance is not serialized into public fields. |
| arrays/state.ts:18 `trackState(state: State, budget: {readonly limits:{readonly maxExpansionBytes:number;readonly maxExpansionFields:number}}, scope: InvocationScope): State`; :36 `requireArrays(state: State): BindingStore`; :256 `snapshotState(state: State, clone: () => State, signal: AbortSignal, prepare?: (destination: State, owner: ArrayOwner) => Promise<void>): Promise<State>` | :24 session shared by budget, :26 cleanup before owner acquisition; :59 activation; :170 only variables/exported/readonlyVariables are named collections; :281–282 attributes copied. Add monitored membership enrollment and snapshot traversal/charges, including activation from scalar-only listing. No new ledger per builtin. |
| arrays/state.ts:106 `prepareCollection<Value extends object>(value: Value, field: string): Value`; :110 `prepareTypedPublication(name: string, owner: ArrayOwner, signal: AbortSignal): Promise<() => void>`; :153 `publish(tickets: Tickets, name: string \| undefined, action: () => void): void`; :241 `Restoration.apply(action: () => void, close = true): void` | Typed publication supersedes matching temporary overlays; :131 restoration uses prepaid permit. Include membership/attributes/saved presence in same publication/restoration action. Whole-state epoch/name watches must see every new mutation, no finally quota request or automatic stale retry. |
| arrays/bindings.ts:24 `textToken(owner: ArrayOwner, value: string, signal: AbortSignal): Promise<OwnedText>`; :54 `IndexedBinding.create(parent: ArrayOwner): IndexedBinding`; :91 `copy(signal: AbortSignal): Promise<IndexedBinding>`; :110 `indices(owner: ArrayOwner, signal: AbortSignal): Promise<number[]>` | Existing owned immutable text, sparse maps and retained copies are reusable; new declaration selection/format roles remain preadmitted. Reuse is not proof of complete printer or free sorting. No binding-module change is inherently required by this profile. |
| arrays/bindings.ts:190 `BindingStore.watch(name: string, operation: ArrayOwner, signal: AbortSignal): Promise<BindingWatch>`; :234 `prepareName(name: string, operation: ArrayOwner, signal: AbortSignal): Promise<{readonly name:OwnedText;readonly admission:Admission} \| undefined>`; :243 `publish(name: string, binding: IndexedBinding, tickets: Tickets, prepared?: {readonly name:OwnedText;readonly admission:Admission}, restoring = false): Promise<void> \| undefined` | Watches validate generation/version (:160), store publication changes identity (:224). Reuse for staged declaration entry/export checks and stale refusal; current signature does not atomically publish declaration attributes for the caller. Runtime/state must supply that transaction boundary. |
| arrays/ledger.ts:71 `ArrayLedger.reserve(charge: Charge = {}): Admission`; :123 `checkpoint(signal?: AbortSignal, units = 1): Promise<void> \| undefined`; :164 `ArrayOwner.create(ledger: ArrayLedger, parent?: ArrayOwner): ArrayOwner`; :181 `reserve(charge: Charge): Admission`; :205 `hold(): Admission`; :227 `close(): Promise<void>` | :81–100 atomic ticket/counter order; :103 derive seven caps; :116 refunds live only. Reuse unchanged arithmetic/ownership API for new roles and diagnostics. No new public cap, new global stderr contract, or mandatory ledger source edit. |

Necessary FUTURE private production write-set is runtime.ts, parser.ts,
arrays/syntax.ts and arrays/state.ts; it is NOT this author's current write-set
and requires later explicit source ownership/GO. Existing bindings/ledger remain
reusable, not a forced expansion of that set. A lazy membership field means no
shell.ts constructor edit is inherently necessary, but actual initial-state/
clone/process/invoke compatibility proof is mandatory. No src/index.ts, package
export/default count, public types, providers, AGENTS or command-family changes.
Future tests/consumers need separately assigned ownership; none run here.

## Public shape versus private runtime identity risk

c0ada parser.ts:284 text merging clears synthetic provenance on real literal
text; :312 creates a marked quote-opening empty part; :328 makes actual empty
quotes real. Runtime :3673 excludes synthetic presence only for array-owned
words; :3678 copies selectors AND provenance for lazy alternate clones.
Consequently `"${a[@]}${b[@]}"` and `"""${a[@]}${b[@]}"` may expose identical
public parts while needing different field-presence behavior. Public shape
equality alone cannot certify runtime compatibility. Declaration prefix slicing,
copies, merges, reader authentication and middleware argv bridges add identity
paths requiring actual source/installed/moved evidence on the accepted successor.
No inference of that acceptance is made from c0ada author receipts or this map.

## Historical distinctions retained, not new observations

The unchanged original SOURCES.md H register records 16 N observations (14 outer
exit0, two127), not passes; Darwin arm64, not Linux. N01/N02 show exported-array
attributes/listing, not exported child-env bytes. N05 is GNU scalar local shadow
of an array, unlike the typed project shadow; N06 does not inspect initial kind.
N13 reports assignment0 with only index1=`rhs-write`, contradicting predicted
stale1/retained0+2; no re-execution or rescore. N14 is substitution-local readonly,
not asynchronous parent mutation; N15 retains a RHS effect despite error.

STOPPED_FINAL_INTEGRITY and the old supervisor's missing terminal group/close
deadline, incomplete final authentication, post-mkdir ownership registration,
postspawn write undercount and synthetic close on spawn throw remain historical.
Strengthened recipe requirements are neither fixes run against that supervisor
nor retroactive certification. Old GNU manual/web references are inherited
primary-reference receipts, not new research, ratification or requalification.
