import { build } from "esbuild";
import { createFsFromVolume, Volume } from "memfs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

async function loadPortableRuntime(entry = "./index.ts") {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true,
    write: false,
    platform: "browser",
    conditions: ["workerd"],
    format: "iife",
    globalName: "runtime",
    logLevel: "silent",
    alias: {
      "@poe-code/safe-fs/contracts": fileURLToPath(new URL("../../safe-fs/src/contracts/index.ts", import.meta.url)),
      "toolcraft-design/components/template": fileURLToPath(new URL("../../toolcraft-design/src/components/template.ts", import.meta.url)),
      "@poe-code/frontmatter": fileURLToPath(new URL("../../frontmatter/src/index.ts", import.meta.url)),
      "@poe-code/user-error": fileURLToPath(new URL("../../user-error/src/index.ts", import.meta.url))
    }
  });
  return runInNewContext(`${result.outputFiles[0].text}; runtime`, {
    crypto: globalThis.crypto,
    Error,
    TextEncoder,
    TextDecoder,
    setTimeout
  });
}

describe("portable config mutations", () => {
  it("merges and atomically publishes a config without Node globals or built-ins", async () => {
    const runtime = await loadPortableRuntime();
    const volume = Volume.fromJSON({ "/home/agent/config.json": '{"existing":true}' });
    const fs = createFsFromVolume(volume).promises;
    const result = await runtime.runMutations([
      runtime.configMutation.merge({ target: "~/config.json", value: { added: "portable" } })
    ], { fs, homeDir: "/home/agent" });
    expect(result.changed).toBe(true);
    expect(JSON.parse(await fs.readFile("/home/agent/config.json", "utf8"))).toEqual({
      existing: true, added: "portable"
    });
    expect(Object.keys(volume.toJSON())).toEqual(["/home/agent/config.json"]);
  });
});

it("reads and writes UTF-8 bytes through the portable testing filesystem", async () => {
  const runtime = await loadPortableRuntime("./testing/index.ts");
  const fs = runtime.createMockFs({ "~/text": "héllo" });
  expect(new TextDecoder().decode(await fs.readFile("~/text"))).toBe("héllo");
  const bytes = new TextEncoder().encode("!π!");
  await fs.writeFile("~/text", bytes.subarray(1, bytes.length - 1));
  expect(await fs.readFile("~/text", "utf8")).toBe("π");
});
