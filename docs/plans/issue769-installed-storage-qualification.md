# Installed-public storage qualification (#769)

## Frozen inputs

Replay the independently installed registry packages
`@poe-platform/safe-{bash,fs,js}@0.1.686`, source
`cfd11d65979002bcf35b31d35ba9465269d33d53`, published by scoped run `35371934675`.
Do not substitute newer main (`459985462` or later), locally packed candidates,
checkout sources, private package paths, or cached older versions.

The maintained public-publication verifier independently checked archive SRI,
provenance source, exact fresh lock identities, real non-symlink installs, and Node
imports. Its successful consumer was retained for this replay. The owned
`out/issue769-registry-0.1.686/installation.json` records that retained path; it is
not an independently sufficient substitute for the verifier's evidence.

Replay admission checks expected version/source against that record, all three
installed manifests and registry lock entries, and actual ESM imports through
the exported `@poe-platform/safe-bash/commands/playwright` subpath. The test does
not use CommonJS resolution for this import-only ESM export. Both worker bundles
record/hash their exact inputs and reject checkout product sources or product
artifacts from the tooling installation. There are no product aliases/overlays.

## Terminal evidence

`packages/safe-bash/tests/plugins/playwright-native-storage-installed.test.ts`
and its pure consumer fixture provide the installed replay, separately from the
already delivered source/bridge tests. Functional terminal results:

- Native Chromium: 1/1 PASS.
- Actual `@cloudflare/playwright@1.3.6`, local workerd BROWSER binding: 1/1 PASS.
- Exact context, selected tab, native tab objects and per-tab sessionStorage retained.
- Cookies/localStorage and omitted closed IDB-only origin removed.
- Imported-only origin saved before any public page visited it; an intervening
  native mutation appears in save output rather than stale imported values.
- Default state-save omits IndexedDB; explicit imported IDB round-trips and the
  second load removes it. Cycles, undefined fields, bigint, typed bytes, dates,
  explicit encoded null, and native nullish fallback behavior agree with the
  source-qualified native setter.
- CF cancellation uses the **public command path**, not a private replacement
  helper. It returns the original cancellation, with zero retained private
  targets, one host release, native browser disconnected and owned remote
  session absent after release.

Evidence under the owned output directory:

- `admission.log`: archive/provenance/fresh-install verification.
- `native-public.tap`, `cf-public.tap`: actual functional terminal results.
- `native/installed-storage-nWlSaJ/{inputs,report}.json`.
- `cf/installed-storage-egSX9L/{inputs,response,report}.json`.
- Lock SHA256: `8322885a255bfaf71742f5d3d50c7e654f2ca2d63566c34ba35e72905c0c8342`.

Reproduce with the existing independent tooling package and executable:

```sh
export SAFE_BASH_STORAGE_RUNTIME=/home/kjopek/project/poe-issue-worktrees-20260918/issue-769-eval/out/issue769-eval/runtime
export SAFE_BASH_STORAGE_ADMISSION="$PWD/out/issue769-registry-0.1.686/installation.json"
export SAFE_BASH_STORAGE_EXPECTED_VERSION=0.1.686
export SAFE_BASH_STORAGE_EXPECTED_SOURCE=cfd11d65979002bcf35b31d35ba9465269d33d53
export SAFE_BASH_STORAGE_CHROMIUM=/home/kjopek/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell
export SAFE_BASH_STORAGE_OUT="$PWD/out/issue769-registry-0.1.686/native"
export TMPDIR="$PWD/out/issue769-storage-replacement/tmp"
node --import "$SAFE_BASH_STORAGE_RUNTIME/node_modules/tsx/dist/loader.mjs" --test packages/safe-bash/tests/plugins/playwright-native-storage-installed.test.ts
```

For CF, set `SAFE_BASH_STORAGE_CF=1`, select the owned `cf` output directory,
and use the existing isolated runtime `HOME`, `XDG_CACHE_HOME`, `CI=1`, and
`MINIFLARE_WORKERD_PATH` from the source qualification. Do not download another
browser/runtime or transfer credentials. Run once per new independent installed
qualification, not as an additional parent release gate.

## Consumer acceptance delta

Existing consumer ownership is established, not unknown:
`poe-internal/poe2` PR14917, head
`d5fd3321f45d54c20236e8144e15aafee54a96f3`, author `kamilio`, has prior exact
`.683` archive/provenance and actual development-account storage, cold-DO and
cross-owner negative evidence. This is not a production rollout claim.

The outstanding **incremental** consumer change is to pin `.686`/the frozen source
above and expose its new trusted `prepareStorageOrigin` acquisition capability.
At that consumer head, `shell-playwright.ts` returns native contexts through its
existing `publicBrowser` wrapper, but its acquired resource does not yet return
the new preparer. Native contexts already expose `newCDPSession`, so no fabricated
Page or caller-asserted native context ID is needed.

In `shell-browser-resource.ts`, wrap the native **client** connection before
`connect` using the public `createPlaywrightPrivateTargetTransport`. Use the
existing `connectSocket(signal)` independent same-owned-browser native socket seam
for the correlated CDP `send`/`subscribe` control supplied to
`createPlaywrightStorageOriginPreparer(control, privateTargets)`. Reject pending
native commands on detach/connection closure and preserve existing acquisition,
interrupt and remote release ownership. Return the resulting preparer from
`shell-playwright.ts`'s acquired resource. This is control-plane target isolation,
not a page HTTP proxy or service-worker/network restriction.

Keep the existing owner/KV namespaces and `persistent-playwright.ts`/
`browser-profile-store.ts` storage hooks. Replay the incremental same-context
preservation, imported-only current readback, second-load removal and cancellation
controls in that existing development-account consumer at its new exact PR head.
Do not demand a new owner discovery exercise, reopen prior 84-case/nine-smoke
qualification wholesale, invent stronger-than-native census guarantees, or make
production rollout an extra library closure condition. The root owner retains
the full command/option inventory acceptance audit; this storage replay proves
its specific installed-package requirement, not unrelated command completeness.
