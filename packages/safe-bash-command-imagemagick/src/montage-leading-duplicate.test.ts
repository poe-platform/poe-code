import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const red = Buffer.concat([Buffer.from("P6\n1 1\n255\n"), Buffer.from([255, 0, 0])]);

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
  // Pixel order captured from ImageMagick 7.1.2-35 Q16-HDRI.
  it.each([
    { inputs: ["-duplicate", "1", "xc:red", "xc:blue"], bytes: red, hex: "ff00000000ff0000ff" },
    { inputs: ["-duplicate", "1", "ppm:-"], bytes: red, hex: "ff0000ff0000" },
    { inputs: ["xc:red", "xc:blue", "-duplicate", "1"], bytes: red, hex: "ff00000000ff0000ff" },
    { inputs: ["+duplicate", "xc:red", "xc:blue"], bytes: red, hex: "ff00000000ff0000ff" },
    { inputs: ["-duplicate", "1,0", "xc:red", "xc:blue"], bytes: red, hex: "ff00000000ffff0000" },
    { inputs: ["-duplicate", "1", "xc:red", "-size", "1x1", "xc:blue"], bytes: red, hex: "ff0000ff00000000ff0000ff" },
    { inputs: ["-duplicate", "1", "xc:red", "-duplicate", "1", "xc:blue"], bytes: red, hex: "ff0000ff0000ff00000000ff" },
    { inputs: ["(", "-duplicate", "1", "xc:red", "xc:blue", ")", "xc:lime"], bytes: red, hex: "ff00000000ff0000ff00ff00" },
    { inputs: ["-duplicate", "1", "-duplicate", "1", "xc:red", "xc:blue"], bytes: red, hex: "ff00000000ff0000ff0000ff" },
    { inputs: ["-duplicate", "0", "xc:red", "xc:blue"], bytes: red, hex: "ff00000000ff" },
  ])(`${mode}: montage defers leading duplication: $inputs`, async ({ inputs, bytes, hex }) => {
    const args = [...inputs, "-geometry", "+0+0", "-tile", "x1", "-depth", "8", "rgb:-"];
    const filesystem = new MemoryFileSystem();
    const stdin = (async function* () {
      // Split both a header and a pixel across stream chunks.
      yield bytes.subarray(0, 4);
      yield bytes.subarray(4, red.length - 1);
      yield bytes.subarray(red.length - 1);
    })();
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
      const result = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues,
        cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin,
        stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
        stderr: { async write(chunk) { errors.push(chunk.slice()); } },
      });
      expect(Buffer.concat(errors).toString()).toBe("");
      expect(result.exitCode).toBe(0);
      output = Buffer.concat(chunks);
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, new Map(), bytes)
        : mode === "buffered" ? await runMontageCli(args, new Map(), bytes)
        : await runMontageCli(args, { filesystem, cwd: "/", stdin });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    expect(Buffer.from(output).toString("hex")).toBe(hex);
  });

  it.each(["1,8", "1,no", "bad"])(`${mode}: invalid leading duplicate %s preserves output`, async value => {
    const args = ["-duplicate", value, "xc:red", "-geometry", "+0+0", "rgb:sheet.rgb"];
    const original = new Uint8Array([42]);
    const files = new Map([["sheet.rgb", original]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/sheet.rgb", original);
    if (mode === "magick" || mode === "montage") {
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const result = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues,
        cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
      });
      expect(result.exitCode).toBe(1);
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("invalid");
    }
    expect(files.get("sheet.rgb")).toEqual(original);
    expect(await filesystem.readFile("/sheet.rgb")).toEqual(original);
  });
}
