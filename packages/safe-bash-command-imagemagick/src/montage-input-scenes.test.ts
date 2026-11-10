import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync, runMagickCli, runConvertCliSync } from "./index.js";

// Three 1x1 GIF frames: red, lime, blue.
const trio = Buffer.from(
  "47494638396101000100810000ff000000ff000000ff000000" +
  "2c0000000001000100000202440100" +
  "2c00000000010001000002024c0100" +
  "2c00000000010001000002025401003b", "hex"
);

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([
    { scenes: "0,8,2", later: [], hex: "ff00000000ff", invalid: true },
    { scenes: "0,2", later: [], hex: "ff00000000ff", invalid: false },
    { scenes: "8,1", later: ["xc:white"], hex: "00ff00ffffff", invalid: true },
    { scenes: "1", later: ["xc:white"], hex: "00ff00ffffff", invalid: false },
    { scenes: "8", later: ["xc:white"], hex: "ffffff", invalid: true },
    { scenes: "8", later: [], hex: "", invalid: true },
    { scenes: "2,8,0,2", later: ["xc:white"], hex: "0000ffff00000000ffffffff", invalid: true },
    { scenes: "8,1,9", later: [], hex: "00ff00", invalid: true },
  ])(`${mode}: montage retains valid input scenes [$scenes] and later inputs $later`, async ({ scenes, later, hex, invalid }) => {
    const args = ["-geometry", "1x1+0+0", "-tile", "x1", `trio.gif[${scenes}]`, ...later, "-depth", "8", "rgb:-"];
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/trio.gif", trio);
    const files = new Map([["trio.gif", new Uint8Array(trio)]]);
    let exitCode: number, stderr = "", output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [];
      ({ exitCode } = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(new Uint8Array(chunk)); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      }));
      output = Buffer.concat(chunks);
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
      ({ exitCode, stderr } = result);
      output = result.stdoutBytes ?? new Uint8Array();
    }
    expect(Buffer.from(output).toString("hex"), stderr).toBe(hex);
    expect(exitCode).toBe(invalid ? 1 : 0);
    if (invalid) expect(stderr).toContain("invalid image index 8");
    else expect(stderr).toBe("");
  });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
  it.each(["0,8,2", "8,1", "8"])(`${mode}: convert still rejects invalid scene selections [%s] without replacing output`, async scenes => {
    const original = new Uint8Array(trio);
    const files = new Map([["trio.gif", new Uint8Array(trio)], ["output.gif", original]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/trio.gif", trio);
    await filesystem.writeFile("/output.gif", original);
    const args = [`trio.gif[${scenes}]`, "output.gif"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
      : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid image index 8");
    expect(mode === "retained" ? await filesystem.readFile("/output.gif") : files.get("output.gif")).toEqual(original);
  });
}
