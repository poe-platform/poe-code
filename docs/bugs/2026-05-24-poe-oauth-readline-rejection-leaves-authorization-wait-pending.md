# Poe OAuth readLine rejection leaves authorization waiting forever

## Summary

The exported `poe-oauth` loopback authorization flow accepts a `readLine()` fallback for pasted callback codes, but silently discards a rejection from that input source. If terminal/manual-input collection fails and no browser callback arrives, `waitForResult()` remains pending indefinitely instead of surfacing the input failure.

## Reproduction

From the repository root, construct an OAuth client whose manual-input source rejects immediately and race its public result promise against a short timeout:

```sh
probe=$(mktemp -d /tmp/poe-oauth-readline-reject-probe.XXXXXX)

cat > "$probe/repro.mts" <<EOF
import { createOAuthClient } from "file://$PWD/packages/poe-oauth/src/oauth-client.ts";

const client = createOAuthClient({
  clientId: "probe-client",
  readLine: async () => { throw new Error("stdin failed"); },
  fetch: async () => { throw new Error("token exchange should not happen"); }
});

const authorization = await client.authorize();
const result = await Promise.race([
  authorization.waitForResult().then(
    () => "resolved",
    (error) => "rejected:" + error.message
  ),
  new Promise<string>((resolve) => setTimeout(() => resolve("timed-out"), 100))
]);
console.log(result);
process.exit(0);
EOF

./node_modules/.bin/tsx "$probe/repro.mts"

nl -ba packages/poe-oauth/src/loopback-authorization.ts | sed -n '52,129p'
nl -ba packages/poe-oauth/src/oauth-client.ts | sed -n '49,95p'
```

## Observed Behavior

The input source rejects immediately, but the exported authorization promise does not reject within the timeout:

```text
timed-out
```

`waitForAuthorizationCode()` installs the manual fallback in `packages/poe-oauth/src/loopback-authorization.ts:104` through `packages/poe-oauth/src/loopback-authorization.ts:121`, where `options.readLine().catch(() => undefined)` explicitly discards the failure. `createOAuthClient().authorize()` exposes that pending wait through `waitForResult()` in `packages/poe-oauth/src/oauth-client.ts:77` through `packages/poe-oauth/src/oauth-client.ts:94`.

## Expected Behavior

When the configured manual-input source fails, `waitForResult()` should reject with that error unless another authorization channel has already successfully completed. The API must not silently turn a terminal/input failure into an indefinite wait.

## Impact

CLI integrations, plugins, or embedded applications using the exported OAuth client can hang forever after stdin, prompt, or other manual callback collection fails. The caller receives no actionable failure and cannot distinguish an unavailable input channel from an authorization attempt still in progress.
