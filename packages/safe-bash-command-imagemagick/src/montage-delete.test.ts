import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([
    { inputs: ["xc:red", "xc:lime"], hex: "ff000000ff00ffffff" },
    { inputs: ["xc:red", "xc:lime", "xc:blue", "-delete", "1"], hex: "ff00000000ffffffff" },
    { inputs: ["xc:red", "xc:lime", "xc:blue", "+delete"], hex: "ff000000ff00ffffff" },
    { inputs: ["xc:red", "xc:lime", "xc:blue", "-delete", "1", "xc:black"], hex: "ff00000000ff000000" },
    { inputs: ["xc:red", "xc:lime", "xc:blue", "-delete", "-2"], hex: "ff00000000ffffffff" },
    { inputs: ["xc:red", "xc:lime", "xc:blue", "-delete", "0,2"], hex: "00ff00ffffffffffff" },
    { inputs: ["xc:red", "xc:lime", "xc:blue", "-delete", "0-1"], hex: "0000ffffffffffffff" },
    { inputs: ["xc:red", "xc:lime", "xc:blue", "-delete", "1,1"], hex: "ff00000000ffffffff" },
    { inputs: ["xc:red", "xc:lime", "-delete", "99"], hex: "ff000000ff00ffffff" },
    { inputs: ["xc:red", "xc:lime", "-delete", "0-1", "xc:blue"], hex: "0000ffffffffffffff" },
    { inputs: ["xc:red", "xc:lime", "xc:blue", "+delete", "+delete"], hex: "ff0000ffffffffffff" },
    { inputs: ["xc:red", "(", "xc:lime", "xc:blue", "-delete", "0", ")"], hex: "ff00000000ffffffff" },
    { inputs: ["xc:red", "(", "xc:lime", "xc:blue", "+delete", ")"], hex: "ff000000ff00ffffff" },
  ])(`${mode} deletes selected montage inputs before layout: $inputs`, async ({ inputs, hex }) => {
    const args = ["-background", "white", "-geometry", "1x1+0+0", "-tile", "3x", ...inputs, "-depth", "8", "rgb:-"];
    const fs = new MemoryFileSystem();
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const result = await command.execute({
        command: command.name, args: mode === "magick" ? ["montage", ...args] : args,
        cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      expect(stderr).toBe("");
      expect(result.exitCode).toBe(0);
      output = Buffer.concat(chunks);
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, new Map())
        : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    expect(Buffer.from(output).toString("hex")).toBe(hex);
  });
}

it.each([
  ["-delete", "0", "xc:red", "png:-"],
  ["+delete", "xc:red", "png:-"],
  ["xc:red", "-delete"],
  ["xc:red", "-delete", "no", "png:-"],
  ["xc:red", "-delete", "0\n", "png:-"],
  ["xc:red", "+delete", "png:-"],
])("rejects invalid montage deletion without producing output: %j", (...args) => {
  const result = runMontageCliSync(args, new Map());
  expect(result.exitCode).toBe(1);
  expect(result.stderr).not.toBe("");
  expect(result.stdoutBytes).toBeUndefined();
});

for (const mode of ["sync", "retained"] as const) {
  it(`${mode} preserves the labels and sizes of surviving montage inputs`, async () => {
    const outputs: Uint8Array[] = [];
    for (const inputs of [
      ["-label", "A", "-size", "30x2", "xc:red", "-label", "B", "-size", "40x2", "xc:lime", "-label", "C", "-size", "50x2", "xc:blue", "-delete", "1"],
      ["-label", "A", "-size", "30x2", "xc:red", "-label", "C", "-size", "50x2", "xc:blue"]
    ]) {
      const args = ["-geometry", "+0+0", "-tile", "2x1", ...inputs, "png:-"];
      const result = mode === "sync" ? runMontageCliSync(args, new Map())
        : await runMontageCli(args, { filesystem: new MemoryFileSystem(), cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      outputs.push(result.stdoutBytes!);
    }
    expect(outputs[0]).toEqual(outputs[1]);
  });
}
