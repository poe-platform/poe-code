#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createSafeBashMcpServer } from "./index.js";

const { values } = parseArgs({
  options: { config: { type: "string" } },
  strict: true,
  allowPositionals: false
});
const options = values.config === undefined
  ? {}
  : (await import(pathToFileURL(resolve(values.config)).href)).default;
if (options === undefined) {
  throw new TypeError("The config module must default-export SafeBashMcpOptions");
}
const server = createSafeBashMcpServer(options);
try {
  await server.listen();
} finally {
  await server.close();
}
