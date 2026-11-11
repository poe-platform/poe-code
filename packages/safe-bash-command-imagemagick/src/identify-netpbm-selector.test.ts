import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

it.each(["1", "5", "1,5"])("ignores selector [%s] for a single Netpbm image across identify routes", async selector => {
  const bytes = new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n");
  const files = new Map([["/a.ppm", bytes]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/a.ppm", bytes);
  for (const [format, stdout] of [["%s;", "0;"], ["%s:%wx%h:%[fx:p{0,0}.r];", "0:1x1:1;"]]) {
    const args = ["-format", format!, `/a.ppm[${selector}]`];
    const expected = { exitCode: 0, stdout, stderr: "" };
    expect(runIdentifyCliSync(args, files)).toEqual(expected);
    for (const input of [files, { filesystem: fs, cwd: "/" }]) {
      expect(await runIdentifyCli(args, input)).toEqual(expected);
    }
    for (const command of [createIdentifyCommand(), createMagickCommand()]) {
      const argumentValues = createCommandArguments(command.name === "magick" ? ["identify", ...args] : args);
      let stdout = "", stderr = "";
      const result = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      expect({ ...result, stdout, stderr }).toEqual(expected);
    }
  }
});

it("rejects out-of-range multiframe GIF selections", async () => {
  const bytes = Uint8Array.from(Buffer.from("R0lGODlhAgADAPAAAAAA/wAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAAAAACwAAAAAAgADAAACAoRfACH5BAAAAAAALAAAAAACAAMAgACAAAAAAAIChF8AOw==", "base64"));
  const files = new Map([["/movie.gif", bytes]]);
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/movie.gif", bytes);
  for (const format of ["%s;", "%s:%wx%h:%[fx:p{0,0}.r];"]) {
    const args = ["-format", format, "/movie.gif[5]"];
    for (const result of [runIdentifyCliSync(args, files), await runIdentifyCli(args, files), await runIdentifyCli(args, { filesystem, cwd: "/" })]) {
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      expect(result.stderr).toContain("invalid image index 5");
    }
  }
});

it("keeps indexed raw and inline inputs on their existing read path", async () => {
  const bytes = Uint8Array.of(255, 0, 0, 0, 255, 0);
  const files = new Map([["/a.rgb", bytes]]);
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/a.rgb", bytes);
  for (const args of [
    ["-size", "1x1", "-depth", "8", "-format", "%s:%[fx:p{0,0}.r];", "/a.rgb[1]"],
    ["-format", "%s:%[fx:p{0,0}.r];", "xc:green[1]"]
  ]) {
    for (const result of [runIdentifyCliSync(args, files), await runIdentifyCli(args, { filesystem, cwd: "/" })]) {
      expect(result).toEqual({ exitCode: 0, stdout: "1:0;", stderr: "" });
    }
  }
});
