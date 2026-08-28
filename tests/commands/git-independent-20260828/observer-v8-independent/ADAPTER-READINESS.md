# Candidate adapter: not yet executable or admitted

The v8 observer is independently qualified for the finite owned-fixture profile.
That does **not** admit the Git candidate adapter: the author's proposal explicitly
has `executableAdapterExists:false` and no execution command. The concrete seams
below need Dirac's new, versioned harness bytes and review, not a product fix.

All production references below are READONLY source at
`9885390fb11454fa194a3e60fdbef198dbfdf633`, never mutable working-tree source.
No candidate import/build or adapter implementation occurred in this review.

## 1. Actual iterator and forwarding

`observer-qualification-v8/retirement.mjs:60` obtains the underlying iterator by
calling `stream[Symbol.asyncIterator]()`. Replacing that same method with
`retirement.iterator` recursively re-enters it. Independent I05 actually rejects
this naive synthetic adapter after two entries; no unbounded recursion was used.

Required next helper: retain the original factory/receiver, or return a separately
sealed facade whose iterator route calls the observer while the raw stream's
factory remains untouched. Prove exact forwarding on the candidate's finite uses:
`on`, `once`, `removeListener`, `write`, `end`, `destroy`, `closed`, `destroyed`,
`readableEnded`, `bytesWritten`, and iterator `next`/`return`. Preserve arguments,
receiver, return values, rejection identity, data chunks, callback behavior and
listener removal; do not claim general proxy transparency. Record raw/facade/
iterator identities and restore exact descriptors/factory hooks in finally.

**Concrete incompatible shortcut:** `observer.mjs:135`'s `writerCodec` facade
labels every observed `once('close', ...)` as a writer close fallback. It was
qualified only when passed to the isolated writer. The actual codec has three
distinct close-listener roles: acquire-release cleanup at `codec.ts:21`, writer
fallback at45, and finalizer close waiting at99. Passing this writer-only facade
as the entire candidate codec would mislabel cleanup/finalizer listeners.
It also wraps the last write argument as the known writer callback, not every
possible public stream overload. A generic factory hook cannot infer lexical
callsite ownership from the event name. Do not apply it unchanged globally.

## 2. Private writer Promise: direct versus source-linked

The qualifier directly calls `Observer.runOperation(resource,'writer',...)` on
the isolated writer's returned Promise. A `createInflate` factory wrapper cannot
obtain the candidate's lexical `written` Promise (`codec.ts:27,54`). I04 proves
that an actually pending synthetic Promise remains HOLD even with closed stream
flags and zero pending raw callbacks. This is a discriminator, not observation
of that private candidate Promise.

Recommended minimal, no-product-change approach: an explicitly labeled
**SOURCE_LINKED_CONDITIONAL_WRITER_SETTLEMENT** proof, kept separate from directly
observed iterator operations and cleanup calls. Bind and check the exact source
chain: codec writer33–52; try assignment54; normal await84; unconditional finally
destroy97 / await written98 / close wait99 in the source's statement order; repository's
await of `inflateObject` at149; command await/query and operation.close at
`index.ts:30–33`; acquisition and shared drain in `contracts/output.ts:27–43,90–116`.
If acquisition rejects before the writer is started, do not fabricate a writer
Promise. If it starts, the source proof must establish its join before the
applicable observed invocation boundary, including every relevant caller route.
Report the static conditional conclusion, not an invented dynamic promise handle,
writer-route callback or timestamp. An unjoined/unknown route remains HOLD.

The codec's full blob is `02ad268a05e6e88edae8410c73328a65ac82d3e3`, SHA256
`442bd6956340565599afcc1e0762eb7a8d8e001fe8880e9ec8185b1e200bd868`.
Its exact33–52 extraction SHA is
`9b54d9f0b5cc73cf776b45b8c57fbc27a7f1acd8ca165306836a1b4760ed1fd6`;
the type-only surrogate is
`94b2d6b48b5981e2df17e69b5b5109a7cfe8c8e42a13692ff25badca95fa0f5d`.
D02 independently verifies that correspondence; it does not execute the codec.

If direct private-Promise observation is instead required, request ROOT approval
for an exact diagnostic loader overlay at the writer creation/join sites, with
loaded-byte proof and unchanged return/rejection forwarding. That would be an
instrumented execution, not unchanged executable bytes. No such overlay is
authorized, implemented or silently substituted here.

## 3. Per-invocation cleanup and causal errors

`m1a-review-v5/cases.mjs:13–38` contains multiple direct invokes within some groups.
It records callbacks through `context.registerCleanup`, awaits execute, then calls
and awaits registered cleanup. `worker.mjs:46–48` samples only at the whole-group
end. A new adapter must observe **each invocation**, separately capturing execute
settlement, actual host callback invocation/result/identity, cleanup settlement,
and then owned close/error notification barriers. A row-end sample cannot replace
these boundaries. Preserve existing raw semantic/FS/stream/sink checks.

The observer's `reserve():cleanupRegistered=true` is its own fixture enrollment,
not evidence that the candidate called the host hook. Keep these two facts
distinct. A57 deliberately omits the hook; `index.ts:32` still awaits its own
operation.close. Do not invent a hook or weaken that case. A60 uses the actual
Shell/plugin pipeline and bypasses the direct helper; wrap the Git definition
through the real plugin registration path or another reviewed public seam,
retaining the plugin test, execute and Shell.exec/dispose boundaries. Merely
wrapping `api.createGitCommand` does not wrap its module's lexical plugin factory.

Candidate output-operation cleanup is pre-enrolled before acquisition at
`contracts/output.ts:100`, and the outer hook is registered at68. Its `close()`
returns one shared drain. A callback wrapper must preserve callback/Promise/reason
identity where required and idempotence, including repeated registration/calls.
Enroll observation before invoking owned work; if observation fails, mandatory
candidate cleanup must still be forwarded. Source-linked internal-close order is
not a fabricated direct timestamp from a later host callback.

Do not auto-own every observed `destroy(error)`: distinguish writer rejection,
owned iterator return, known direct cleanup, and unexpected calls. Preserve raw
reader/writer/control errors before any command status mapping. A fulfilled status128
does not authenticate arbitrary errors as expected. Keep caller/escaping/cleanup
precedence and falsy reasons; unknown attribution or secondary errors remain HOLD.
The public hook remains a quiescent trusted-fixture mechanism, not hostile-caller
origin authentication. I02 specifically confirms cause-only acknowledgement does
not transfer the same Error object to another resource.

## 4. Finite capacity and minimal write scope

The proposed one-observer-per-stream arrangement avoids v8's resource2 cap across
an entire group. It still must account for operation64/trace256/reason64/token8
bounds and its proposed1024 streams/layout before candidate admission. Source
`GIT_LIMITS.maxObjectBytes` is8388608 and chunk size65536: the admitted product
range can require more than64 reader operations. Writer writes are4096 bytes with
several trace events each. Therefore this tiny qualifier's caps are not proof of
full-size candidate observability. Compute a finite census/bound for the exact
frozen fixtures or preseal a bounded aggregate observation design. Do not lower
product limits, call observer overflow a product leak, or silently omit traces.
This is a static capacity warning, not a claim that a frozen fixture actually hit
those caps; no large object was executed here. Bound aggregate trace retention
before collection as well as per-stream counts; a later file-size check does not
by itself bound the observer's accumulated in-memory snapshots.

Suggested Dirac-only write scope: NEW versioned candidate worker, codec adapter,
per-invocation helper overlay, source-proof manifest and finite recipe. Preserve
v5 worker/cases/fixtures and all outcomes; prove removal of instrumentation restores
the old helper/assertion bytes. No `src/commands/git/**`, core/contracts or root
changes are needed for this recommendation. Add small forwarding/cleanup/error
controls before freezing the actual adapter, not another broad product suite.

## Continuation status and ROOT/Sagan relay

Authenticated proposal SHA256:
`24d89f323c44cb86ea9be23880489bf7270e10fbfbab322413c44d13a34e2a42`.
It is **NOT an executable continuation seal**. No exact candidate launch command
can truthfully be returned yet. Proposed scope remains71 source +71 compiled
+71 staged +71 moved =284 groups:69 repeated source groups plus215 originally
unexecuted. The15 proposed children are4 layouts,5 type children,3 mutants and3
binding negatives; six native Git workflows remain held. Proposed600000ms
inclusive cleanup/32MiB capture/128MiB scratch/peak2 must be freshly sealed with
all adapter/loader/tool/package/case bytes and any metadata child work. It is not
covered by this observer review's12-child ceiling or an inherited larger budget.

Relay to ROOT for Sagan's separate M1B09029163 review: the v8 causal criterion is
independently qualified only as described above. Rebind the actual M1B codec,
iterator/factory, private writer/join and invocation cleanup routes before using
it. Neither M1A source correspondence nor this observer acceptance establishes
M1B resource retirement, semantics or continuation authority.
