# MCP OAuth readLine rejection leaves authorization waiting forever

## Summary

The exported `mcp-oauth` loopback authorization session accepts a `readLine()` fallback for pasted callback codes, but silently discards a rejection from that input source. If manual-input collection fails and no browser callback arrives, `waitForCode()` remains pending indefinitely instead of returning the input failure to the MCP OAuth caller.

## Reproduction

From the repository root, create a public loopback session whose manual-input source rejects immediately and race its result promise against a short timeout:

```sh
probe=$(mktemp -d /tmp/mcp-oauth-readline-reject-probe.XXXXXX)

cat > "$probe/repro.mts" <<EOF
import { createLoopbackAuthorizationSession } from "file://$PWD/packages/mcp-oauth/src/client/loopback-authorization.ts";

const session = await createLoopbackAuthorizationSession({
  readLine: async () => { throw new Error("stdin failed"); }
});
const result = await Promise.race([
  session.waitForCode("https://auth.example.invalid/authorize").then(
    () => "resolved",
    (error) => "rejected:" + error.message
  ),
  new Promise<string>((resolve) => setTimeout(() => resolve("timed-out"), 100))
]);
console.log(result);
session.close();
EOF

./node_modules/.bin/tsx "$probe/repro.mts"

nl -ba packages/mcp-oauth/src/client/loopback-authorization.ts | sed -n '52,129p'
nl -ba packages/mcp-oauth/src/index.ts | sed -n '1,60p'
```

## Observed Behavior

The input source rejects immediately, but the exported MCP OAuth wait never rejects within the timeout:

```text
timed-out
```

`waitForAuthorizationCode()` installs the manual fallback in `packages/mcp-oauth/src/client/loopback-authorization.ts:104` through `packages/mcp-oauth/src/client/loopback-authorization.ts:121`, where `options.readLine().catch(() => undefined)` explicitly discards the failure. `packages/mcp-oauth/src/index.ts:8` through `packages/mcp-oauth/src/index.ts:12` publicly export this session constructor for MCP OAuth integrations.

## Expected Behavior

When the configured manual-input source fails, `waitForCode()` should reject with that error unless another authorization channel has already successfully completed. The exported MCP authorization API must not silently turn unavailable input into an indefinite wait.

## Impact

MCP clients using manual callback entry can hang indefinitely after stdin, prompt, or other input collection fails. Authentication orchestration receives no failure to recover from, retry, or surface to the user.
