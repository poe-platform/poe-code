# Issue 755: host-mediated native redirects

## Implementation and acceptance

- Reproduce fulfilled 302/307 bypass with a real browser and a destination-owned
  counter, independently of the host fetch log.
- Export one public CDP helper from the existing Safe Bash Playwright import.
  Keep CLI/help/session syntax unchanged and retain host ownership of credentials.
- Acquire an exclusively owned browser with independent lifetime denial of direct
  HTTP(S)/WebSocket egress. Keep the stronger all-protocol host declaration
  available, without making it a prerequisite for an HTTP-only policy.
  The declaration asserts an existing independent host boundary; it cannot
  configure or verify one. The supported Cloudflare integration has no identified
  provider-enforced WebRTC/UDP restriction. Its guardrails document HTTP/HTTPS
  only; hosts requiring all-protocol admission/accounting must refuse that
  integration before session acquisition, not assert the stronger declaration.
  Do not treat deleting page JavaScript APIs as a provider boundary. See the
  [supported scope and host admission contract](../../packages/safe-bash/src/contracts/playwright-network-policy.md).
  Install browser-level flattened CDP auto-attachment before exposing
  pages, arm descendant pages/frames before resume, and keep unsupported workers
  paused. Never combine it with Playwright route interception.
- Fulfill each bounded, authorized host response at its original request hop so
  Chromium performs the redirect. Preserve native methods, cookies and origins.
- Bound requests, targets, protocol commands, headers and body transfers. Propagate
  native cancellation and drain cooperative cleanup even on retirement failure.
- Qualify forbidden destinations, native final URLs, all five redirect codes,
  text/binary POST bodies, relative resources, cross-origin credentials, frames,
  popups/nested popups, workers, concurrent contexts and transport loss.

## Repeatable qualification

1. Build with the maintained workspace/root route, then run the focused Playwright
   unit scope and package typecheck. Run the guarded repository ESLint route.
2. Run `node --import tsx --test
   packages/safe-bash/tests/integration/playwright-network-policy-native.test.mjs`
   with `PLAYWRIGHT_TEST_MODULE` set to the installed Playwright module URL and,
   if needed, `PLAYWRIGHT_TEST_EXECUTABLE` selecting Chromium. The fixture supplies
   its own denying browser proxy and independent forbidden HTTP server.
   Set `SAFE_BASH_NETWORK_POLICY_MODULE` to an installed artifact's module URL to
   run the same matrix against packed or published code.
3. Run `node --test
   packages/safe-bash/tests/integration/playwright-network-policy.test.mjs` with
   `SAFE_BASH_CF_RUNTIME_ROOT` selecting the pinned Cloudflare1.3.6/Miniflare runtime.
   An explicit `SAFE_BASH_POLICY_BASELINE=1` runs the unsafe routing control;
   its forbidden-counter assertion must fail where native egress is enabled.
4. Run the exact Worker entry and helper snapshot on the real Cloudflare binding,
   using an independently counted public forbidden destination. Confirm the
   counter's positive control, deny-all profile, both CDP/Playwright clients,
   native fulfilled redirects, and zero additional hits after policy/both clients
   disconnect. Include actual ws/wss positive controls and denial with retirement
   deliberately held after policy-socket loss. HTTP/WS checks do not establish
   WebRTC/UDP enforcement; #758 documents that unsupported stronger guarantee.
   A future enforcement fix requires independent UDP/STUN/TURN destination
   observations with a positive reachability control, including policy connection
   loss while the browser remains alive. Do not count that future qualification
   as passed by this HTTP redirect matrix or disclose observed addresses/secrets.
5. Verify the actual host integration uses bounded manual Worker fetch, standard
   CLI commands, precise host diagnostics and owned session retirement. Exercise
   ordinary redirecting sites; anti-bot responses remain site behavior.
   Independently enforce user/agent ownership on acquisition and reuse; network
   admission and guest-selected CLI session names are not ownership authority.
6. Commit only owned source/tests/docs. Fetch and rebase, push directly to main,
   verify remote ancestry, then close the issue only when the complete fix is
   qualified. Monitor GitHub publication and verify exact registry source and
   integrity separately from the Git push.

## Evidence discipline

Store run output under owned `out/issue755`; preserve failing baselines alongside
corrected runs until delivery. The supervisor's exact source snapshots and
provider tests must be distinguished from final committed-source qualification.
The first native baseline reached forbidden destinations after one route callback.
The initial native helper matrix found that blocking every URL via CDP also
suppresses subresource interception; only WebSocket URLs are blocked in CDP.
Persistent external egress denial remains required. Chromium cannot reliably
close every worker using Target.closeTarget, so unsupported workers stay paused.
No private SDK patch, local npm publication or unverified egress exception is used.
