import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync, runMagickCli, runMagickCliSync } from "./index.js";

const fixtures = [
  { path: "/tile.ppm", depth: 8, bytes: new TextEncoder().encode("P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n0 0 0  255 255 255  128 64 32\n") },
  { path: "/solid.png", depth: 8, bytes: encodeImage({
    width: 2, height: 1, data: Uint8Array.from([64, 96, 128, 255, 64, 96, 128, 255]),
    format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false,
  }, { format: "png" }).data },
  { path: "/deep.png", depth: 16, bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAIAAAAr0DSeAAAAFUlEQVQI12MUMgmrmLXnzYoUhTszACHGBfjAwcGSAAAAAElFTkSuQmCC", "base64") },
];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  for (const route of ["identify", "magick identify", "magick"] as const) {
    it.each(fixtures)(`${mode} ${route}: z is the image depth for $path`, async ({ path, bytes, depth }) => {
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile(path, bytes);
      const files = new Map([[path, bytes]]);
      const format = "%[fx:z]|%[fx:depth]|%z|%[fx:z*2]";
      const args = route === "magick" ? [path, "-format", format, "info:"] : ["-format", format, path];
      const magickArgs = route === "magick" ? args : ["identify", ...args];
      const expected = `${depth}|${depth}|${depth}|${depth * 2}`;
      let result;
      if (mode === "command") {
        const argumentValues = createCommandArguments(route === "identify" ? args : magickArgs);
        let stdout = "", stderr = "";
        const command = route === "identify" ? createIdentifyCommand() : createMagickCommand();
        const status = await command.execute({
          command: route === "identify" ? "identify" : "magick", args: argumentValues.args, argumentValues,
          fs: filesystem, cwd: "/", env: {}, signal: new AbortController().signal,
          stdin: (async function* () {})(), registerCleanup() {},
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        result = { ...status, stdout, stderr };
      } else {
        const argv = route === "identify" ? args : magickArgs;
        result = mode === "sync" ? (route === "identify" ? runIdentifyCliSync : runMagickCliSync)(argv, files)
          : await (route === "identify" ? runIdentifyCli : runMagickCli)(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
      }
      expect(result).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    });
  }
}
