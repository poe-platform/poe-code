# Portable filesystem source contract

This describes the implemented source graph, not an already-published browser
package. Release A remains the separately verified Node foundation. Public
conditional exports, root declaration-policy routing and packed consumer
acceptance are separate distribution gates. No root exports or bundler settings
are changed by this source increment.

## Entries and selected policy

`src/core.ts` exports the shared filesystem and byte-source contracts,
`FsError`/`isFsError`/`toFsError`, `PlatformErrno`, virtual path validation,
resolution and confinement helpers, memory, read-only, mount, overlay and WebDAV
constructors, factories and their types. It does not export native POSIX path
utilities, host filesystem APIs, the Node bridge, S3 or configuration registries.

`src/node-host.ts` re-exports the existing Node root without recreating classes
or registries. It retains `RealFileSystem({ root })`,
`createNodeFsBridge(filesystem, { cwd?, signal? })`, S3 including HTTP/mock support,
and existing Node configuration exports. `src/index.ts` is unchanged.

The workspace-private `#safe-fs-platform` import selects `src/platform/browser.ts`
under the `browser` condition, otherwise `src/platform/node.ts`. A core entry
selected under Node deliberately keeps Node policy. Merely importing core is
not a request to change platform semantics. There is no mutable policy setter,
initialization-order switch, global context shim or exported errno table.

There is one `FsError` implementation and one emitted declaration. Its required
`code` is authoritative on every platform. Its own, nonoptional `errno` property
uses the private `PlatformErrno` type: Node preserves native numeric values,
including the existing `EOPNOTSUPP` alias; browser types admit `number | undefined`
and the browser implementation sets `undefined`. No invented numeric table or
different error subclass is used. `isFsError` remains strict constructor-based
recognition rather than accepting error-shaped objects.

Public root/core/node facades must share common modules within one selected
condition's bundle graph. Independently bundling entries, mixing conditions or
installing parallel copies does not preserve constructor or WeakMap identity.

## Authority and concurrency

Node comparison negotiation retains real `AsyncLocalStorage`, including nested
callbacks which discard options. Browser negotiation carries a privately branded,
operation-owned context through copied options. It survives asynchronous work and
options spreading, does not mutate caller options, and expires on fulfillment or
rejection. Independent operations do not share an ambient current context.

Built-in memory/mount/read-only/overlay comparisons and WebDAV protocol identity
remain available. Browser custom comparison authorities that need Node callback
context fail with `FsError("ENOTSUP")` before callback invocation. A configured
WebDAV `compareEntry` is rejected at construction, and the browser-selected option
type excludes that callback. Replaced built-in comparison methods are not silently
treated as trustworthy callbacks. This is an explicit backend/platform capability,
not a change to a consumer's programming language.

S3 proof observations live in a shared, internal registry, separate from the
Node invocation context which authenticates query/response provenance. Native S3
queries still consume their original proof before recording a stat observation.
Response clones, replay, cross-query reuse and forged stat objects do not become
authority. WebDAV response/stat/filesystem/path binding and protocol identity are
preserved. Authority writers, tables and context providers are not core exports.
S3 browser backend support is deferred; the small observation registry in core
does not imply that the Node S3 backend or HTTP signer is portable.

## Runtime requirements and confinement

The browser core uses ES2022 and web byte/stream, encoding, URL, response and
cancellation primitives, with no Node builtins, `Buffer`, `process` or Node ambient
types. Overlay staging requires secure entropy: `crypto.randomUUID()` when
available, otherwise `crypto.getRandomValues()` with UUID version/variant bits.
Missing secure entropy fails closed before publication; provider errors retain
identity. There is no weak randomness fallback. Node uses its explicit native
crypto boundary. No new environment variables, ambient credential lookup or
process working-directory authority are introduced.

Memory and wrapper options retain their existing documented meanings. Virtual
resolution starts from an explicit absolute cwd (or the helper's `/` default),
not a machine directory. Mount boundaries, read-only behavior, overlay whiteouts,
private staging visibility, comparison refusal and cancellation/cleanup semantics
are unchanged. Virtual confinement is not a sandbox for an injected malicious
adapter. The Node bridge's cwd remains resolution context, not confinement;
the existing real backend's host race/TOCTOU limits are not solved here.

WebDAV still requires explicit `baseUrl` and `fetch`. Headers, response/XML/entry
limits, timeout, overwrite policy and optional atomic-empty-directory binding
retain their existing meanings. Browser builds do not obtain ambient credentials:
requests retain `credentials: "omit"` and manual redirects. Streaming upload uses
the existing local `RequestInit & { duplex?: "half" }` adaptation without changing
global DOM types.

A browser transport is also subject to browser policy: CORS preflight must permit
the deployed WebDAV methods and request headers, required response headers must
be exposed, and the browser must support the chosen streaming request behavior.
Forbidden headers and credential/redirect restrictions cannot be bypassed by this
adapter. Explicit authorization and provider-specific atomic deletion still need
an appropriately configured, trusted transport/server. Injected response tests
and local Chrome execution are not deployed CORS or provider acceptance evidence.

## Declaration and distribution contract

The source imports map is for source-aware builds. TypeScript's unbundled private
workspace output is not a replacement public distribution: the source policy
targets are `.ts` files. Bundle the selected policy into the canonical runtime;
do not ship an unresolved private runtime import or rely on Node loading those
source files. No separate npm bootstrap or sibling `file:` dependency is needed.

The intended canonical routes are `poe-code/safe-fs`, `poe-code/safe-fs/core`, and
`poe-code/safe-fs/node`. They are not wired by this increment. The published root
must also map private `#safe-fs-platform` declaration imports to the matching
Node/browser policy leaves. Core uses the same selected policy as the root.
The browser root selects core; the browser node-host runtime route must be `null`
and its type route must use the empty `src/node-unavailable.ts` declaration.
Runtime `null` alone does not reliably prevent TypeScript's named-import fallback.

Browser TypeScript consumers must select `customConditions: ["browser"]` with
NodeNext or Bundler resolution; Bundler resolution alone is insufficient. Source
DOM validation uses `tsconfig.portable.json` with no Node ambient types or path
aliases. The generated-declaration proof checks both resolution modes and both
platforms, using one actual error declaration and a temporary installed-layout
manifest. It does not certify the eventual public tarball.

The focused source tests cover the Node 18.18.2 baseline and Node 22.22.2, strict
DOM types, actual browser-conditioned bundles and a Chrome run of the memory,
wrapper, authority and injected-WebDAV graph. No Node >=22-only API is introduced;
the existing scoped cancellation helper still avoids requiring `AbortSignal.any`.
These checks neither narrow the root engine range nor assert acceptance on every
browser, Node version, native host or deployed backend.
