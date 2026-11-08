export { fileURLToPath } from "node:url";
export function defaultEnvironment(): Record<string, string | undefined> { return process.env; }
