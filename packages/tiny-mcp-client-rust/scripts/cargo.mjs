import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
if (process.argv[2] === "build" || process.argv[2] === "test") {
  const source = new URL("../../mcp-oauth-rust/src/", import.meta.url);
  const output = new URL("../dist/oauth/", import.meta.url);
  mkdirSync(output, { recursive: true });
  for (const name of readdirSync(source)) {
    if (!name.endsWith(".js") && !name.endsWith(".d.ts")) continue;
    writeFileSync(new URL(name, output), readFileSync(new URL(name, source), "utf8").replaceAll("./mcp-oauth-rust.node", "../tiny-mcp-client-rust.node"));
  }
  copyFileSync(new URL("../../auth-store-rust/src/runtime.js", import.meta.url), new URL("auth-store-runtime.js", output));
  copyFileSync(new URL("../../auth-store-rust/src/credential-transaction-lock.js", import.meta.url), new URL("credential-transaction-lock.js", output));
  copyFileSync(new URL("../../auth-store-rust/src/index.d.ts", import.meta.url), new URL("auth-store-types.d.ts", output));
}
await import("../../mcp-protocol-rust/scripts/cargo.mjs");
