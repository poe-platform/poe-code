import { it, expect } from "vitest";
import { build } from "esbuild";
import { resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";

it("ships self-contained audio command and engine entrypoints", async () => {
  const options = resolveBrowserShellBuild(process.cwd());
  const keys = [
    "commands/audio/index.browser",
    "commands/ffprobe/index.browser",
    "commands/sox/index.browser",
    "commands/soxi/index.browser",
    "audio-ast.browser"
  ];
  for (const key of keys) expect(options.entryPoints[key]).toBeTypeOf("string");
  const result = await build({
    ...options,
    entryPoints: Object.fromEntries(keys.map((key) => [key, options.entryPoints[key]])),
    write: false,
    sourcemap: false
  });
  for (const output of Object.values(result.metafile!.outputs))
    for (const entry of output.imports)
      if (entry.external) expect(entry.path).toBe("poe-code/safe-fs/core");
  expect(
    result.outputFiles.filter((file) => file.path.endsWith(".js")).length
  ).toBeGreaterThanOrEqual(5);
});
