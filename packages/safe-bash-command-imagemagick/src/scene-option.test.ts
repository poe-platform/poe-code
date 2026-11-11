import { describe, expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI filenames and RGB pixels.
describe.each(["command", "retained", "buffered", "sync"] as const)("scene option (%s)", mode => {
  describe.each([false, true])("pattern=%s", pattern => {
    it.each([
      { args: ["-set", "option:scene", "7"], start: 7 },
      { args: ["-set", "option:scene", "-2"], start: -2 },
      { args: ["-set", "scene", "7"], start: 0 },
      { args: ["-scene", "7"], start: 7 },
      { args: ["-set", "option:scene", "7", "+set", "option:scene"], start: 7 },
    ])("numbers output for $args", async ({ args, start }) => {
      const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
      const argumentValues = createCommandArguments(["xc:red", "xc:blue", ...args, "+adjoin", pattern ? "/z%02d.png" : "/z.png"]);
      let stderr = "";
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      }) : mode === "sync" ? runMagickCliSync(argumentValues.args, files)
        : await runMagickCli(argumentValues.args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
      expect(result.exitCode, stderr).toBe(0);
      const names = [start, start + 1].map(scene => pattern ? `z${String(scene).padStart(2, "0")}.png` : `z-${scene}.png`);
      expect(mode === "command" || mode === "retained" ? (await fs.readdir("/")).map(entry => entry.name).sort() : [...files.keys()].map(path => path.slice(1)).sort()).toEqual([...names].sort());
      for (const [index, name] of names.entries()) {
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile(`/${name}`) : files.get(`/${name}`)!;
        const image = decodeImage(bytes);
        expect([image.width, image.height]).toEqual([1, 1]);
        expect([...image.data]).toEqual(index === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
      }
    });
  });
});
