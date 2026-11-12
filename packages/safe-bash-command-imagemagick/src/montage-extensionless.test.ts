import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "sync", "buffered", "retained"] as const)
for (const generated of [false, true])
it.each(["plain", ".png", ".jpg", "plain.", ".hidden.png", "PNG:.png"])(`${mode}, generated=${generated}: writes %s using the filename or input format`, async target => {
  const fs = new MemoryFileSystem();
  const files = new Map<string, Uint8Array>();
  if (!generated) for (const [name, rgb] of [["scan-04.ppm", [255, 0, 0]], ["scan-05.ppm", [0, 255, 0]]] as const) {
    const bytes = new Uint8Array([...new TextEncoder().encode("P6\n1 1\n255\n"), ...rgb]);
    files.set(name, bytes);
    await fs.writeFile(`/${name}`, bytes);
  }
  const args = [...(generated ? ["xc:red", "xc:blue"] : ["scan-04.ppm", "scan-05.ppm"]), "-tile", "2x1", "-geometry", "+0+0", target];
  let result;
  if (mode === "magick" || mode === "montage") {
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const stderr: Uint8Array[] = [];
    const execution = await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute({
      command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() {} }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } }
    });
    result = { ...execution, stderr: Buffer.concat(stderr).toString() };
  } else result = mode === "sync" ? runMontageCliSync(args, files)
    : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  const retained = mode === "magick" || mode === "montage" || mode === "retained";
  const names = (retained ? (await fs.readdir("/")).map(entry => entry.name) : [...files.keys()]).filter(name => !name.startsWith("scan-"));
  const png = target === ".hidden.png" || target === "PNG:.png";
  if (generated && !png) {
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no encode delegate for this image format");
    expect(result.stderr).toContain("XC");
    expect(names).toEqual([]);
  } else {
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const name = target.startsWith("PNG:") ? target.slice(4) : target;
    expect(names).toEqual([name]);
    const image = decodeImage(retained ? await fs.readFile(`/${name}`) : files.get(name)!);
    expect(image.format).toBe(png ? "png" : "ppm");
    expect([image.width, image.height]).toEqual([2, 1]);
    expect([...image.data]).toEqual(generated ? [255, 0, 0, 255, 0, 0, 255, 255] : [255, 0, 0, 255, 0, 255, 0, 255]);
  }
});
