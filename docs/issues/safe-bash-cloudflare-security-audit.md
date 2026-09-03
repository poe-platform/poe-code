# safe-bash Security Audit — Cloudflare Workers Deployment

**Threat model:** a bad actor can already reach the deployment and execute arbitrary
bash-like scripts through it. They must not be able to (a) retrieve environment
variables / secrets, (b) escape the sandbox to the host, (c) read or destroy other
tenants' data, (d) deny service to other tenants or run up the bill.

**Method:** three parallel deep audits — interpreter core (`packages/safe-bash`,
257 files, all findings verified with working PoCs), network surfaces
(`packages/safe-bash-playground`, HTTP transports), and Workers-specific
platform risks (`packages/safe-bash` + `packages/safe-fs`).

**Headline answer for the env-var concern:** the interpreter core is clean — no
`process.env` reads anywhere in `safe-bash`/`safe-fs`, the shell env is purely
virtual, and there is no host-shell fallback. The realistic secret-theft paths are
all **wiring/deployment mistakes**, and they are findings 1–4 below.

---

## Critical

### 1. `nodejs_compat` maps Worker secrets into `process.env` — one natural wiring mistake exfiltrates everything

On Cloudflare Workers with the `nodejs_compat` flag (which safe-bash effectively
requires — see finding 5), `process.env` is populated from **Worker environment
bindings, including secrets**. The shell itself never reads ambient `process.env`
(verified across both packages), but nothing stops the host code from doing the
idiomatic Node thing:

```ts
new Shell({ fs, env: process.env })   // ← every tenant script can now `env` / `echo $POE_API_KEY`
```

Any secret in the shell env is script-visible by design (`env`, `printenv`, `set`,
`export`, `$VAR` expansion — all verified to expose virtual env state). Combined
with curl egress (finding 3) this is full remote exfiltration; even without curl
the value comes back in the tool response.

**Fix:**
- **Implemented:** `packages/safe-bash/src/shell/env-warning.ts`
  (`warnIfHostProcessEnv`) warns once when the shell env is the actual
  `process.env` object, wired into the `Shell` constructor and `exec()`. It warns
  rather than blocks — a deliberate design decision, since a host may
  legitimately pass a curated copy. JavaScript cannot reliably distinguish a
  spread copy from an independently constructed equal-valued environment, so
  copied environments remain covered by the documented deployment rule.
- Deployment rule, documented in the README: secrets live in Worker bindings
  touched only by host code (authorizers, transports); **never** in `Shell({ env })`.
- Per-tenant credentials are injected per-request by host code, never baked into a
  shared shell.

### 2. In-memory FS has no cumulative quota, and a shared Shell/FS across tenants exposes everything

Two deployment-level hazards for a multi-tenant Workers service:

- **Memory DoS:** the in-memory FS (`packages/safe-fs/src/fs/memory/index.ts`)
  has no storage quota — only a per-`readFile` `maxBytes`. `maxOutputBytes`
  (16 MiB) caps a single call, but nothing caps cumulative growth across calls —
  loop `head -c 16000000 /dev/zero >> /big` until the 128 MB isolate OOMs,
  killing co-resident tenants.
- **Cross-tenant exposure:** if the host shares one `Shell`/env/FS across
  tenants, attacker B reads (`cat`) and destroys (`rm -rf /`) everything
  attacker A created, and any per-tenant data or credential that ever lands in
  the VFS or env is exposed to all tenants. Per-tenant `Shell` + FS is a
  **deployment invariant**, not an option.

**Implemented:** `withFileSystemQuota(fs, { maxBytes })` serializes mutations and
enforces cumulative logical bytes across direct, copied, linked, truncated, and
streamed writes. The playground remains a reference for creating one Shell/env/fs
view per session; a synthetic interleaving test verifies tenant separation.

### 3. Secret exfiltration via egress: curl stays, so the authorizer allowlist is the only gate

`packages/safe-bash/src/commands/network/transport.ts:1-2` — the default curl
transport is `node:http`/`node:https`, dead on Workers, so a deployment must inject
a `fetch`-based transport. The `authorize` callback is then the **only**
destination control (`curl.ts:74-79` — curl can't even be constructed without one,
which is good). A permissive authorizer lets any tenant script:

- exfiltrate anything in its virtual env/fs to an attacker origin,
- SSRF into internal/self endpoints from Cloudflare's IP pool,
- fan out ~1,600 fetches per invocation (`maxRedirects:10 × maxRetries:5 ×
  maxUrls:32`), blowing the Workers subrequest budget (50/1,000/5,000 by plan).

**Implemented:**
- `createFetchTransport` provides streaming Worker/browser fetch with omitted
  ambient credentials and manual redirects.
- The curl authorizer supports an **allowlist of origins/hostnames**, checked on
  every request **including each redirect hop** — the existing per-hop
  re-authorization plumbing already supports this. The special value `*` means
  allow-all, and **`*` is the default**.
- Document clearly: with the default `*`, any script can reach any origin, so
  deployments that place secrets in env or care about SSRF **MUST** configure an
  explicit allowlist.
- Rejecting literal RFC-1918/loopback/link-local destinations is available as an option
  but is **not forced**.
- `cloudflareWorkerNetworkLimits` caps the worst-case request fanout at 48; the
  transport never forwards Worker env
  bindings in headers.

### 4. Uninterruptible ReDoS in `find -name/-path` — native `RegExp` on the main thread

`packages/safe-bash/src/commands/find.ts:8-21` — glob patterns are translated to
native JS `RegExp` and executed inline, unlike grep/rg/expr which run in a
terminate-able worker thread. No budget, no abort — V8 backtracking ignores the
`AbortSignal` everything else honors.

Verified PoC (hung >120 s, killed externally; no sandbox limit fired):

```sh
# create a file named with 120 'a' characters under /d, then:
find /d -name '*a*a*a*a*a*a*a*a*a*a*a*a*b'
```

On Workers this burns CPU until the platform kill-switch and blocks the isolate's
single thread for every co-resident tenant. Note: the worker-thread isolation that
protects grep/rg **does not exist on Workers** (finding 5), making this inline
path the template for what must not happen elsewhere.

**Implemented:** route `find` pattern matching through the existing budgeted
`compilePattern`/`matchesPattern` matcher (`src/shell/pattern.ts`) — never native
`RegExp` on tenant patterns.

### 5. `node:worker_threads` is in the default import graph — package won't deploy, and the tempting fallback is catastrophic

`src/commands/regex-execution/client.ts:1`, `ere/transport/owner.ts:1`, and
`src/shell/runtime.ts:44` all import `node:worker_threads` at module level;
`src/index.ts` re-exports the subsystems that pull it in; `package.json` lacks
`"sideEffects": false`, so bundlers keep the whole graph. Workers doesn't implement
`worker_threads` even with `nodejs_compat`:

- **As-is:** deploy fails or the Worker crashes at startup.
- **Naive fix (stub it / run regex in-process):** tenant-supplied native `RegExp`
  (`matching.ts:55` compiles untrusted patterns; backrefs/lookarounds are rejected
  but `(a+)+$` is legal) runs on the isolate's single thread — one request blocks
  **all tenants** until the CPU cap. This is the "fallback becomes less safe" trap.

**Implemented:** `[[ =~ ]]` now invokes the existing step/allocation-budgeted ERE
parser and matcher directly, so the shell runtime no longer imports the
`worker_threads` transport. `"sideEffects": false` and the browser subpath keep
Node-only command families out of a Worker bundle. Deployment must still verify
the final application bundle because importing the Node root intentionally grants
Node-only command families.

---

## High

### 6. Parse-time CPU DoS: quadratic `Lexer.lineAt()`

`src/shell/parser.ts:128` — `lineAt` slices and re-splits the whole source prefix
**per token** (call sites :588, :628, :792, :846) → O(n²) parse cost, incurred
**before any execution budget engages**. Verified: 1 MB of `a;a;…` (within the
1 MiB `maxSourceBytes` cap) = **12.9 s CPU**; 500 KB = 3.9 s.

**Implemented:** the lexer precomputes newline offsets and uses binary search.

### 7. Unbounded memory via string variable accumulation

`src/shell/runtime.ts:2200-2201` + `src/contracts/value.ts:104` — `x+=$y` in a loop
grows a variable without limit; `ValueArena` only accounts for byte values, never
plain strings; `maxExpansionBytes` bounds each single expansion, not the stored
result. Verified PoC: `y=$(seq 1 150000 | tr '\n' 'x'); for i in $(seq 1 300); do
x+=$y; done` → **2.4 GB heap** before V8 threw. On a 128 MB isolate: OOM crash that
can reset the isolate and kill unrelated tenants.

**Implemented:** every variable write/appended result is checked against
`maxExpansionBytes` before retention.

### 8. Parse-time CPU DoS: unbounded BigInt in arithmetic `base#digits`

`src/shell/arithmetic.ts:37-53` — 64-bit truncation happens **after** building the
full arbitrary-precision integer, at parse time (no execution budget applies).
Verified: `echo $((64#zzz…))` with 800k digits = **85.5 s CPU**.

**Implemented:** `BigInt.asIntN(64, …)` is applied inside the per-digit loop.

### 9. No wall-clock deadline anywhere; `sleep` accepts ~2⁵³ ms

`src/shell/types.ts:20-31` — `ShellLimits` has only count/byte limits.
`sleep.ts:6-52` accepts up to `Number.MAX_SAFE_INTEGER` ms (~285k years) and
genuinely awaits. On paid Workers plans there is no effective wall-clock cap
while work is pending — thousands of `sleep 999999d` requests occupy request
slots indefinitely, and one CPU-heavy call head-of-line blocks the serialized
execution queue for everyone.

**Implemented:** `maxWallClockMs` in `ShellLimits` is enforced by the root `Budget`
and aborts pending `sleep`, `timeout`, and host work. Edge rate limiting remains a
deployment responsibility.

---

## Medium

### 10. Shell output budget doesn't cover command-initiated FS writes

`src/commands/filesystem.ts:160` (`cp`), `src/commands/streams.ts:300-318` (`tee`),
`tar -x` write via `context.fs` directly; `maxOutputBytes` only wraps stdout/stderr/
redirect sinks. Verified: seed an 8 MiB file, `for i in $(seq 1 200); do cp
/seed.txt "/f$i"; done` → **1.4 GB** in the memory VFS in one exec, exit 0.

**Implemented:** the cumulative quota filesystem adapter covers command-initiated
writes independently of stdout/stderr accounting.

### 11. Default budgets are calibrated for Node, not a 128 MB shared isolate

Per-invocation allowances: 16 MiB output ×2, 16 MiB expansion, 32 MiB awk/sed
buffer, 64 MiB curl up/download, uncapped checksum input. N concurrent tenants each
legitimately using ~50–80 MB collectively exceed the isolate heap; V8 OOM in a
Workers isolate isn't attributed to one request — it can reset the isolate and
kill unrelated tenants' in-flight work.

**Implemented:** `cloudflareWorkerLimits` caps output/expansion at 4 MiB. Hosts
must also set command-family buffers to at most 8 MiB and enforce concurrency at
the deployment boundary (for example, with a Durable Object admission gate).

### 12. Synchronous CPU bursts between yields — noisy-neighbor latency

`maxCommands: 10_000`, awk/sed `maxSteps: 5_000_000`, 16 MB `sort` comparator
passes — each is a single-threaded burst sized for a server. Per-request CPU is
metered, so this is latency theft against co-resident tenants, not budget theft;
nothing in the code bounds it except the platform kill-switch.

**Implemented:** first-class CPU meter samples `performance.now()` in `Budget.tick()` and
at every yield checkpoint; abort past a configured `maxCpuMs`.

### 13. `setImmediate` global + `node:timers/promises` throughout the hot path

~18 files use bare `setImmediate` (e.g. `shell/pattern.ts:19,90`,
`shell/runtime.ts`); these yields are the cooperative-scheduling points that keep
long workloads abortable. Without `nodejs_compat` the interpreter crashes
mid-execution with `ReferenceError`; if a port replaces it with `queueMicrotask()`,
cancellation checks are deferred to end-of-macrotask — weakening the abort path the
resource-limit design relies on.

**Implemented:** cooperative yields are centralized in `contracts/yield.ts`; it
uses the host's macrotask scheduler (`setImmediate` when available, with an
abortable timer fallback on Worker/browser runtimes). A regression verifies that
abort timers fire between work steps.

### 14. safe-fs platform-condition footguns

Which platform file you get (`platform/node.ts` vs `platform/browser.ts`) depends
on bundler conditions; the `browser` condition silently disables custom
entry-comparison authorities and S3/WebDAV ownership proofs. If `fs/real`
(Node-only, host fs access) were ever bundled into a Worker, scripts could read
files bundled with the deployment.

**Implemented:** explicit `workerd` platform condition; `fs/real` and `s3/http` remain behind
subpath exports the Worker bundle never imports.

---

## Low

### 15. Heredoc delimiter handling is already Bash-compatible — no issue

The original finding was incorrect. Bash performs quote removal on the delimiter
word but does not perform parameter, command, arithmetic, or filename expansion.
Safe-bash already treats `<<$EOF` as the literal delimiter `$EOF`, and the heredoc
suite contains a regression for this behavior.

### 16. Playground ships without a Content-Security-Policy

`safe-bash-playground/index.html` — no CSP meta/headers. Mitigated (verified): all
DOM writes use `textContent`, no `innerHTML`/`eval`/external scripts. Defense in
depth only.

**Implemented:** the page declares a CSP with `default-src 'self'`, `script-src
'self'`, `connect-src 'none'`, and an explicit `worker-src 'self' blob:` policy.

### 17. Module-level state is clean — with one deployment invariant

All cross-request registries in both packages are `WeakMap`/`WeakSet` keyed on
per-invocation objects (verified: `s3/registry.ts`, `webdav/resource-id.ts`,
`memory/index.ts`, `shell/runtime.ts:85,223-225`). No tenant data can leak via
module state on a shared isolate — **provided** a single `Shell` with tenant A's
env baked in is never shared with tenant B. Document "one Shell/env/fs view per
tenant-request" as an invariant and add a synthetic multi-tenant test interleaving
two tenants' execs on one module instance.

**Implemented:** the README states the invariant and the security regression suite
interleaves two independent tenant shells, environments, and filesystem views.

---

## What the sandbox does well (verified, do not regress)

- **No host capability leakage:** zero `child_process`, `eval`, `Function`, dynamic
  import of user input, or direct `node:fs` in `src/`. All file access goes through
  the injected `FileSystem`; `resolvePath` clamps `..` at `/`, rejects NULs.
- **Allowlist/denylist enforcement is robust:** every dispatch path — `eval`,
  `command`, functions shadowing builtins, variables containing command names,
  `xargs`, `find -exec`, `env`, `timeout` — re-enters the middleware+budget
  pipeline (PoC-verified with a middleware blocking `rm`: all paths blocked). No
  `alias`, no `exec`, no `trap`, no host-shell fallback.
- **Env isolation by design:** shell env starts empty (`PWD`+`OPTIND` only); the
  SafeJS `node` guest's `process.env` is the *virtual* env.
- **Real-fs adapter** (Node-only): symlink-created-then-`..` escape refused with
  EACCES, 40-link chains, `O_NOFOLLOW`, root-pinning via `realpath`.
- **Tar extraction:** rejects `..`/absolute members, validates symlink targets
  lexically and via link-chain resolution; gzip streamed with byte caps (no zip
  bomb).
- **Regex engines for sed/awk/jq:** bespoke budgeted NFA / ledger-bounded ERE with
  step, state, and capture caps.
- **Budgets are fatal, not per-operation:** exceeding `maxCommands`/
  `maxLoopIterations`/`maxSubstitutionDepth`/`maxOutputBytes` aborts the whole
  exec, so budget exhaustion can't be looped.
- **curl** (opt-in): authorizer required at construction, re-authorizes every
  redirect hop, credentials scoped per-origin, HTTPS→HTTP redirects blocked.

## Deployment checklist (blocking items for go-live)

1. Finding 1 guard: `warnIfHostProcessEnv` is implemented and warns when the
   shell env is the actual `process.env` object; never pass it or a secret-bearing
   copy. Keep secrets only in Worker bindings used by host code.
2. Finding 2: per-tenant Shell/FS + FS quota wrapper.
3. Finding 3: fetch-based curl transport + origin allowlist authorizer (default
   is `*` = allow-all; configure an explicit allowlist if secrets live in env or
   SSRF matters).
4. Findings 4–5: no native `RegExp` on tenant patterns anywhere on Workers;
   subpath imports only; verify bundle with `wrangler deploy --dry-run`.
5. Findings 6–9: parser/arithmetic/variable fixes + mandatory wall-clock deadline
   + edge rate limiting.
6. Enforce body/request size limits at the HTTP edge, fail closed.
7. Finding 11: Workers-tuned limit profile + per-isolate concurrency cap
   (Durable Object per tenant doubles as isolation, rate limit, and quota gate).
8. Test on the real runtime: `@cloudflare/vitest-pool-workers`, `nodejs_compat`
   on and off, plus the multi-tenant interleaving test from finding 17.
