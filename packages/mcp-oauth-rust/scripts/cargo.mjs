import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
// Embed the single maintained host source beside this package's combined addon.
if (process.argv[2] === "build" || process.argv[2] === "test") {
  mkdirSync(fileURLToPath(new URL("../dist/", import.meta.url)), { recursive: true });
  copyFileSync(
    new URL("../../auth-store-rust/src/runtime.js", import.meta.url),
    new URL("../dist/auth-store-runtime.js", import.meta.url)
  );
  copyFileSync(
    new URL("../../auth-store-rust/src/index.d.ts", import.meta.url),
    new URL("../dist/auth-store-types.d.ts", import.meta.url)
  );
}
await import("../../mcp-protocol-rust/scripts/cargo.mjs");
