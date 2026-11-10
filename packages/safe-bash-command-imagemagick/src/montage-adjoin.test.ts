import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const extension of ["ppm", "rgb", "gif", "png"])
for (const switches of [["+adjoin"], ["-adjoin"], ["+adjoin", "-adjoin"], ["-adjoin", "+adjoin"], []])
for (const pattern of [false, true])
it(`writes montage ${extension} pages with ${switches.join(" ")} (pattern=${pattern}, ${mode})`, async () => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const output = `/sheet${pattern ? "-%02d" : ""}.${extension}`;
  const args = ["-geometry", "1x1+0+0", "-tile", "1x1", "-depth", "8", "xc:red", "xc:blue", ...switches, output];
  if (mode === "command") {
    const argumentValues = createCommandArguments(["montage", ...args]);
    let stdout = "", stderr = "";
    const context: CommandContext = {
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { stdout += chunk; } }, stderr: { async write(chunk) { stderr += chunk; } }, registerCleanup() {}
    };
    expect(await createMagickCommand().execute(context)).toMatchObject({ exitCode: 0 });
    expect({ stdout, stderr }).toEqual({ stdout: "", stderr: "" });
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
  }
  const split = pattern || switches.at(-1) === "+adjoin" || extension === "png";
  const names = split ? [0, 1].map(i => `/sheet-${pattern ? "0" : ""}${i}.${extension}`) : [output];
  const retained = mode === "command" || mode === "retained";
  expect((retained ? (await fs.readdir("/")).map(entry => `/${entry.name}`) : [...files.keys()]).sort()).toEqual(names);
  const pixels: number[] = [];
  for (const name of names) {
    const bytes = retained ? await fs.readFile(name) : files.get(name)!;
    if (extension === "rgb") pixels.push(...bytes);
    else if (extension === "ppm") {
      const header = new TextEncoder().encode("P6\n1 1\n255\n");
      for (let offset = 0; offset < bytes.length; offset += header.length + 3) {
        expect(bytes.slice(offset, offset + header.length)).toEqual(header);
        pixels.push(...bytes.slice(offset + header.length, offset + header.length + 3));
      }
    } else {
      const image = decodeImage(bytes, { animated: true });
      for (let i = 0; i < image.data.length; i += 4) pixels.push(...image.data.slice(i, i + 3));
    }
  }
  expect(pixels).toEqual([255, 0, 0, 0, 0, 255]);
});
