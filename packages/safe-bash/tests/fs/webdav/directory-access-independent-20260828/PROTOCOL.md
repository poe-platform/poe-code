# Freeze protocol v1

Start with DECLARED-CONTRACT.md. `cases.mjs` exports schema
`webdav-directory-access-independent/v1`, `defaults`, exact `requestBody`, expanded
`scenarios` and eight cross-case `invariants`. It is a pure fixture-input module:
it imports/calls no provider, network, Shell or native oracle. Generation avoids
storing giant path strings/512-request traces repetitively. No author30 matrix is
imported. Distinct expanded case IDs, group counts and expanded-data SHA256 are
sealed in MANIFEST.json; these counts describe inputs, never passes.

| Independent group | Frozen scenarios |
| --- | ---: |
| Navigation/freshness | 5 |
| Metadata/namespace | 15 |
| File type | 4 |
| Ordering/readonly | 36 |
| Mode5 races | 5 |
| Input bounds | 17 |
| Response limits | 4 |
| Lookup races/work bound | 4 |
| Cancellation/cleanup | 9 |
| Provider cd/read compatibility | 3 |

Total: 102 independent frozen scenarios, not implementation outcomes. Repeated
mode/wrapper rows deliberately distinguish precedence; they are not author30
profile replays or an expansion of that historical denominator.

## Case schema and execution protocol (HELD)

Each scenario has unique `id`, `group`, ordered `calls`, ordered `requests`,
`cleanup` and `qualification: injected-mock-only`. Optional fields select wrapper,
headers/options, deterministic abort/race scheduling, or declare path-size and
deadline invariants. Each call has `method`, `path`, expected `outcome`; access
adds `mode`. `OK` means fulfilled undefined; `directory` means stat.type exactly
directory; errno outcomes require public `FsError` with matching code, not raw
objects or reason identity. Do not tighten syscall/path beyond the unchanged
lower layer's binding (some parse/scope errors have no caller path).

`mode` tokens `NaN`, `Infinity`, `string:1`, `null` mean respectively numeric NaN,
numeric Infinity, the JavaScript string "1", and null. All other modes are literal
numbers. These are fixture encoding tokens, not new public API parameters.
`signal` omitted/"omitted" means no FsOptions.signal property. "preaborted" and
"active" use a real AbortController; abort reason is a frozen object
`{ code: "ENOENT", fixture: id }`, exercising errno-shaped cancellation. Never
pass a fake signal to an acceptance run. Type-only negatives are separate.

Create one WebDavFileSystem per scenario using defaults plus declared overrides;
`wrapper: readonly` means `new ReadOnlyFileSystem(provider)`. Default plain.
Constructor admits zero requests; capabilities.permissions stays false for both.
Calls are awaited in order; a denied call does not prevent the next listed call.
Request order is the complete cumulative trace across calls. Never consume a
response unless the exact next method/URL/depth matches; extra/missing requests
are failures. No default-network fallback and no retry tolerance. Finite fixtures
must all settle before the separate evidence recorder completes.

Each request supplies exact `method`, `url`, `depth`, `response` and `resources`.
PROPFIND uses exact exported requestBody, Depth "0"/"1", Content-Type
`application/xml; charset=utf-8`, Cache-Control `no-cache`, copied configured
headers, credentials `omit`, redirect `manual`, and a live AbortSignal. GET has
no Depth/body and adds Accept-Encoding `identity`. Do not assert Headers order.
N03 supplies no synthetic credentials. Only the configured mock gets credentials;
outside redirect targets never receive an admitted request.

Response `status`, `headers` and UTF-8 `body` specify literal mock bytes;
body:null means no body except the explicit pending-body delivery below. To test
final response URL identity, a genuine Response may get a controlled own `url`
property; this is a disclosed trusted injected transport test, not a real service.
Do not override private provider state or parse XML with a fake product parser.

## Exact cleanup measurement

Ordinary non-null bodies are real ReadableStreams with highWaterMark:0. First pull
enqueues one freshly owned UTF-8 byte chunk; second pull closes. The underlying
cancel callback resolves immediately and records its count. Do not eager-close
after enqueue: that would change meaningful cancellation counts. Null bodies have
no stream. `request.resources` seals number of materialized responses, pulls,
**underlying** cancels and released-lock requirement. It does not count calls to
Response.body.cancel/reader.cancel: repeated cancellation of a closed/cancelled
stream need not invoke the underlying callback again.

- Successful/fully parsed bodies: two pulls, zero underlying cancels, no retained
  lock. Parse/type/member errors after EOF retain those counts.
- Refused response URL/redirect, pagination, unconsumed GET, or rejected HTTP with
  non-null body: zero pulls, one underlying cancel. Null body: zero/zero.
- One-chunk XML overflow: one pull, one underlying cancel; release reader lock.
- Each canonical redirect body: zero pulls, one underlying cancel before its
  second request. Same request signal/deadline across that pair; later independent
  request deadlines are not joined into a new global budget.

Cancel scheduling is event/deferred driven, not a wall-clock pass threshold:

- `public-stat-fulfilled-before-return` / `public-readdir-fulfilled-before-return`:
  transparently wrap that PUBLIC method, await its original implementation with
  unchanged args, abort controller, then return the original result. This creates
  a deterministic fulfilled-await checkpoint while retaining actual transport
  and result. No fake stat result/private hook; disclose this instrumentation.
  Stat checkpoint forbids any Depth1 admission; readdir checkpoint forbids success.
- `pending-first-body-pull`: respond with a highWaterMark:0 stream whose first pull
  aborts the controller without enqueue/close. Await cooperative cancellation:
  one pull, one underlying cancel, unlocked reader; no later phase. Active abort
  is typed ECANCELED, with supplied reason retained as cause when it actually
  caused the rejection. No raw-rejection equality requirement.
- `deferred-response`: fetch ignores the supplied signal until harness releases
  its deferred after outward ECANCELED/ETIMEDOUT. Release exactly one late real
  response then await finite cleanup: zero pulls, one underlying cancel, no lock.
- `deferred-rejection`: after outward cancellation, release one late rejection;
  observe it and require no unhandled rejection/no response/no later request.
- `abort-then-reject`: abort in admitted fetch before rejecting with a distinct
  transport Error; caller cancellation wins with ECANCELED, not EIO.
- `immediate-rejection`: reject with that transport Error without caller abort;
  typed EIO, no response/stream. For deadline case use declared timeoutMs:10 and a
  live harness guard that fails on nonsettlement, not a hard performance claim.

Cleanup counts are checked after controlled late resources settle, NOT proof
that public provider settlement awaits arbitrary host work. A late fetch may
outlive outward rejection. All fixture promises are observed, caller-owned
controllers remain borrowed, no sockets or service process is created, and no
uncooperative-work preemption/resource-barrier guarantee is invented.

## Static binding and seal verification

`typed-inputs.ts` imports public `virtual-bash` declarations, never private source.
Eight positive type assertions, ten negative assertions and five uncalled public
call expressions bind accepted signatures. The positive function bodies are
typechecked only; they are not invoked. Type negatives use conditional assertions,
not ignored diagnostics. Numeric range validation is an explicit runtime matter.

`node tests/fs/webdav/directory-access-independent-20260828/validate.mjs`
is explicit opt-in static verification, outside node:test discovery. It checks
schema/data membership, hashes, accepted Git identity, protected baseline and
author bytes, archive entry integrity, and strict NodeNext API bindings against
authenticated accepted-package declarations in memory. It writes nothing,
imports no provider JS, executes no scenarios, and does not build the product.
Local TypeScript is development tooling only; its identity is recorded.
`skipLibCheck:true` limits this to strict consumer binding, not a fresh full
declaration/library audit. Eighty-five accepted declaration files are loaded;
their exact membership/hash authority is retained without copying the package.

MANIFEST.json seals every owned regular file except itself and VALIDATION.json
by SHA256; VALIDATION.json includes the manifest hash and the recorded check.
The manifest enumerates ALL allowed owned members including these two records.
Validation recursively checks exact membership, rejecting additions/symlinks,
not merely modifications of original paths. Referenced author-directory and
provider-directory membership are also exact, including added files. This is a
bounded scoped seal, not an append-proof assertion about the entire repository.

No tests, original reports, root exports, package, AGENTS or production files may
be edited. Only new files in this directory are owned. Preserve the foreign index;
stage explicit files and commit with `git commit --only -- <explicit files>`.
After handoff, do not run even these frozen scenarios until ROOT routes a
candidate and authorizes independent source plus moved-fixture review.
