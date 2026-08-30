# Candidate-private review bindings — Plato handoff

Documentation-only receipt, 2026-08-28. Ownership: this new file only. This is a
static binding map, not an adapter implementation, executed terminal observation,
product verification, or independent acceptance. All source references below are
to the fixed candidate, never the documentation commit's HEAD.

## Immutable binding

| Identity | Exact value |
| --- | --- |
| Source/tests candidate | `50117fc54fdfd650e8f57e84b82ba21297ab8a0f` |
| Last product change | `c7dae6e884d1a144266dfc1bb80785bf007a667f` |
| Author evidence commit | `38b2318d052e6db344a02bce3b637e8642114b29` |
| Selected base | `37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e` |
| Composed source identity | `d6c17f62d2d3062b5ab074044a86b8a455820373` |
| Author package SHA256 | `0fadca03da4e100c7dd5b7df0a25d321467f9f1f9fbd288ebcc4456746945d26` |

The handoff calls the composed identity a computed tree identity, not necessarily
a stored Git object. It describes a selected projection, not the entire candidate
checkout: 265 selected inputs plus four array modules, then three owned consumers/
tests and explicit driver configuration. Do not substitute a moving checkout,
rebuild from unrelated live inputs, or label an instrumented artifact with the
unmodified package hash. Package contents were not extracted or verified here.

Source Git blob bindings (all under `src/shell/arrays/`):

| File | Candidate Git blob |
| --- | --- |
| `ledger.ts` | `c0c1a4ba292e26696b792b024019a79ce241cb89` |
| `bindings.ts` | `c686048897bbd7fa797ba6982a255a543afbe6a3` |
| `state.ts` | `021459790e7aa5d03b6cac2d786a77643fa2f2aa` |
| `syntax.ts` | `8faad2d7757c68156d24f7aa5a07ab77c411a14d` |

Read author documents at the evidence commit: `FOUNDATION-HANDOFF.md` (blob
`6c468796c20104bc7e80a507875fb2735c51cb35`), `FOUNDATION-AUDIT.md` (blob
`863f7883e8a63f9388cb8abaa5807e76898d0e3e`), and `FOUNDATION-SEAL.json` (blob
`5f33c41fcdedfb21a802a47acfcca6f5cbdbc3a5`), in this directory. Their reported
results are author evidence, not newly reproduced results.

## Existing private entry points

These are exports of internal source modules, not promised package-root exports
or supported package subpaths. An executor can import their exact source files
through its authenticated TypeScript/ESM loader; internal imports use `.js`
specifiers. All cooperating imports must resolve to the same module instances:
duplicate `state.ts` or `syntax.ts` instances have different WeakMaps. No installed
private-import layout or public diagnostic API is established by this receipt.

Signatures below omit TypeScript parameter-property modifiers, not arguments.
`State`, `InvocationScope`, `Word`, and `WordPart` are existing imported types;
their implementations/contracts are not redefined here.

### `ledger.ts`

| Export / anchor | Callable surface |
| --- | --- |
| `ArrayFailure`, line 1 | `constructor(detail: string)`; extends `Error`, prefixes detail with `indexed array: `. |
| `Charge`, line 5 | Exported interface: optional readonly numeric `wrappers`, `slots`, `payload`, `metadata`, `allocatedSlots`, `work`; optional readonly `generation`, `version`, `epoch`, each `boolean \| number`. |
| `Tickets`, line 17 | Exported interface: readonly numeric `generation`, `version`, `epoch`. |
| `Admission`, line 26 | `constructor(ledger: ArrayLedger, wrappers: number, slots: number, payload: number, metadata: number, generation: number, version: number, epoch: number)`; `release(): void`. Obtain accounted instances from reservation, not direct construction. |
| `ArrayLedger`, line 54 | `constructor(bytes: number, fields: number, initialTicket = 0)`; getter `active: boolean`; `snapshot(): { readonly caps: readonly number[] \| undefined; readonly used: readonly number[]; readonly lastIssued: number }`; `reserve(charge: Charge = {}): Admission`; `release(admission: Admission): void`; `checkpoint(signal?: AbortSignal, units = 1): Promise<void> \| undefined`. |
| `exactSum`, line 136 | `exactSum(left: number, right: number): number`. |
| `ArrayOwner`, line 143 | Private constructor; `static create(ledger: ArrayLedger, parent?: ArrayOwner): ArrayOwner`; `assertOpen(): void`; `reserve(charge: Charge): Admission`; `adopt(admission: Admission, prepaid = false): Admission`; `hold(): Admission`; `detach(admission: Admission): void`; `close(): Promise<void>`. |

`Admission` exposes its constructor properties plus `previous`, `next`, `owner`,
`released`, `cleanup`, and `restorationReferences`. `ArrayOwner` exposes readonly
`ledger`, `parent`, `header`, and `completion: Promise<void>`. Low-level `detach`
and ledger `release` are not observation helpers: use `Admission.release()` for
ordinary release so accounting, cleanup, and linkage remain coordinated.

### `bindings.ts`

| Export / anchor | Callable surface / readable data |
| --- | --- |
| `controlNames`, line 4 | `ReadonlySet<string>`: PATH, PWD, OLDPWD, HOME, CDPATH, IFS, OPTIND, OPTERR, OPTARG, REPLY, LANG, LC_ALL, LC_CTYPE. Do not mutate it. |
| `OwnedText`, line 8 | `constructor(value: string, bytes: number, admission: Admission)`; `retain(): this`; `release(): void`; readable constructor properties and `references`. |
| `textToken`, line 24 | `textToken(owner: ArrayOwner, value: string, signal: AbortSignal): Promise<OwnedText>`. |
| `Element`, line 40 | Exported interface: readonly `text: OwnedText`, `slot: Admission`. |
| `IndexedBinding`, line 45 | Private constructor; `static create(parent: ArrayOwner): IndexedBinding`; `get(index: number): string \| undefined`; `retain(): this`; `release(): Promise<void> \| undefined`; `insert(index: number, text: OwnedText): void`; `copy(signal: AbortSignal): Promise<IndexedBinding>`; `indices(owner: ArrayOwner, signal: AbortSignal): Promise<number[]>`. Read `owner`, `values: Map<number, Element>`, `maximum`, `generation`, `version`, `references`. |
| `BindingWatch`, line 148 | `constructor(store: BindingStore, name: string, watch: Watch, admission: Admission)`; `valid(): boolean`; `close(): void`. Read constructor properties and captured `generation`, `version`, `typedVersion`. Prefer `store.watch` over manual construction. |
| `BindingStore`, line 176 | Private constructor; `static create(parent: ArrayOwner): BindingStore`; `get(name: string): IndexedBinding \| undefined`; `watch(name: string, operation: ArrayOwner, signal: AbortSignal): Promise<BindingWatch>`; `retire(name: string, watch: Watch): void`; `tickets(name?: string): Admission`; `changed(tickets: Tickets, name?: string): void`. |
| `BindingStore` publication, line 234 | `prepareName(name: string, operation: ArrayOwner, signal: AbortSignal): Promise<{ readonly name: OwnedText; readonly admission: Admission } \| undefined>`; `publish(name: string, binding: IndexedBinding, tickets: Tickets, prepared?: { readonly name: OwnedText; readonly admission: Admission }, restoring = false): Promise<void> \| undefined`; `remove(name: string, tickets: Tickets): Promise<void> \| undefined`. |

Store fields are `owner`, `epoch`, `bindings: Map<string, NamedBinding>`, and
`watches: Map<string, Watch>`. `Watch` and `NamedBinding` are **not exported type
names**, but their records are readable through these maps. `Watch` has numeric
`generation`, `version`, `typedVersion`, `observers`, plus `admission` and
`name: OwnedText`; `NamedBinding` has `binding`, `name: OwnedText`, `admission`.
Do not write map entries, tickets, or reference counts to manufacture a terminal
state. `retire` is the internal decrement path; normal observer release is
`BindingWatch.close()` or its operation-owner cleanup.

### `state.ts`

| Export / anchor | Callable surface |
| --- | --- |
| `trackState`, line 18 | `trackState(state: State, budget: { readonly limits: { readonly maxExpansionBytes: number; readonly maxExpansionFields: number } }, scope: InvocationScope): State`. |
| Lookups, lines 32–36 | `stateMonitor(state: State): StateMonitor \| undefined`; `arrayStore(state: State): BindingStore \| undefined`; `requireArrays(state: State): BindingStore`. The last activates storage; it is not a passive lookup. |
| `StateMonitor`, line 42 | `constructor(raw: State, session: Session)`; `activate(): BindingStore`; `restoration(resource = false): Restoration`; `openOverlay(frame: OverlayMap): void`; `closeOverlay(frame: OverlayMap): void`; `overlayFrames(): Iterable<OverlayMap>`; `prepareCollection<Value extends object>(value: Value, field: string): Value`. |
| `StateMonitor` publication, line 110 | `prepareTypedPublication(name: string, owner: ArrayOwner, signal: AbortSignal): Promise<() => void>`; `retire(permit: Restoration): void`; `restore(permit: Restoration, action: () => void): void`; `mutation(name?: string): Admission \| undefined`; `finish(tickets: Admission \| undefined, name?: string): void`; `publish(tickets: Tickets, name: string \| undefined, action: () => void): void`. |
| `Restoration`, line 232 | `constructor(monitor: StateMonitor, admission: Admission \| undefined, resource: boolean)`; `apply(action: () => void, close = true): void`; `close(): void`. Read `monitor`, `admission`, `resource`, `epoch`, `holding`, `next`, `previous`. |
| `snapshotState`, line 256 | `snapshotState(state: State, clone: () => State, signal: AbortSignal, prepare?: (destination: State, owner: ArrayOwner) => Promise<void>): Promise<State>`. |

`StateMonitor` exposes `raw`, `proxy`, `store`, `epoch`, and `session`. The
non-exported `Session` shape is readonly `ledger: ArrayLedger`, readonly
`scope: InvocationScope`, and `owner: ArrayOwner | undefined`. `OverlayMap` is a
non-exported `Map<string, { superseded?: boolean }>` intersected with a private
symbol-keyed parent link. `overlayFrames()` can enumerate linked frames when the
monitor is known; there is no exported symbol or restoration-list enumerator.

`trackState` uses budget-object identity for the session, walks `scope.parent` to
the root, and registers `() => registered.owner?.close()` before creating the
first owner. Both raw and proxy state keys are enrolled. A retained state gives
the passive chain `stateMonitor(state)?.session.ledger.snapshot()` and, after
activation, `stateMonitor(state)?.session.owner`. Merely knowing a Shell instance
does not supply that State reference through any export in these four modules.

### `syntax.ts`

Exported types: `LiteralIndex` (`readonly decimal: string`), `ArraySelector`
(`{ kind: "element"; index: LiteralIndex }` or
`{ kind: "members"; separator: "@" | "*" }`), `ArrayEntry` (optional readonly
`index: LiteralIndex`, readonly `value: Word`), and `ArrayAssignment` (element:
`kind`, `name`, `index`, `append`, `value`; compound: `kind`, `name`, `append`,
readonly `entries: readonly ArrayEntry[]`; all fields readonly).

| Anchors | Function signatures |
| --- | --- |
| Lines 24–43 | `literalIndex(source: string, offset: number): LiteralIndex`; `numericIndex(index: LiteralIndex): number \| undefined`; `arraySelector(source: string, offset: number): ArraySelector`. |
| Lines 45–65 | `setArraySelector(part: WordPart, selector: ArraySelector): void`; `getArraySelector(part: WordPart): ArraySelector \| undefined`; `copyArraySelector(original: WordPart, copy: WordPart): WordPart`; `setArrayAssignment(word: Word, assignment: ArrayAssignment): void`; `getArrayAssignment(word: Word): ArrayAssignment \| undefined`. |
| Lines 84–120 | `elementAssignment(word: Word): Extract<ArrayAssignment, { kind: "element" }> \| undefined`; `compoundHead(word: Word): { readonly name: string; readonly append: boolean } \| undefined`; `compoundEntry(word: Word): ArrayEntry`. |

These expose metadata only for known AST object identities. The two WeakMaps
cannot be enumerated; they provide no terminal-count or cleanup diagnostic.

## Terminal observation map

| Requested observation | Existing binding and exact interpretation | Boundary / gap |
| --- | --- | --- |
| Live logical counters | `ledger.snapshot().used[0..3]`: wrappers, private Map/WeakMap slots, payload bytes, metadata. Corresponding caps: F, F, B, 128F. Arrays returned by `snapshot()` are copies. | Observe after relevant cleanup settlement, not just after command output. This is logical accounting, not JS reachability, heap, or RSS. No built-in peak/history recorder. |
| Cumulative counters | `used[4..6]`: allocated bytes, allocated slots, reserved work. Caps: 8B+512F, 8F, 32B+256F. Every reservation adds metadata64 and work15; allocated bytes charge payload plus charged metadata; allocated slots default to requested slots. | `Admission.release()` refunds only indices 0–3. Terminal cumulative values are not required to be zero. Snapshots taken only at the end do not measure peaks. |
| Ticket state | `snapshot().lastIssued`, each retained admission's `generation/version/epoch`, store/binding/watch identities, monitor/store epochs. A single tentative cursor serves generation, version, epoch in that order before demand counters commit. | `initialTicket` is an explicit private construction seam, not a public option. No separate per-kind cursor getters or issued-ticket history. Released tickets do not refund; a restored state epoch is not the ledger cursor. |
| Watches | `store.watches.size`, iteration of its records, `watch.observers`, retained observer `admission.released`, captured versus current identity fields. Last observer calls `retire`, removes the table entry, and releases table/name admissions synchronously. | `BindingWatch.#closed` is inaccessible; `valid()` compares identities, not closure/liveness. A closed watch can still report valid. Store discovery is not global. |
| Bindings/text | `store.bindings`, binding `values`, element `slot.released`, text `admission.released` and explicit `references`. | Cached `maximum`, ticket fields, and retained object references are not terminal live-counter getters. Root drain is not a promise to zero every exposed refcount/field or garbage-collect retained objects. |
| Owners/admissions | Retained `owner.parent`, `header.released`, `completion`; retained admission `released/owner/previous/next`. `assertOpen()` is a refusal probe. | No owner count, child/head enumeration, closed/started getter, or outstanding-hold counter. `#head`, child/sibling links, `#holds`, and lifecycle flags are native private fields. External casts/property reflection cannot expose them. |
| Cleanup settlement | `owner.close()` returns that owner's preallocated `completion` every time. Root close seals admission, waits root holds, drains children then admissions with checkpoints, and releases its header. A `hold()` returns a releaseable admission. | Only root drain waits the root hold barrier. `completion` has no synchronous status getter; record fulfillment/rejection by awaiting/attaching handlers. Do not call close merely to make an integrated terminal result look clean. |
| State/restoration | Known monitor's `epoch`, `store`, `session`; retained permit's `admission`, `holding`, `epoch`; `overlayFrames()`. | Session/monitor WeakMaps, wrapped-object map/count, restoration-list head, publication flag, permit/watch closed bits, and runtime-owned saved-state inventories have no exported census. |

`caps` stays undefined until a successful reservation commits; `active` is not an
owner-open or cleanup-complete flag. Terminal all-live-zero accounting is an
observation to collect, not a pass asserted here. Awaiting a retained root's
completion and then inspecting all retained stores can support private cleanup
evidence; proving that public exec/dispose settlement includes that barrier still
requires an actual integrated observation at the executor's boundary. No such run
or inspection of shell/cleanup implementation occurred in this handoff.

## Lawful seams versus instrumentation

- **Unmodified private units:** instantiate `ArrayLedger`, `ArrayOwner.create`,
  `BindingStore.create`, and `IndexedBinding.create`; retain their real objects;
  use existing reservation/watch/close operations and snapshots. A provided real
  State/budget/scope can use `trackState`. Synthetic State/scope stand-ins test only
  the exercised mechanism, not actual Shell registration or settlement. Private
  reduced B/F or near-MAX initial tickets do not establish attainable public caps.
- **Existing cooperative hooks:** direct private `snapshotState` accepts `clone`
  and optional awaited `prepare`; private methods accept signals/checkpoint via
  the ledger. These can expose controlled interleavings in private tests. No
  public Shell option injects these callbacks in the inspected modules. Calling
  `requireArrays`, `reserve`, `hold`, or `checkpoint` changes behavior/accounting
  or scheduling; none is a passive observation call.
- **Integrated reference capture without editing product files:** an executor
  may disclose a harness wrapper around the same loaded class's
  `StateMonitor.prototype.activate`, retaining `this` before forwarding the exact
  original call. This exposes its session even if activation throws. Wrapping
  `ArrayOwner.create`/`BindingStore.create` can retain successful creations.
  These are instrumentation of existing methods, not shipped diagnostic hooks;
  preserve receiver, arguments, return/promise identity, thrown errors, and call
  order. They do not capture every inactive monitor or prove complete admission/
  owner discovery. Capture must be installed before execution in the identical
  module graph, and its coverage/authentication must be demonstrated separately.
- **Copied-source/loader work, if independently authorized:** exposing lexical
  session/monitor inventories, all constructor events, or native-private owner/
  restoration internals requires additional instrumentation, not a fabricated
  property accessor. Ordinary ESM namespace reassignment is not a lawful way to
  replace an exported function binding. Any copied-source transform or loader
  rewrite must disclose original hashes, exact delta, transformed hashes, loader
  identity and actual loaded paths; distinguish that run from the sealed source/
  package. No such adapter, wrapper, copy, transform, or run was created here.
- **No inference by replacement:** reimplemented ledgers, parallel synthetic
  stores, inferred zeros from a successful exit, or a parser-only helper are not
  observations of the candidate's invocation-owned state. External registries of
  observed owners/admissions can describe captured events only; they are not a
  hidden product census. Retention and hooks themselves also affect host memory
  and potentially scheduling, so disclose those limits.

## Proof separation and scoped status

The author handoff reports 32/32 groups (28 foundation/private plus four syntax),
69 public source exec calls, ten loaded failing mutants, and six flows in each
installed/moved public layout. Five foundation groups are explicitly private
mechanism units. The seal binds these author claims to capture11 and the candidate;
this receipt did not execute or independently authenticate the capsule/package.
Neither those counts nor this map discharge the separate 33 semantic vectors and
22 mechanical obligations. Public source/package behavior, private mechanism
evidence, and instrumented terminal observations must remain distinct.

Per user authority, independent prep `703eccb1`, evidence `9a3f7103`, and G4A
`6c2c155d` are synthetic only: not inspected, replayed, rescored, or promoted here.
No independent expected fixtures were read. Work was limited to applicable AGENTS,
the three committed author documents, four exact candidate array modules, Git
metadata, and this new document. No tests, product/native/oracle/network/XAN/YQ/jq
execution; no shared/source/public/root changes; no new cohort. Remaining gaps:
actual integrated object capture and terminal settlement evidence, complete
owner/admission/restoration census, and public reachability of private limit
boundaries. These remain with Plato's independent executor/reviewer, not this leaf.
