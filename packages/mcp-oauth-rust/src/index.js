import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./mcp-oauth-rust.node");
export const generateCodeChallenge = native.generateCodeChallenge;
export function generateCodeVerifier() { return native.encodeCodeVerifier(randomBytes(32)); }
export { fetchMcpResponse, readBoundedResponseText } from "./http.js";
