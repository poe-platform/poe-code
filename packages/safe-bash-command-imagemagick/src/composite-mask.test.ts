import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const route of ["command", "buffered", "sync"] as const) {
  for (const scenario of ["forward", "reverse", "missing", "unmasked", "gray", "partial"] as const) {
    it(`${route}: standalone composite honors ${scenario} mask`, async () => {
      const png = (data: number[], hasAlpha = true) => encodeImage({ width: 2, height: 1,
        data: Uint8Array.from(data), hasAlpha, channels: hasAlpha ? 4 : 3,
        format: "png", space: "srgb", depth: "uchar", density: 72 }, { format: "png" }).data;
      const red = [255, 0, 0, 255], blue = [0, 0, 255, 255];
      const files = new Map([
        ["/a.png", png(scenario === "partial" ? [255, 0, 0, 128, 255, 0, 0, 128] : [...red, ...red])],
        ["/b.png", png([...blue, ...blue])],
        ["/mask.png", png(scenario === "reverse" ? [255, 255, 255, 255, 0, 0, 0, 0]
          : scenario === "partial" ? [255, 255, 255, 128, 255, 255, 255, 128]
          : scenario === "gray" ? [0, 0, 0, 255, 255, 255, 255, 255]
          : [0, 0, 0, 0, 255, 255, 255, 255], scenario !== "gray")],
      ]);
      const fs = createMemoryFileSystem();
      for (const [path, bytes] of files) await fs.writeFile(path, bytes);
      const args = ["composite", "/a.png", "/b.png", ...(scenario === "unmasked" ? [] : [scenario === "missing" ? "/absent.png" : "/mask.png"]), "/out.png"];
      const result = route === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
      }) : route === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
      expect(result.exitCode).toBe(scenario === "missing" ? 1 : 0);
      if (scenario === "missing") {
        if (route === "command") await expect(fs.readFile("/out.png")).rejects.toThrow();
        else expect(files.has("/out.png")).toBe(false);
        return;
      }
      const output = decodeImage(route === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
      expect([...output.data]).toEqual(scenario === "unmasked" ? [...red, ...red]
        : scenario === "reverse" ? [...red, ...blue]
        : scenario === "partial" ? [64, 0, 191, 255, 64, 0, 191, 255] : [...blue, ...red]);
    });
  }
}
