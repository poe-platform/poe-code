# Browser-native redirects with a host network policy

`installPlaywrightNetworkPolicy` is exported from
`@poe-platform/safe-bash/playwright`. It intercepts every HTTP request and redirect
hop through an exclusively owned public Chromium CDP WebSocket. Chromium still
performs navigation, cookie processing, origin changes, relative URL resolution,
and redirect method/body rewriting. Standard CLI commands and sessions are unchanged.

The helper requires **independent denial of direct browser HTTP(S) and WebSocket
egress**. Fetch interception disappears when its CDP connection dies; a JavaScript
close handler cannot protect a browser after the host process or Worker isolate
dies. Use `directNetwork: 'http-blocked-by-host'` when the host denies HTTP(S),
`ws://`, and `wss://` outside the policy's lifetime. Admitted HTTP work runs through
the separate host fetch callback. The existing `directNetwork: 'blocked-by-host'`
value additionally declares independent denial of every other protocol, including
WebRTC/UDP. Neither declaration configures or verifies the external boundary.

The HTTP policy does not mediate or establish denial of WebRTC/UDP, TURN,
WebTransport, or other non-HTTP transports. Their availability remains the host's
separate responsibility. Do not use this helper as an all-protocol sandbox or
claim that these transports consume the HTTP callback's transfer budget.

Cloudflare Playwright 1.3.6 exposes lifetime-latched
`acquire(binding, { guardrails: { allowedDomains: [] } })`. The empty allowlist is
the documented deny-all **HTTP/HTTPS** profile in
[Cloudflare Browser Run guardrails](https://developers.cloudflare.com/browser-run/features/guardrails/).
Omitting both allowlist properties leaves HTTP/HTTPS unrestricted. Do not add
`allowedDomainSets` or nonempty `allowedDomains` to this profile: they permit
direct traffic outside host admission and transfer accounting.
Actual Cloudflare tests also
verified `ws://` and `wss://` denial against an independently counted destination:
unguarded positive controls connected; guarded sessions made no connection both
with a healthy policy and after its socket closed while retirement was delayed
and the ordinary Playwright client stayed alive. This qualifies the HTTP-scoped
setting in the example below, not the stronger `'blocked-by-host'` declaration.

Actual Cloudflare tests obtained WebRTC server-reflexive ICE candidates from
public STUN servers both with the prior production adapter and with this helper.
That pre-existing non-HTTP limitation is tracked in
[poe-code issue 758](https://github.com/poe-platform/poe-code/issues/758).
The supported integration has no identified provider-enforced WebRTC/UDP
restriction: the documented guardrails cover HTTP/HTTPS, and the
[1.3.6 acquisition options](https://github.com/cloudflare/playwright/blob/v1.3.6/packages/playwright-cloudflare/index.d.ts)
expose no immutable WebRTC/UDP disable setting. Deleting JavaScript APIs such as
`RTCPeerConnection`, injecting page scripts, or requesting retirement on CDP loss
does not establish an independent boundary for a still-live browser.

Hosts requiring **all-protocol URL admission or transfer accounting must reject
this Cloudflare integration before acquiring or exposing a session**. Do not set
`directNetwork: 'blocked-by-host'` to request a stronger mode: it asserts a
boundary the host already supplies, which these Cloudflare guardrails do not
establish. Supporting that requirement needs a separately enforced and qualified
provider/network boundary; neither the HTTP redirect fix nor this helper supplies
one. A host that explicitly accepts HTTP-only admission/accounting can use the
example below with the non-HTTP limitation retained.

Verify the provider's denial on your deployed runtime, including after both
clients disconnect. WebSocket denial above is tested provider behavior, not an
extension of Cloudflare's documented HTTP/HTTPS guarantee. The native fixture
uses a denying HTTP proxy and a WebSocket positive control; it does not establish
UDP enforcement. Any future non-HTTP enforcement qualification must independently
observe UDP/STUN/TURN destinations, include a positive reachability control, and
test policy connection loss while the browser remains alive. HTTP counters,
absence of ICE candidates, and mocked CDP tests alone are not that evidence.

Network scope never replaces session authorization: the trusted host must bind
each acquisition/reuse to its user/agent owner independently of guest-selected
CLI session names. The HTTP-only choice does not permit cross-owner reuse or
retirement of another owner's browser; standard CLI syntax remains unchanged.

```ts
import { acquire, connect } from '@cloudflare/playwright';
import { installPlaywrightNetworkPolicy } from '@poe-platform/safe-bash/playwright';

// HTTP/WebSocket policy only; non-HTTP transports require separate host policy.
const { sessionId } = await acquire(binding, {
  guardrails: { allowedDomains: [] },
});
let browser;
let policy;
try {
  const response = await binding.fetch(
    `http://fake.host/v1/devtools/browser/${sessionId}`,
    { headers: { Upgrade: 'websocket' } },
  );
  if (!response.webSocket) throw new Error('Browser CDP upgrade failed');
  response.webSocket.accept();
  policy = await installPlaywrightNetworkPolicy({
    socket: response.webSocket,
    directNetwork: 'http-blocked-by-host',
    fetch: boundedHostFetch,
    onRequestFailure: reportHostFailure,
    async retire() {
      try { await browser?.close(); }
      finally { await deleteAndVerifyOwnedSession(binding, sessionId); }
    },
  });
  browser = await connect(binding, sessionId);
  // Expose this browser to the standard adapter only after policy installation.
  // Keep both clients alive for the owned session's useful lifetime.
} catch (error) {
  if (policy) await policy.dispose();
  else await deleteAndVerifyOwnedSession(binding, sessionId);
  throw error;
}
// When the owner releases the session:
await policy.dispose();
```

`boundedHostFetch`, `reportHostFailure`, and `deleteAndVerifyOwnedSession` are
application callbacks in this example. The last callback must terminate exactly
the owned remote session, even if Playwright connection or cleanup failed. It
must verify provider success instead of treating a disconnect as termination.
Never terminate a borrowed browser. No page/context `route` handler or second
Fetch interception owner may be installed.

The request callback receives `url`, `method`, ordered `headers`, optional owned
binary `body`, `signal`, `targetId`, `frameId`, `requestId`, and `resourceType`.
It must authorize the URL **before outbound work**, use manual redirects, enforce
streaming byte limits and a deadline, and cancel/drain its resources when the
signal aborts. Return `{ status, headers: [{ name, value }], body: Uint8Array }`.
Preserve separate `Set-Cookie` headers and supply headers matching the decoded
body; remove content encoding/length when your fetch implementation decoded it.
Never automatically follow redirects or buffer an unbounded response.

A response may include `release(): void | Promise<void>` to release a retained
host transfer permit or response resource. The helper captures it immediately
when `fetch` resolves and calls it exactly once after the browser acknowledges
delivery, or after rejection/cancellation. This includes invalid responses and
responses that arrive after cancellation. Asynchronous release is awaited;
disposal drains it. Release failure retires the browser and rejects disposal.
Retirement failure takes precedence if both operations fail.

Keep the host's transfer permit until this callback, including while CDP delivery
is stalled. Limiting simultaneous host fetches alone does not bound already
fetched responses retained for browser delivery. `maxConcurrentRequests` bounds
request admission and retires on overload; it is not a substitute for a host's
queued transfer semaphore or a byte budget. The host must separately bound the
bytes and number of retained responses. Release callbacks must settle their own
cooperative cleanup and must not await policy disposal, which awaits them.
Report cleanup failures from `release`, not the ordinary cancellation or failure
of the request whose resources are being released.

The helper's response cap is a second check after the host returns its bounded
body. It cannot retroactively bound allocation inside an arbitrary host callback.
Defaults are a 30-second request deadline, 8 MiB response, 1 MiB request body,
64 active requests, and 64 attached targets. Options are `requestTimeoutMs`,
`maxResponseBytes`, `maxRequestBytes`, `maxProtocolMessageBytes`,
`maxConcurrentRequests`, and `maxTargets`.
Header lists are limited to 1,024 entries and 64 KiB UTF-8; incoming CDP JSON is
limited to 8 MiB UTF-8 by default. `maxProtocolMessageBytes` can increase that
limit up to a hard maximum of 32 MiB. For an 8 MiB printable upload, configure
both `maxRequestBytes: 8 * 1024 * 1024` and
`maxProtocolMessageBytes: 32 * 1024 * 1024`: Chromium's JSON/base64 envelope
also consumes transport space. Heavily escaped binary bodies can exceed the
transport limit even when their decoded body fits; such messages retire the
session. A provider may impose a stricter transport limit.
Protocol commands and target/request admission are
bounded; overload retires the browser. Incomplete binary upload data is rejected.

`onRequestFailure` receives stable CDP `targetId`, `frameId`, `requestId`,
`resourceType`, and a message of at most 1,024 characters. The request ID is the
Network ID when available and otherwise the Fetch ID. The host can obtain a
page's target ID with its public CDP `Target.getTargetInfo` command and correlate
main-document errors without another routing handler. Diagnostic callback errors
do not allow network continuation. Keep callbacks synchronous and non-reentrant.

Pages and iframe targets are armed before execution resumes. Dedicated workers,
shared workers, and other unsupported target types remain paused until their
owner terminates them or the session retires; they count toward the target limit.
Pages that depend on those workers may behave differently from an ordinary
Playwright browser. Service-worker interception is bypassed. WebSocket requests are
blocked. Browser request cancellation, target closure, and policy disposal abort
associated host work. Normal same-owner reuse is supported while both connections
remain alive. Cold attachment to already navigated targets is refused; retire
that session and acquire a fresh guarded session rather than silently dropping
its policy. Transparent reconnect restoration is not provided.

`dispose()` is idempotent, closes request admission, aborts host work, retires the
browser, and drains cooperative cleanup before detaching interception. Retirement
failure rejects disposal and leaves the interceptor attached. Transport loss
automatically starts this same retirement; retain the handle and observe its
disposal result. All host callbacks, including retirement, must settle their
cooperative cleanup; the helper does not forcibly stop an uncooperative promise.
