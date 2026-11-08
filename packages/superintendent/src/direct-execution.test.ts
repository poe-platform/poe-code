import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { isDirectExecution } from "./direct-execution.js";

it("resolves a direct entrypoint through its supplied filesystem", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/repo", { recursive: true });
  await fs.writeFile("/repo/my cli.js", new Uint8Array());
  await fs.symlink("/repo/my cli.js", "/repo/cli");
  expect(await isDirectExecution("file:///repo/my%20cli.js", ["node", "/repo/cli"], fs)).toBe(true);
  expect(await isDirectExecution("https://example.com/cli", ["node", "/repo/cli"], fs)).toBe(false);
  expect(await isDirectExecution("file:///repo/missing.js", ["node", "/repo/cli"], fs)).toBe(false);
});
