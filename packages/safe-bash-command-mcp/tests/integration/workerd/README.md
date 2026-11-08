The fixture verifies schema discovery and command invocation with host-owned
fetch and OAuth, using workerd without any compatibility flags. Bundle worker.mjs
against the built MCP entry with workerd conditions, keeping node:* external so
any accidental Node dependency fails to load. Place bundle.mjs and config.capnp
under out, then run `node_modules/workerd/bin/workerd test out/mcp/config.capnp`.
The portable contracts bundle must use the same canonical owner for both the
fixture and MCP commands.
