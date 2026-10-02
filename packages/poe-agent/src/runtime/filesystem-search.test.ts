import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { createFsBridge } from "@poe-code/safe-fs/bridge";
import { globFileSystem } from "./filesystem-search.js";

it("matches portable glob syntax without following symbolic directory entries", async () => {
  const fs = new MemoryFileSystem();
  for (const file of ["/repo/src/a.ts", "/repo/src/b.js", "/repo/src/.hidden.ts", "/repo/src/nested/c.ts", "/outside/nested/secret.ts"]) {
    await fs.mkdir(file.slice(0, file.lastIndexOf("/")), { recursive: true });
    await fs.writeFile(file, new Uint8Array());
  }
  await fs.symlink("/outside", "/repo/src/link");
  const bridge = createFsBridge(fs, { cwd: "/repo", root: "/", codec: {
    isEncoding: encoding => encoding === "utf8",
    encode: text => new TextEncoder().encode(text), decode: bytes => new TextDecoder().decode(bytes)
  } });
  expect(await globFileSystem({ cwd: "/repo", pattern: "src/**/*.{ts,js}" }, bridge)).toEqual([
    "/repo/src/.hidden.ts", "/repo/src/a.ts", "/repo/src/b.js", "/repo/src/nested/c.ts"
  ]);
  expect(await globFileSystem({ cwd: "/repo", pattern: "src/@(a|b).*" }, bridge)).toEqual(["/repo/src/a.ts", "/repo/src/b.js"]);
  expect(await globFileSystem({ cwd: "/repo", pattern: "/repo/src/a.ts" }, bridge)).toEqual(["/repo/src/a.ts"]);
  expect(await globFileSystem({ cwd: "/repo", pattern: "missing/**/*.ts" }, bridge)).toEqual([]);
  expect(await globFileSystem({ cwd: "/repo", pattern: "src/link/nested/*.ts" }, bridge)).toEqual([]);
});
