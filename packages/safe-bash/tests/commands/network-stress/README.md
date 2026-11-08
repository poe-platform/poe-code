# Independent curl verification: preparation checkpoint

## Later independent handoff checkpoint

The preparation text below is retained as historical provenance, not current
product status. Authentic handoff is now recorded in `handoff.json`.
`BASELINE.md` and `baseline.json` retain the first unmodified 60-case result:
57 passed, 3 failed (51/54 native-parity; 6/6 separate contracts).
See `SUPPLEMENT.md` for the separately frozen additive 18-case corpus.
`REPORT.md` records the completed 18/18 supplementary result, exact source
identity and a product-free reproduction of the frozen lab cleanup race.

## Historical preparation record

**Author handoff has not been received. Product executions: 0. Product passes: 0.
All 60 virtual rows are pending.** This directory is independently owned; no
production network implementation or author tests were used to set expectations.
Only the public root exports, shell/contracts, root README, and proposed public
network types were read for integration. The existing remote audit was not run.

## Frozen evidence and counts

`oracle.json` was captured at **2026-08-26T22:27:55.090Z**, before any product
comparison. Its SHA-256 is:

```text
b1b51398c3fb51a275ffb8f5d344c2c105fb077719674e44f297e7d66cdc21d7
```

`evidence.ts` pins that digest. The JSON also pins the SHA-256 of `rows.ts`,
`lab.ts`, and `native.ts`, the executable bytes, and the full native version
output. Do not update frozen expectations to accommodate implementation results.
New profiles require a separately reviewed artifact, retaining this original.

| Inventory | Count |
| --- | ---: |
| Focused native rows / curl transfer invocations per capture or replay | 58 |
| Additional native curl `-q --version` calls per capture or replay | 1 |
| Native `/usr/bin/head -c 1` consumers per capture or replay | 2 |
| HTTP requests in the frozen capture / native replay | 68 |
| Extra virtual-only contracts | 2 |
| Total virtual denominator | 60 |
| Strict native-parity virtual rows | 54 |
| Separately scored virtual security/lifecycle contracts | 6 |

Thus a capture/replay uses **59 curl process invocations**, not 58 or 68.
The JSON field `nativeCurlTransfers` counts row invocations, including argument
errors with no HTTP request; it does not mean 58 completed transfers. Redirects
and retries account for extra HTTP requests. The default selfcheck also
makes three HTTP requests through the verifier's own injected transport; these
are harness selfchecks, not product executions, native curl invocations, or extra
matrix rows. It reports **65 Node tests**: 58 native row subtests, one containing
replay test, and six provenance/profile/safety/transport checks. Do not call that
65 curl cases. Preliminary executable inspection also ran one separate curl
version query and one unsupported `head --version` query; neither is a row.

## Bounded commands

Run from the repository root using existing development tooling; no packages or
runtime dependencies are installed:

```sh
node tests/commands/network-stress/watchdog.mjs native
node tests/commands/network-stress/watchdog.mjs typecheck
node tests/commands/network-stress/watchdog.mjs product
```

The default mode is `native`. Expected results now: native exits 0 with 65/65
tests; scoped typecheck exits 0; product exits **2**, emits `gated`, 0 executed,
0 passed, 60 pending, and does not import the product entrypoint. Exit 2 is a
handoff gate, not a product failure or a passing compatibility result.

All modes launch Node with `--unhandled-rejections=strict`. Native/typecheck
have a 90-second outer watchdog and a 92-second hard kill. Product has 420/422
seconds, independent six-second row aborts, bounded settlement/cleanup, and a
one-second early-head/caller-abort settlement requirement. Native children have
six-second kill timers and a two-MiB combined capture ceiling. Test timeouts are
additional assertions, not substitutes for killing children.

The wrapper uses a POSIX process group, terminates descendants, and removes only
new `.native-XXXXXX` roots created during its run; preexisting roots are not
deleted. Its owned `.watchdog-lock` prevents concurrent wrapper invocations.
Do not run another direct harness concurrently or include these tests in an
unrelated broad suite during preparation. Ordinary cleanup checks happen inside
the tests before the wrapper's final cleanup. An externally delivered SIGKILL
to the wrapper itself cannot be handled; inspect and attribute stale owned
temporary roots/lock before manual recovery rather than deleting other work.

The original one-time capture command was:

```sh
node tests/commands/network-stress/watchdog.mjs freeze
```

`freeze.ts --freeze-new` refuses to overwrite `oracle.json`. It captures into
memory, then creates the artifact using `apply_patch`; no shell command string
is evaluated. Source, documentation, and evidence edits also use `apply_patch`.
Temporary fixture byte seeding/output and cleanup are ordinary bounded test I/O.

## Handoff gate and actual blackbox path

After an authentic Curie handoff, the verifier must record its message reference,
40-character source revision, receipt timestamp, and the **actual documented
public network-plugin export name** in a new owned `handoff.json` via
`apply_patch`. No such file is supplied at this checkpoint. Its required shape is:

```json
{
  "author": "Curie",
  "revision": "<40-character handed-off commit SHA>",
  "messageReference": "<actual coordinator/author handoff message>",
  "receivedAt": "<actual ISO timestamp after oracle capture>",
  "pluginExport": "<actual package-root network-plugin export>"
}
```

Check out or otherwise verify the intended author revision before running;
the revision in this attestation is not automatic proof of a clean worktree.
Then the reusable blackbox command is:

```sh
CURL_VERIFY_AFTER_HANDOFF=<matching-40-character-SHA> node tests/commands/network-stress/watchdog.mjs product
```

`product.ts` dynamically imports the real `src/index.ts` only after the gate.
It requires actual `Shell`, `createMemoryFileSystem`, `agentCommands`, and the
handed-off public network plugin. It never substitutes a curl handler, uses
`createAgentCommands` fallback execution, calls command internals, or imports
author tests. The registration signature is prepared against the public
`NetworkCommandsOptions` type available at capture time; final public export and
signature compatibility remain **unverified pending handoff**. A missing export
fails rather than silently falling back to an internal module.

Every ordinary row runs through `Shell.exec` as
`set -o pipefail; curl ... | cat`. The stdin rows use VFS-seeded
`cat stdin.bin | curl ... | cat`; early consumers use `curl ... | head -c 1`.
Every fixture argument is single-quoted for the virtual shell. No native shell
evaluates these strings. Each row has a new memory VFS at `/work`; all input
files, output files, absent-parent behavior, overwrite/truncation bytes, and
unexpected namespace effects are checked. Native analogues use controlled
temporary roots, never user files. The product runner emits JSONL row evidence
and a complete 60-row denominator; unsupported behavior remains a failure.

The injected transport is a real Node HTTP client, not canned command results.
It sends literal method/headers/body to the same fixture servers, does not follow
redirects or retry on behalf of curl, checks exact allowed origins before host
work, and pins connections to `127.0.0.1`. It preserves duplicate headers,
streaming byte bodies, cancellation, and response disposal. The public plugin
must authorize every attempt in order. This is a verifier-controlled transport
profile, **not verification of the author's default transport**.

## Request/output comparison rules

Frozen rows contain complete base64 stdout and file vectors, normalized literal
argv, raw request-header order/case (`wireTraces`), semantic request traces,
exit code/signal, consumer status, observed timing, and diagnostic stderr.
Ephemeral origins are named `{A}`, `{B}`, `{H}`; H is `localhost` on A's port.
Native `--resolve` pins H to loopback, distinguishing host changes from port
changes without external DNS. Absolute native temporary paths are `{ROOT}`.

Native replays compare exact status except the two preclassified early-pipe
observations, exact stdout/file bytes, and exact semantic request traces.
Version-dependent stderr wording and elapsed milliseconds are recorded but not
byte-equality assertions. Failure rows require the predeclared diagnostic
meaning (404, redirect, timeout, read, write, URL, protocol, or option/argument).
Native early-pipe status 23 requires a write diagnostic; 28 requires timeout.
No error is converted into a pass merely because stderr is nonempty.

Product request comparison folds header-name case and sorts **distinct header
names**, retaining value ordering for repeated names. Default `Accept` and all
custom headers/auth/content-type remain checked. Host, user-agent, connection,
content-length, transfer-encoding, and Expect are retained in native raw traces
but excluded from semantic equality: they are client/framing choices, not
byte-body or credential expectations. Response header bytes for `-I`, `-i`,
and `-D` remain exact frozen vectors. Transfer body bytes, request count and
order, target paths/methods, credentials, and file namespace effects are not
weakened. Host aliases are independently constrained by exact-origin transport
authorization. No default-transport behavior is inferred from this profile.

## Coverage and contract distinctions

- Methods/body: GET/HEAD, explicit PATCH/PUT before/after data flags, repeated
  `-d`, raw `@`, native text-file CR/LF/NUL stripping, binary `@file`/`@-`, PUT
  file/stdin upload, and explicit POST retained across a 302 with its body lost.
- Headers/auth: repeated differently-cased headers, suppression and empty
  values, Basic, empty `:`, Bearer, and custom Authorization. Same-origin auth
  is retained; cross-port and cross-host Basic and cross-port Bearer/custom
  Authorization must not leak to the redirect target.
- Bytes/files: NUL/invalid UTF-8 upload/download, VFS output overwrite, native
  partial disconnect stdout/file preservation, missing input/output parents,
  status 404 success versus `--fail` and `--fail-with-body`, and headers output.
- Redirect/retry: 301/302/303 rewrite POST to GET; 307/308 retain POST/body;
  relative Location; cyclic redirects with max-redirs; HTTP 503 retry; no retry
  of 404; retry file reset versus unreset stdout. The frozen POST retry sends
  **two effect-bearing uploads**. This is evidence against an exactly-once or
  no-duplicate-effect claim, not a reason to silently suppress the second trace.
- Malformed/security: unknown/missing options, no URL, invalid port, URL space,
  disabled `file:` protocol, header CRLF injection, exact-origin/credential
  policy rejection, and VFS namespace snapshots. Only safe loopback/scratch
  endpoints are ever passed to the native oracle.

Six virtual rows are explicitly **contracts, not native parity**:

1. `active-sigint`: native child result is `{code: null, signal: "SIGINT"}`, not
   a native exit code 130. Virtual execution instead receives an active caller
   AbortSignal after the server observes the request. It must reject with the
   supplied reason within one second, emit no stdout, propagate cancellation
   into the injected transport, preserve files, and close sockets before test
   teardown. This follows the public Shell/byte-cancellation contract, not a
   fabricated curl CLI equivalent.
2. `early-head-stream` and `early-head-stalled`: native head exits 0 with byte
   `p`; captured curl statuses are 23 and 28 respectively. Native pipeline
   failure timing depends on buffering and subsequent writes, so codes 0/23/28
   were declared observation-only before capture; signals and head output/status
   are still checked. In the virtual stalled case, curl max-time is changed
   from 0.35 seconds to 3 seconds and the **whole Shell pipeline** must settle
   within one second, close its transport, and return head's status 0 and byte
   `p`. This independently tests early-consumer lifecycle rather than counting
   a late timeout as cancellation success.
3. `header-crlf-injection`: native curl 8.7.1 sends the injected second header.
   Preserve that observation. Virtual curl must reject control characters
   before calling transport, with a header diagnostic and no requests/filesystem
   effects. This deliberate security requirement is never called native parity.
4. `network-not-ambient`: `agentCommands()` alone must not register curl;
   expected status 127, meaningful curl-not-found diagnostic, no host work.
5. `authorization-denied`: explicit plugin with a denying authorizer must fail
   with an authorization/policy diagnostic, no transport call and no effects.

Native signal/early-head observations still count in 58 native rows. The two
virtual-only contracts have no native invocations. The 54 parity plus six
contract denominator stays 60 even if a feature is unsupported.

## Safety and limits

- Native executable: `/usr/bin/curl`, observed **8.7.1**, release 2024-03-27,
  with full version/features and executable SHA-256 in the JSON. Head is pinned
  by executable SHA-256 as well. A profile mismatch fails; it is not a skip.
- `-q` is argv[0], disabling default curl config. Environment is an allowlist:
  controlled HOME/CURL_HOME/XDG_CONFIG_HOME, C locale, fixed PATH, NO_PROXY and
  no_proxy `*`. No inherited HTTP(S)/ALL proxy, credentials, netrc/config lookup
  directives, external upload, subprocess shell, or ambient DNS are used.
- Native safety flags constrain initial and redirected protocols to HTTP,
  disable proxies/globbing, pin HTTP/1.1, bound connection/transfer time and
  redirects. The closed fixture catalog is the only accepted native input;
  externally supplied rows/URLs are rejected. Negative `file:` URLs point only
  at seeded scratch files and are blocked by the native protocol restriction.
- Servers bind `127.0.0.1:0`; all ports are ephemeral. Two servers per row are
  closed with tracked sockets and timers. Responses do not include Date, avoiding
  time-dependent response-byte fixtures. Native children/consumers are awaited,
  sockets must be idle, and temporary roots are removed in cleanup.
- The suite is HTTP/1.1 loopback only. It does **not** establish TLS/certificate,
  DNS-rebinding, proxy, real Internet, deployed-provider, HTTP/2/3, multipart,
  compression, ranges/resume, cookie jar, netrc, URL globbing, arbitrary shell
  metacharacter fuzz, shell-level redirection, adapter-matrix, or full curl/Bash
  compatibility. No claim of completion or superiority is made.
- Product memory-VFS isolation remains pending; native safe temp-file success
  is not evidence of product VFS safety. Default author transport, broader VFS
  adapters, external denial paths, additional malicious encodings/options, and
  deeper cancellation races require later independently assigned work. The
  existing remote audit's original 20/24 remains outside this task.

## Primary documentation sources

Retrieved with the required web tool on 2026-08-26. The rolling manpage described
**8.22.0**, whereas the frozen local executable is **8.7.1**. Documentation is
context, not a substitute for measured version-specific expectations; no
post-8.7.1 option semantics were silently applied. Exact source URLs are also
recorded in the oracle JSON:

```text
https://curl.se/docs/manpage.html
https://curl.se/docs/manpage.html#data
https://curl.se/docs/manpage.html#data-binary
https://curl.se/docs/manpage.html#location
https://curl.se/docs/manpage.html#retry
https://curl.se/docs/manpage.html#max-time
https://curl.se/libcurl/c/libcurl-errors.html
```

Relevant topics: literal CLI options/data sources, redirects and credential
boundaries, retry body/output effects, timeout, disable-config, and numeric
failure semantics. Online documentation was not used as an upload target or
queried by native curl. No external fixtures were fetched.

## Preparation validation record

- Initial independent capture: 58/58 native rows, 68 requests, no product run.
- First strict replay: 58/58 rows plus four harness/container tests (62/62).
- Expanded strict replay: 58/58 plus seven harness/container tests (65/65),
  including binary injected transport, active abort, and stalled disposal.
- Final strict replay after watchdog/diagnostic checks: 65/65, no skips or
  cancellations, 5.281 seconds including the Node test runner.
- Scoped typecheck passes; no whole-repository suite/build was run.
- Default product gate verified: exit 2, 0 executed, 0 passed, 60 pending.
- Preparation totals: one capture plus three replays = 232 native row
  invocations and 272 native HTTP requests. Four profile calls plus the separate
  exploratory version query make 237 total curl processes. Eight native head
  consumers plus the exploratory version probe make nine head processes. The
  two expanded replays add six injected-transport fixture requests, not product
  executions. No temporary roots, lock, or native children remain.
- The original oracle and capture-source hashes remain unchanged. This record
  is a preparation checkpoint, not author handoff or product certification.
