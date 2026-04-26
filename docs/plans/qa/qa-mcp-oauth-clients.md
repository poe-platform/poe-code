# QA Plan: MCP OAuth Real Clients

Manual QA only. This file is executed by a human or an agent. Do not turn it into a script or wire it into CI.

## Preconditions

- Run every command from the repo root.
- Use `127.0.0.1`, not `localhost`, in every config block so the protected resource, loopback browser redirect, and client caches all refer to the same canonical URL.
- Keep the same browser profile open for a given client while verifying the first and second connection flows.
- Complete the second-connection check before the token expires. This plan uses `--ttl-seconds 600` to give a 10 minute window.
- The healthy fixture should eventually expose these tools: `echo`, `reverse`, `uppercase`, `get_user`.
- The intentionally broken fixture uses a wrong protected-resource value to force an OAuth/resource-metadata error:

```sh
npx tiny-http-mcp-oauth-test-server \
  --hostname 127.0.0.1 \
  --port 43199 \
  --ttl-seconds 600 \
  --resource http://127.0.0.1:43199/wrong-audience
```

The healthy fixture command reused in each section is:

```sh
npx tiny-http-mcp-oauth-test-server \
  --hostname 127.0.0.1 \
  --port 43199 \
  --ttl-seconds 600
```

## Claude Code

Reference: [Claude Code MCP docs](https://code.claude.com/docs/en/mcp)

1. Start the test server:

```sh
npx tiny-http-mcp-oauth-test-server \
  --hostname 127.0.0.1 \
  --port 43199 \
  --ttl-seconds 600
```

2. Add this exact `mcpServers` block to Claude Code. If you use project scope, paste it into `.mcp.json`. If you use local/user scope, place the same object under the relevant `mcpServers` entry in `~/.claude.json`.

```json
{
  "mcpServers": {
    "oauth-fixture": {
      "type": "http",
      "url": "http://127.0.0.1:43199/mcp"
    }
  }
}
```

3. Expected first connection:
   Open Claude Code in this repo, run `/mcp`, and select or inspect `oauth-fixture`.
   Claude Code should discover the server, open the browser for OAuth, show the fixture consent page, return to Claude Code, and then mark the server connected.
   After auth completes, the tool surface should populate. Prove it by confirming the server is connected in `/mcp` and by asking Claude Code to use one fixture tool such as `echo`.

4. Expected second connection:
   Restart Claude Code or reconnect to the same server while the token is still valid.
   No browser should open.
   The server should connect from cache and the tools should be available immediately.

5. Expected misconfigured-server error UX:
   Stop the healthy server, start the broken server command from Preconditions, keep the same Claude Code config, and reconnect.
   Claude Code should surface an auth/discovery/resource-metadata error that makes it clear this is an OAuth problem.
   A generic transport failure with no auth context is a client bug. Record the exact wording.

Observed client-side gaps:
- If Claude Code ignores the hand-edited block but works after `claude mcp add --transport http oauth-fixture http://127.0.0.1:43199/mcp`, record that as a config-loading gap.
- If `/mcp` shows only a generic connection failure for the broken fixture, record that as an auth-error UX gap.

Result:
- [ ] Pass
- [ ] Fail

## Cursor

Reference: check the current config location in the official [Cursor MCP docs](https://docs.cursor.com/en/context/mcp) before editing files. Do not rely on an old path copied from another machine.

1. Start the test server:

```sh
npx tiny-http-mcp-oauth-test-server \
  --hostname 127.0.0.1 \
  --port 43199 \
  --ttl-seconds 600
```

2. Drop this exact block into Cursor's MCP config file at the location the current docs specify:

```json
{
  "mcpServers": {
    "oauth-fixture": {
      "url": "http://127.0.0.1:43199/mcp"
    }
  }
}
```

3. Expected first connection:
   Reload Cursor. Open Settings → MCP to see the server list.
   Connect `oauth-fixture`. Cursor should detect the OAuth requirement, open the browser, show the fixture consent page, and return from the authorization flow.
   Once authorized, the server should appear connected and the tool list should show `echo`, `reverse`, `uppercase`, and `get_user`.

4. Expected second connection:
   Close and reopen the workspace, or reconnect from Settings → MCP while the token is still valid.
   No browser should open.
   The server should reconnect automatically and the tools should appear immediately from the cached session.

5. Expected misconfigured-server error UX:
   Stop the healthy server, start the broken server command from Preconditions, keep the same Cursor config, and reconnect from Settings → MCP.
   Cursor should report an OAuth/resource-metadata/authentication problem, not a generic transport failure.
   Record the exact message if it only says the server failed to connect.

Observed client-side gaps:
- If OAuth only triggers via an explicit button in the settings panel rather than automatically on connect, record that as an auth-trigger gap.
- If the broken fixture is reported as a network or transport error with no auth context, record that as an auth-error UX gap.

Result:
- [ ] Pass
- [ ] Fail

## Cline

Reference: check the current config location in the official [Cline remote MCP docs](https://docs.cline.bot/mcp/connecting-to-a-remote-server) before editing files. Do not rely on a stale path.

1. Start the test server:

```sh
npx tiny-http-mcp-oauth-test-server \
  --hostname 127.0.0.1 \
  --port 43199 \
  --ttl-seconds 600
```

2. Drop this exact block into Cline's MCP config file at the location the current docs specify, or add the same values through the Remote Servers UI:

```json
{
  "mcpServers": {
    "oauth-fixture": {
      "url": "http://127.0.0.1:43199/mcp",
      "type": "streamableHttp",
      "disabled": false
    }
  }
}
```

3. Expected first connection:
   Open Cline's MCP Servers UI and connect `oauth-fixture`.
   Cline should attempt discovery, show an authentication-required state, open the browser, show the consent page, return automatically, and then show the server as connected.
   The tool list should populate with `echo`, `reverse`, `uppercase`, and `get_user`.

4. Expected second connection:
   Reload Cline or reopen the MCP Servers UI while the token is still valid.
   No browser should open.
   The server should reconnect automatically and the tools should appear immediately from cache.

5. Expected misconfigured-server error UX:
   Stop the healthy server, start the broken server command from Preconditions, keep the same Cline config, and reconnect.
   Cline should present a meaningful auth/discovery/resource-metadata error.
   A generic server-unavailable or transport-only error is a client gap. Record the exact wording.

Observed client-side gaps:
- If the same JSON block works only through the UI and not through direct file edits, record that as a config-application gap.
- If the broken fixture is reduced to a generic transport failure, record that as an auth-error UX gap.

Result:
- [ ] Pass
- [ ] Fail

## MCP Inspector Web UI

Reference: [official MCP Inspector README](https://github.com/modelcontextprotocol/inspector)

Prerequisite: the published Inspector currently requires Node `>=22.7.5`.

1. Start the test server:

```sh
npx tiny-http-mcp-oauth-test-server \
  --hostname 127.0.0.1 \
  --port 43199 \
  --ttl-seconds 600
```

2. Save this exact block to a temporary file such as `/tmp/mcp-inspector.oauth-fixture.json`:

```json
{
  "mcpServers": {
    "oauth-fixture": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:43199/mcp"
    }
  }
}
```

Then launch the interactive UI:

```sh
npx @modelcontextprotocol/inspector --config /tmp/mcp-inspector.oauth-fixture.json
```

3. Expected first connection:
   The Inspector UI should open in the browser.
   Select `oauth-fixture` if it is not already selected and connect.
   The browser should redirect to the fixture consent page, then back to the Inspector callback route, and finally the tool list should populate with `echo`, `reverse`, `uppercase`, and `get_user`.

4. Expected second connection:
   Verify the cached path without pressing an explicit Disconnect button first.
   Refresh the Inspector page or reconnect from the same browser session while the token is still valid.
   No browser should open.
   The tool list should load immediately from the cached session.

5. Expected misconfigured-server error UX:
   Stop the healthy server, start the broken server command from Preconditions, keep the same Inspector config file, and reconnect.
   Inspector should show an OAuth/discovery/resource-metadata failure with enough detail to distinguish it from a plain transport problem.
   Record the exact message if it only reports a generic connection failure.

Observed client-side gaps:
- Inspector clears OAuth state on explicit disconnect, so use refresh or reconnect-in-place for the second-connection cache check instead of disconnecting first.
- If the broken fixture produces only a transport error with no OAuth or metadata detail, record that as an auth-error UX gap.

Result:
- [ ] Pass
- [ ] Fail
