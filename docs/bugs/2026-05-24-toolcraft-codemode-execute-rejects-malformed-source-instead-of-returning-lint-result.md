# Toolcraft codemode execute rejects malformed source instead of returning lint result

## Summary

`toolcraft-codemode` documents its `execute` meta-tool as returning an `ExecuteResult` union, including `{ ok: false, kind: "lint", diagnostics }` for invalid generated source. However, malformed agent-script syntax causes the tool handler promise to reject with a parser exception before it reaches the protected runtime execution block, so clients receive a thrown tool error instead of the documented lint result shape.

## Reproduction

From the repository root, run a disposable Vitest probe that calls `execute` with incomplete agent-script source:

```sh
cat > /tmp/toolcraft-codemode-malformed-source-probe.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { defineGroup } from "toolcraft";
import { createSDK } from "toolcraft/sdk";
import { codeMode } from "./index.js";

describe("codemode malformed source", () => {
  it("rejects instead of returning the documented ExecuteResult", async () => {
    const sdk = createSDK(codeMode(defineGroup({ name: "ops", children: [] }))) as {
      execute(input: { source: string }): Promise<unknown>;
    };
    const outcome = await sdk.execute({ source: "return (" }).then(
      (value) => ({ resolved: value }),
      (error: unknown) => ({ rejected: error instanceof Error ? error.message : String(error) })
    );
    console.log(JSON.stringify({ malformedSource: outcome }));
    expect(outcome).toEqual({ rejected: "Unexpected end of input at line 1, column 9." });
  });
});
EOF
cp /tmp/toolcraft-codemode-malformed-source-probe.test.ts packages/toolcraft-codemode/src/__probe__.test.ts
trap 'rm -f packages/toolcraft-codemode/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/toolcraft-codemode/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The invalid script rejects the `execute` call instead of resolving to an `ExecuteResult` object:

```text
{"malformedSource":{"rejected":"Unexpected end of input at line 1, column 9."}}
✓ packages/toolcraft-codemode/src/__probe__.test.ts > codemode malformed source > rejects instead of returning the documented ExecuteResult
```

The published return contract in `packages/toolcraft-codemode/README.md:47` through `packages/toolcraft-codemode/README.md:60` states that `execute` returns the `ExecuteResult` union and that lint failures return `{ ok: false, kind: "lint", diagnostics }`. In the implementation, `packages/toolcraft-codemode/src/execute.ts:128` through `packages/toolcraft-codemode/src/execute.ts:141` invoke `lint()` outside the `try` block, while only execution at `packages/toolcraft-codemode/src/execute.ts:143` through `packages/toolcraft-codemode/src/execute.ts:169` is converted to a result object. Parser exceptions raised while linting therefore escape the tool handler.

## Expected Behavior

Malformed source submitted to `execute` should resolve using the documented failure result contract, such as a lint diagnostic response, rather than reject the tool invocation with an uncaught parser error.

## Impact

Generated code commonly contains syntax mistakes during iterative tool use. Instead of allowing an MCP client or model to inspect structured diagnostics and correct its script, codemode converts this ordinary invalid-input case into an exceptional tool failure, breaking its stated API contract and degrading recovery behavior.
