import type { ClientCapabilities, ServerCapabilities } from "./index.js";
const client: ClientCapabilities = { extensions: { "com.example/feature": { supported: true } } };
const server: ServerCapabilities = { extensions: { "io.modelcontextprotocol/tasks": {} } };
void [client, server];
