# Native promise property admission

The current copy path intentionally imports settlement but omits own properties.
Two tests reproduce loss of explicit string and user-symbol properties.

Blind copying is unsafe: Node 22 attaches enumerable async-hook symbols and
AsyncLocalStorage stores to promises. A read-only probe created a promise inside
a storage context, disabled the storage, then observed that the context symbol
remained on the original promise. A user-created Symbol("kResourceStore") has
the same description and descriptor flags, but is a distinct valid user key.

Node's [AsyncLocalStorage implementation](https://raw.githubusercontent.com/nodejs/node/v22.23.0/lib/internal/async_local_storage/async_hooks.js)
allocates a distinct symbol per storage instance and propagates its store onto
async resources. Description-based filtering cannot establish key ownership.

A question has been sent to the user: require explicit host selection of
permitted property keys, or retain settlement-only imports. Until that choice
is resolved, do not copy arbitrary native promise properties or weaken the
isolation boundary. Continue independent validated JavaScript fixes.

## September 10 runtime comparison

A fresh read-only probe creates promises under two separate AsyncLocalStorage
instances, then disables both instances and inspects only own-symbol identities
and descriptor flags. Node 22.23.2 (778eee) and Node 18.18.2 (2e3d52) expose
enumerable async_id_symbol, trigger_async_id_symbol and kResourceStore keys.
The second promise also carries a second distinct kResourceStore key: observing
one storage instance does not identify all context keys. Disabling the instances
does not remove these existing own properties.

The identical probe on Node 26.8.1 exposes no own symbols (cd4e0e). This is a
bounded runtime observation, not proof that every host Promise on that runtime
is metadata-free. It also means a native-only check on that runtime cannot
qualify the supported Node 18/22 boundary. Neither symbol descriptions nor a
single sampled identity list establishes a safe general admission policy.
