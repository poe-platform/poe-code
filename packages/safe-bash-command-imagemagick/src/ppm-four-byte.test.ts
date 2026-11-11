import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {createCommandArguments} from "safe-bash-contracts/command";
import {createMagickCommand, runMagickCli, runMagickCliSync} from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([
    {magic: "P6", maxval: 65536, raster: "000080000000800000008000"},
    {magic: "P6", maxval: 65535, raster: "800080008000"},
    {magic: "P5", maxval: 65536, raster: "00008000"}
  ])(`${mode}: converts $magic MAXVAL=$maxval to native 16-bit gray`, async ({magic, maxval, raster}) => {
    // ImageMagick 7.1.2-35 Q16-HDRI produces 8000 for each neutral pixel.
    const input = Buffer.concat([Buffer.from(`${magic}\n1 1\n${maxval}\n`), Buffer.from(raster, "hex")]);
    const files = new Map([["/in.pnm", input]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.pnm", input);
    const argv = ["/in.pnm", "-depth", "16", "-endian", "MSB", "gray:-"];
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const argumentValues = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: {async write(bytes) {stdout.push(new Uint8Array(bytes));}},
      stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
    }) : mode === "sync" ? runMagickCliSync(argv, files)
      : await runMagickCli(argv, mode === "retained" ? {filesystem: fs, cwd: "/"} : files);
    expect(result.exitCode).toBe(0);
    expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : undefined).toBe("");
    expect(Buffer.from(mode === "command" ? Buffer.concat(stdout)
      : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array()).toString("hex")).toBe("8000");
  });
}
