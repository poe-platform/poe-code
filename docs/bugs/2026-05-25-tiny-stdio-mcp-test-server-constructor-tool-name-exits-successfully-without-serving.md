# Tiny stdio MCP test server constructor tool name exits successfully without serving

## Summary

The `tiny-stdio-mcp-test-server` CLI advertises exactly two values for `serve <tool>` and reports an error for unknown tools. Passing `constructor`, which is not an advertised tool, resolves through the plain-object dispatch table's inherited `Object.prototype.constructor` property; the CLI invokes it, returns without starting any MCP server, and exits with status `0`.

## Reproduction

From the repository root, compare an ordinary unknown tool with the inherited prototype-key tool name:

```sh
npm exec -- tsx packages/tiny-stdio-mcp-test-server/src/cli.ts serve definitely-unknown >/tmp/tiny-stdio-unknown.out 2>&1
printf 'unknown_exit=%s output=' "$?"
cat /tmp/tiny-stdio-unknown.out

npm exec -- tsx packages/tiny-stdio-mcp-test-server/src/cli.ts serve constructor >/tmp/tiny-stdio-constructor.out 2>&1
printf 'constructor_exit=%s output=' "$?"
cat /tmp/tiny-stdio-constructor.out
```

The commands print:

```text
unknown_exit=1 output=Unknown tool: definitely-unknown. Available: encrypt, word-of-the-day
constructor_exit=0 output=
```

## Observed Behavior

`packages/tiny-stdio-mcp-test-server/src/cli.ts:20` through `packages/tiny-stdio-mcp-test-server/src/cli.ts:23` construct the available server launchers as a normal object. The lookup at `packages/tiny-stdio-mcp-test-server/src/cli.ts:25` reads `servers[tool]`, and the rejection at `packages/tiny-stdio-mcp-test-server/src/cli.ts:26` only runs when that result is falsy. For `tool === "constructor"`, the inherited built-in constructor function is truthy, so the CLI runs `await start()` and returns successfully even though neither `createEncryptServer().listen()` nor `createWordOfTheDayServer().listen()` executes.

## Expected Behavior

The `serve` command should start only explicitly declared tools, `encrypt` and `word-of-the-day`. Any other name, including JavaScript inherited-property names such as `constructor`, should print the unknown-tool message and exit nonzero.

## Impact

Integration tests, fixture orchestration, or user scripts can receive a successful process exit when they intended to start a test MCP server but supplied a malformed or attacker-controlled tool name. This can mask setup errors and cause downstream clients to fail confusingly because no server was ever launched.
