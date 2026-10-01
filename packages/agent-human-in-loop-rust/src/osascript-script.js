import { policy } from "./policy.js";
export function escapeAppleScriptString(value) { return policy("escape", [value]); }
export function buildScript(request, title) { return policy("script", [request, title]); }
export function parseStdout(out) { return policy("stdout", [out]); }
