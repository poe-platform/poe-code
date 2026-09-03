# Explicit network commands

The user explicitly requested **"i also need curl"**. This is an HTTP(S) curl
author increment, not complete curl, a security certification, or broad parity.
`agentCommands()` does not install it. There are no runtime dependencies, native
processes, host filesystem reads, proxy environment reads, curlrc/netrc reads,
cookie jars, or global TLS/environment mutations in this implementation.

```ts
import { createOriginAuthorizer, networkCommands, Shell } from "virtual-bash";

const shell = new Shell({ fs, cwd: "/work" }).use(networkCommands({
  authorize: createOriginAuthorizer(["https://api.example.com"]),
}));
const result = await shell.exec("curl --json '{\"enabled\":true}' https://api.example.com/tasks");
```

The API is exported by this subtree's `index.ts`, the package root, and
`virtual-bash/commands/network`. `networkCommands` and
`curlCommands` are aliases. `createNetworkCommands`/`createCurlCommands` return
one `CommandDefinition`, and `createCurlCommand` returns that definition directly.
Registration rejects a duplicate `curl` unless `replace: true` is explicit.

## Host contract

`NetworkCommandsOptions` requires `authorize: NetworkAuthorizer` and accepts
`transport?: HttpTransport`, `limits?: Partial<NetworkLimits>`, `replace?: boolean`.
Authorization receives `{ url, method, attempt, redirectFrom?, signal }`, and must
return exactly `true` to allow a request. It runs on every hop and retry, before
the transport starts. URL userinfo is removed before policy/transport invocation;
initial URL credentials can generate Basic authentication. Rejected policies
and exceptions never expose their details to command diagnostics.

The default transport is Node `http`/`https`, not fetch: responses are not
automatically decompressed or redirected, duplicate raw response headers are
preserved, and request writes await callbacks before pulling additional bytes.
`createNodeHttpTransport({ ca?, maxHeaderBytes? })` allows host-injected CA material
without a command-line TLS bypass. Custom transports accept
`{ url, method, headers, body?: AsyncIterable<Uint8Array>, signal }` and return
`{ status, statusText, headers, httpVersion?, body, dispose() }`.
They MUST perform one request only, preserve encoded response bytes, respect
backpressure and cancellation, and release resources in `dispose`. Late responses
after timeout are disposed; rejected late promises are observed. A transport
ignoring its signal cannot be forcibly stopped by this plugin.

Cloudflare Workers and browsers can inject `createFetchTransport()`. It uses the
host `fetch`, forces manual redirects so each hop returns to the authorizer,
omits ambient credentials, and streams request and response bodies. Pass a
specific Fetch function as `createFetchTransport({ fetch })` when the host does
not expose it globally.

`createOriginAuthorizer(allowlist?)` accepts exact origins (scheme, host, and
port) or hostnames. Its omitted/default allowlist is `"*"`, which deliberately
allows every HTTP(S) destination. Use an explicit list whenever scripts can see
secrets or SSRF matters. Hostname/origin policy cannot detect a public hostname
that DNS resolves to a private address; enforce DNS/IP policy in the transport.
`createOriginAuthorizer(allowlist, { denyPrivateNetworks: true })` additionally
rejects literal loopback, link-local, RFC-1918, and IPv6 local addresses. It does
not perform DNS resolution and is therefore defense in depth, not DNS pinning.

URL authorization is not DNS pinning or an SSRF sandbox. Hosts needing destination
IP guarantees must provide a transport that validates/pins actual connections.
An allow-all callback or `createOriginAuthorizer()` explicitly grants broad
outbound HTTP(S) authority.

## Implemented command subset

| Area | Supported forms and boundaries |
| --- | --- |
| URLs/methods | Explicit HTTP(S) URLs; sequential URLs to stdout; `--url`, `-X/--request`, `-I/--head`, `-G/--get`; no scheme guessing or URL glob expansion (`-g` permits literal brackets/braces). CONNECT and TRACE are rejected. |
| Headers/auth | Repeated `-H/--header`; empty-value suppression and semicolon empty headers; `-A/--user-agent`, `-e/--referer`, `-u/--user user:password`, `--basic`, `--oauth2-bearer`. No prompting. Host, Content-Length, Transfer-Encoding, Connection, Upgrade, Expect and Proxy-Authorization are transport-controlled and rejected as custom headers. |
| Request data | `-d/--data/--data-ascii`, `--data-raw`, `--data-binary`, `--data-urlencode`, `--json`; literal, `@VFSFILE`, `@-` stdin; repeated data joins with `&`, repeated JSON concatenates. JSON bytes are not syntax-validated. `-d @file` removes CR/LF/NUL; binary retains bytes. |
| Uploads/forms | `-T/--upload-file FILE` or `-` uses PUT unless overridden. `-F/--form name=value`, `name=@file`, `name=<file`, optional `;type=TYPE`/`;filename=NAME`, and `--form-string`. File parts default to application/octet-stream rather than filename MIME guessing. Nested forms, file lists, quoting grammar and other attributes are rejected. |
| Response files | `-o/--output`, `-O/--remote-name`, `-D/--dump-header`; paths are VFS-relative, `-` means stdout. `-O` uses the original URL path basename without percent decoding or Content-Disposition trust. Parents must exist. Multiple URLs with file/header outputs are rejected instead of pretending curl's positional output rules. |
| HTTP status | `-f/--fail`, `--fail-with-body`, `-s/--silent`, `-S/--show-error`; HTTP errors otherwise return zero. No progress meter is generated. `-v` emits method/origin, header names with all values redacted, and numeric response status. Explicit body/header outputs remain raw. |
| Redirects | `-L/--location`, `--max-redirs`; 301/302/303 method/body changes and 307/308 replay; explicit `-X` is retained. HTTPS downgrade and credential-bearing Location URLs are rejected. All custom request headers and generated credentials are dropped permanently after crossing origins, more conservative than native curl. |
| Deadlines/retries | `-m/--max-time` covers authorization, upload, response, body output and retry sleeps for each URL; host ceiling always applies. `--retry` retries completed HTTP 408/429/500/502/503/504 responses after output publication (subject to fail modes); `--retry-delay` and Retry-After are bounded by the deadline. Network, partial-transfer and output failures are not retried. |
| Write-out | `-w/--write-out`, including `@VFSFILE`/`@-`; `http_code`, `response_code`, `url_effective`, `redirect_url`, `content_type`, `size_download`, `size_upload`, `num_redirects`, `num_retries`, `time_total`, `exitcode`, `errormsg`, `filename_effective`, `method`, `http_version`; `%%`, `\n`, `\r`, `\t`. Unsupported variables fail before requests. Final write-out/diagnostics observe shell cancellation, outside the completed transfer deadline. |

`--disable`, `--no-buffer`, `--no-progress-meter` are accepted because config
loading, progress meters and stdout buffering are never enabled. Help/version
identify the virtual implementation, not a fabricated libcurl version.
Unknown flags fail, including proxy/config/netrc, `--connect-timeout`, `-k`,
`--compressed`, CA/cert file flags, cookie-jar, HTTP/2/3, ranges, resume, parallel,
`--location-trusted`, `--retry-all-errors`, and non-HTTP protocols. In particular,
connect-only timeouts are not relabeled as total timeouts.

## Streaming, quotas and failure state

Defaults: 64 MiB upload, 64 MiB response body, 8 MiB replay/query/argument buffer,
64 KiB combined redirect headers, ten redirects, five retries, 32 URLs, and
120 seconds per URL including retries. CLI settings cannot raise host ceilings.
For Workers, pass `limits: cloudflareWorkerNetworkLimits`; its worst-case URL,
retry, and redirect combination is 48 fetches, within the smallest 50-subrequest
budget, and its byte/deadline ceilings are substantially smaller.

`options.limits.maxRedirects` and `maxRetries` accept safe integers in the inclusive
range 0–9,007,199,254,740,991 (`Number.MAX_SAFE_INTEGER`), including JavaScript `-0`.
Their defaults remain 10 and 5 respectively. Zero permits the initial authorized
request but forbids additional redirect or retry requests of that kind, even with
`-L`, `--max-redirs`, `--retry` or `Retry-After`. These are independent per-input-URL
caps, not a global network denial: zero redirects can still allow status retries,
and zero retries can still allow redirects. Redirect counts restart for each retry;
with both caps zero, each input URL makes at most one transport request. CLI retries
still default to zero. A blocked redirect with `-L` returns 47; a blocked retry
retains the initial response and normal fail/output semantics without retry sleep
or upload replay. An initial stdin upload larger than its replay cache can still
succeed within the upload quota; zero does not require replay or deny initial reads.

All other host limits require positive safe integers: `maxUploadBytes`,
`maxDownloadBytes`, `maxBufferBytes`, `maxHeaderBytes` and `maxUrls` accept the
inclusive range 1–9,007,199,254,740,991. `maxTimeMs` accepts the inclusive range
1–2,147,483,647 milliseconds. Explicit invalid overrides are rejected, not defaulted.

Body bytes stream between VFS/stdin, HTTP, stdout and VFS; filesystem providers
may themselves buffer. A file upload is reopened when replay is necessary, so a
concurrently modified file is not a snapshot. Stdin initially streams with a
bounded replay cache: if incomplete or larger than that cache, a retry/307/308
returns 65 rather than silently sending a truncated body. URL query generation
and nonstreaming VFS read fallback are bounded buffers.

VFS output uses `writeStream` when present, otherwise sequential write/append
operations; there is no host-file fallback. Publication/partial-file state follows
the selected adapter, not a claimed cross-backend atomic transaction. Read-only,
quota, missing-parent and write failures remain failures. Body/header paths must
not be the same lexical file; aliases or concurrently replaced paths are not
globally atomic. A downstream sink error disposes the response and destroys the
Node request. Empty chunks yield periodically so timeout cancellation is not
starved by an infinite microtask producer.

Retry response bodies stream to stdout, including pipes, shell redirections and
`-o -`; already emitted bytes are not withdrawn. Curl-managed `-o FILE`/`-O`
outputs are written for each attempt and, if that attempt wrote bytes, reset to
empty before retry sleep. Reset failures stop with 23; a later denial, timeout or
cancellation can leave an empty file rather than the old content. Header dumps
(`-D`) append all attempts; included headers (`-i`/`-I`) follow body-output
destination/reset behavior. `--fail` suppresses HTTP-error bodies, not included
headers, while `--fail-with-body` retains the body. Failed attempts in those modes
emit diagnostics unless silenced; final status and `size_download` describe the
last attempt. Download limits apply per response; shell output limits still
cover all emitted attempts. Each retry is authorized anew and can duplicate
accepted POST effects: file resets are not server-side rollback. This preserves
the existing total per-URL deadline, not native curl's per-attempt timeout model.

Exit codes include 1 unsupported protocol, 2 invalid/unsupported option,
3 malformed URL, 6 DNS, 7 connection/policy rejection, 18 partial body,
22 HTTP failure, 23 output failure, 26 upload/read failure, 28 timeout,
35 TLS negotiation, 47 redirect limit, 56 transfer failure, 60 TLS verification,
63 byte quota and 65 unavailable replay. Caller abort propagates the original
signal reason to the shell instead of masquerading as an ordinary HTTP result.

## Author evidence and independent review boundary

`node --unhandled-rejections=strict --import tsx --test tests/commands/network/*.test.ts`
passes the first 80 author checks on Node 22.22.2, including live local HTTP(S),
native `/usr/bin/curl` 8.7.1, memory/real VFS, actual shell pipelines, multipart,
cross-origin authorization, late rejections, quotas, EPIPE and cancellation.
Strict scoped TypeScript passes. No external requests/uploads are used by tests.
The committed TLS key is generated public loopback test material, never a
production credential; its certificate is trusted only by the injected test transport.

The first 36-case run had two genuine URL-encoding mismatches and two response
header comparisons dependent on client connection behavior. Encoding was fixed;
the server now explicitly sends Connection: close to both implementations.
No expected response bytes were changed to match virtual output. Tests preserve
status/body/header comparisons against the independently executed native tool.
Author tests are not independent certification. Archimedes owns the disjoint
`tests/commands/network-stress/**` review. The separately reported shell upstream
pipeline-close defect belongs to Sagan; direct curl sink-close tests do not
prove that shell defect resolved.

Primary reference: `https://curl.se/docs/manpage.html`, consulted August 26, 2026.
The live installed oracle is specifically curl 8.7.1, not a claim of current
native-version parity. The current manual permits fractional retry delays;
that flag is tested directly rather than falsely attributed to the older oracle.
