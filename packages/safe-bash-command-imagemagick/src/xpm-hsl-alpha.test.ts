import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([
    ["hsl(180,50%,50%,0.25)", 255],
    ["hsla(180,50%,50%,25%)", 255],
    ["hsla(180,50%,50%,0.25)", 64],
    ["hsl(180,50%,50%)", 255],
    ["hsla(180,50%,50%,0.25%)", 163],
    ["hsla(180,50%,50%,2)", 255]
  ] as const)(`matches native XPM HSL alpha (${mode}, %s)`, async (color, alpha) => {
    // ImageMagick 7.1.2-35 Q16-HDRI: icon.xpm -depth 8 rgba:-.
    const input = new TextEncoder().encode(`/* XPM */
static char *icon[] = {
"3 1 3 1",
"a c ${color}",
"b c blue",
". c None",
"ab."
};`);
    const files = new Map([["/icon.xpm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/icon.xpm", input);
    const args = ["/icon.xpm", "-depth", "8", mode === "command" ? "rgba:-" : "rgba:/pixel.raw"];
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async chunk => { chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); } },
      stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : "").toBe("");
    expect(result.exitCode).toBe(0);
    const output = mode === "command" ? Buffer.concat(chunks)
      : mode === "retained" ? await fs.readFile("/pixel.raw") : files.get("/pixel.raw")!;
    expect(output[3]).toBe(alpha);
    expect(Array.from(output)).toEqual([64, 191, 191, alpha, 0, 0, 255, 255, 0, 0, 0, 0]);
  });
}
