# Pinned comparator bootstrap: static diagnosis, no policy implementation

The inspected artifact is just-bash 3.4.2's previously loaded
`dist/bundle/index.js`, SHA256
`70dd1320d921b736e965b1545e50ab57af2b2807a26de7fa624d4f519a953b7c`.
The precise call is at line 808, UTF-8 byte offset 503554 (zero based).
OBSERVATIONS.json binds excerpts and all 21 previously witnessed startup sources.
No engine was imported, no denied API was called and no bootstrap was executed.

## Actual source branches

The synchronous module-initialization try block captures
`e = process.getBuiltinModule`. If callable, it calls `e("module")`; otherwise
it calls the imported `Ks("node:module")` dynamic-require shim if callable.
It assigns `Mf = t?.Module ?? t?.default ?? null`. There are precisely three
lexical occurrences of `Mf` in this exact main bundle: declaration, assignment
and catch assignment. No subsequent read/export/reference occurs there.
This unused local is a source finding, not a new runtime observation.

The same try then requests `e("worker_threads")`; only if its `isMainThread`
property is strictly false does it request `e("crypto")` and call optional
`randomUUID`. Any throw sets `Mf = null` and exits the try. The existing V6
receipt's first `module` denial therefore precedes the other two requests.
The final export/factory observation is consistent with this catch; it does not
erase the guard violation. This is conditional bootstrap, not a workflow's
need to compile CommonJS or load a native module.

The fallback shim is imported as `Ks` from chunk-NCUTH6QL.js, whose exact hash is
`fae9347ddabceda17cfed0562a36d8dd570134e42a0d631122a6f85d7c6975f0`.
It returns the locally bound require when available, otherwise a proxy/failure
shim. Both source files prepend `createRequire(import.meta.url)` imported from
`node:module`. Keeping getBuiltinModule callable but unavailable would not enter
the fallback ternary. Removing the callable property would change branches and
is not proposed.

## Existing guard coverage and limits

V6's offline guard replaces createRequire with a bound-base wrapper. Its require
and resolve paths permit only builtins or admitted paths; the returned checked
function does not copy require.cache/extensions. Nonbuiltin loader routes retain
parent, exact URL, file membership, mode, bytes and source-hash checks. Asset
reads independently authenticate the admitted file and deny instruction content.
Native addons fail the supported source-format list; Worker/Wasm creation,
network entry points, process spawning and the listed process APIs remain denied.

This is a trusted-dependency operation guard, NOT adversarial JavaScript
isolation. Importing `node:module` is already permitted by the builtin loader
branch. The offline module blacklist covers register/registerHooks, compile-cache
enable/flush and runMain, but does not explicitly replace raw Module, _load,
_resolveFilename, _cache, _extensions, prototype.require or prototype._compile.
Its builtin branch excludes inspector/inspector-promises/vm but is not a complete
builtin capability allowlist. No composed escape through those surfaces has
been executed here; they must not be declared closed on static presence alone.
Likewise process/network patch lists are not a proof about every builtin alias
or future Node API. A new raw module return would add unnecessary authority.

Primary Node documentation consulted: versioned process documentation explains
that getBuiltinModule returns genuine builtins even across require.cache changes;
module documentation distinguishes synchronous registerHooks (including
createRequire) from asynchronous CJS hooks; CommonJS documentation distinguishes
node:-prefixed imports from cache-overridden bare names. These support caution,
not an assertion that current guards prove all raw Module paths safe.
Documentation locators are retained in REFERENCES.json. The version 22.22.2
web requests returned no usable page body, so no exact-22.22.2 documentation
verification is claimed.

## Narrow proposal for ROOT, not implemented

Prefer an explicit **bootstrap-unavailable, zero-returned-capability profile**,
if root accepts this declared host-profile difference: only during the single
authenticated comparator consumer import, admit the ordered literal feature
queries `module`, then `worker_threads`, returning undefined to both without
delegating to the native API. Close this temporary gate on either import outcome,
before factory/setup/workflow work. All other names (including node: aliases),
duplicates, order changes, later calls, crypto, caches, Module objects,
constructors and require functions remain denied. Never identify authority from
a stack substring; the binding is the trusted host's exact import phase and
source/load identities, with observed order checked. It is not adversarial
caller authentication within that phase.

This yields no Module/default capability, no _load/_compile/createRequire, no
native/network/process capability and no fallback branch. The second undefined
result prevents the worker-only crypto branch. It preserves unavailable-feature
semantics rather than pretending to return a real worker_threads or Node module.
It does not certify deferred chunks or future workflows. An unexpected request
must still make admission fail, including one caught inside the comparator.

Alternative: retain the current fail-closed profile and keep comparator admission
held. Returning raw module/worker_threads/crypto or broadly approving caught
denials is not recommended. Root adjudication and independent synthetic review
are required before implementing either a gate or any richer facade. No such
policy change is included in the separate report repair.

## Retained artifact size finding

The old RESULT.json is 531954 bytes, exceeding 262144. STAGED.json (979544),
child-003.json (685153), and receipts 001/002 (318162/317978) also exceed it.
Old save() enforced cumulative evidence bytes, not a per-artifact record cap;
worker FD3 transport did enforce a cumulative 262144-byte channel cap. These
are distinct facts, not a retrospectively successful record-cap qualification.
The report successor must shard large documents into individually bounded,
authenticated records and bound reference manifests and cumulative writes.

The original 359581-byte coordinator stdout has only its 65536-byte retained
prefix. The other 294045 bytes are IRRECOVERABLE; RESULT is not a reconstruction.
All V4/V5/V6 failures, invalid controls, W07 qualification and historical scores
remain intact. No comparator retry, admission or semantic cohort is authorized.
