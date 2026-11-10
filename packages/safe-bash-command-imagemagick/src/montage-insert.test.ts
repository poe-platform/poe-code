import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([
    { inputs: ["xc:red", "xc:lime", "xc:blue", "-insert", "1"], order: "RBG" },
    { inputs: ["xc:red", "xc:lime", "xc:blue", "+insert"], order: "BRG" },
    { inputs: ["xc:red", "xc:lime", "xc:blue", "-insert", "1", "xc:black"], order: "RBGKWW" },
    { inputs: ["xc:red", "xc:lime", "xc:blue", "-reverse"], order: "BGR" },
    { inputs: ["xc:red", "xc:lime", "xc:blue", "-insert", "-1"], order: "RBG" },
    { inputs: ["xc:red", "xc:lime", "xc:blue", "-insert", "0"], order: "BRG" },
    { inputs: ["xc:red", "xc:lime", "xc:blue", "-insert", "2"], order: "RGB" },
    { inputs: ["xc:red", "xc:lime", "xc:blue", "-insert", "1.9"], order: "RBG" },
    { inputs: ["xc:red", "xc:lime", "xc:blue", "-insert", "+1+1"], order: "RBG" },
    { inputs: ["xc:red", "xc:lime", "xc:blue", "+insert", "-insert", "1"], order: "BGR" },
    { inputs: ["xc:red", "+insert", "xc:lime", "xc:blue"], order: "RGB" },
    { inputs: ["xc:red", "(", "xc:lime", "xc:blue", "+insert", ")"], order: "RBG" },
  ])(`moves the last montage tile via ${mode}: $inputs`, async ({ inputs, order }) => {
    const args = ["-background", "white", "-geometry", "1x1+0+0", "-tile", "3x", ...inputs, "ppm:-"];
    const fs = new MemoryFileSystem();
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [];
      const stderr: unknown[] = [];
      const context: CommandContext = {
        command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); } },
        stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
      };
      const result = await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute(context);
      expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: [] });
      output = Buffer.concat(chunks);
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, new Map())
        : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    const image = decodeImage(output);
    expect([image.width, image.height]).toEqual([3, order.length / 3]);
    const colors: Record<string, number[]> = { R: [255, 0, 0, 255], G: [0, 255, 0, 255], B: [0, 0, 255, 255], K: [0, 0, 0, 255], W: [255, 255, 255, 255] };
    expect([...image.data]).toEqual([...order].flatMap(color => colors[color]!));
  });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
  it.each([
    ["+insert", "xc:red"],
    ["xc:red", "xc:lime", "xc:blue", "-insert", "3"],
    ["xc:red", "xc:lime", "xc:blue", "-insert", "-2"],
    ["xc:red", "-insert", "nope"],
    ["xc:red", "-insert", "+"],
    ["xc:red", "-insert", "1+1"],
    ["xc:red", "-insert"],
  ])(`rejects invalid montage insertion without overwriting output via ${mode}: %j`, async (...inputs) => {
    const original = new TextEncoder().encode("KEEP");
    const files = new Map([["out.ppm", original]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/out.ppm", original);
    const args = [...inputs, "out.ppm"];
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("unrecognized option");
    expect(mode === "retained" ? await filesystem.readFile("/out.ppm") : files.get("out.ppm")).toEqual(original);
  });

  it(`keeps labels attached to inserted montage tiles via ${mode}`, async () => {
    const outputs = [];
    for (const inputs of [
      ["-label", "A", "xc:red", "-label", "B", "xc:lime", "-label", "C", "xc:blue", "-insert", "1"],
      ["-label", "A", "xc:red", "-label", "C", "xc:blue", "-label", "B", "xc:lime"]
    ]) {
      const args = ["-geometry", "20x1+0+0", "-tile", "3x", ...inputs, "ppm:-"];
      const result = mode === "sync" ? runMontageCliSync(args, new Map())
        : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: new MemoryFileSystem(), cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      outputs.push(decodeImage(result.stdoutBytes!));
    }
    expect(outputs[0]).toEqual(outputs[1]);
  });
}
