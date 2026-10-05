import { createHash } from "node:crypto";
import { accessSync, constants, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Cargo intermediates contain checkout-specific path crate identities. Only the
// separately content-addressed NAPI/check caches are safe to share across roots.
export function resolveCargoTargetDirectory(repoRoot) {
  if (process.env.CARGO_TARGET_DIR) return path.resolve(process.env.CARGO_TARGET_DIR);
  if (process.env.CI) return path.resolve(repoRoot, "out/rust-mcp-target");
  const checkout = createHash("sha256").update(path.resolve(repoRoot)).digest("hex");
  const preferred = path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "poe-code", "rust-mcp-target", checkout);
  try {
    mkdirSync(preferred, { recursive: true });
    accessSync(preferred, constants.W_OK);
    return preferred;
  } catch {
    return path.join(os.tmpdir(), "poe-code", "rust-mcp-target", checkout);
  }
}
