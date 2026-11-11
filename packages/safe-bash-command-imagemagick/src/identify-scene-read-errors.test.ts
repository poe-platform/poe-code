import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

// ImageMagick 7.1.2-35: a read exception suppresses FX properties for the
// surviving scenes and later inputs, while metadata and earlier output survive.
const gif = Uint8Array.from(Buffer.from("R0lGODlhAgABAPAAAAD/AAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAAAAACwAAAAAAgABAAACAgQKACH5BAAAAAAALAAAAAABAAEAgP8AAAAAAAICRAEAOw==", "base64"));

for (const route of ["sync", "map", "filesystem", "stream", "identify", "magick"] as const) {
  it.each([
    { inputs: ["clip.gif[1,2]", "a.ppm"], format: "%s:%[fx:p{0,0}.r];", stdout: "1:;0:;", error: "invalid image index 2" },
    { inputs: ["b.ppm", "clip.gif[1,2]", "a.ppm"], format: "%s:%[fx:p{0,0}.r];", stdout: "0:0;1:;0:;", error: "invalid image index 2" },
    { inputs: ["clip.gif[1,2]", "a.ppm"], format: "%s:%h:%[fx:1+2]:%[pixel:u]:%[hex:u]:%[mean];", stdout: "1:1::::21845;0:1::::21845;", error: "invalid image index 2" },
    { inputs: ["clip.gif[2]", "a.ppm"], format: "%s:%[fx:p{0,0}.r];", stdout: "0:;", error: "invalid image index 2" },
    { inputs: ["missing.ppm", "a.ppm"], format: "%s:%[fx:p{0,0}.r];", stdout: "0:;", error: "unable to open image 'missing.ppm'" },
    { inputs: ["clip.gif[1]", "a.ppm"], format: "%s:%[fx:p{0,0}.r];", stdout: "1:1;0:1;" },
    { inputs: ["clip.gif[1]", "a.ppm"], format: "%s:%h:%[fx:1+2]:%[pixel:u]:%[hex:u]:%[mean];", stdout: "1:1:3:srgb(255,0,0):FF0000:21845;0:1:3:srgb(255,0,0):FF0000:21845;" }
  ])(`preserves formatted output after read errors (${route}): $inputs $format`, async ({ inputs, format, stdout: expectedStdout, error }) => {
    const files = new Map([
      ["clip.gif", gif],
      ["a.ppm", new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n")],
      ["b.ppm", new TextEncoder().encode("P3\n2 1\n255\n0 255 0 0 255 0\n")]
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
    const command = route === "magick" ? createMagickCommand() : createIdentifyCommand();
    for (const invocation of [
      { args: ["-format", format, ...inputs], stdout: expectedStdout, error },
      { args: ["-format", "%s:%[fx:p{0,0}.r];", "clip.gif[1]", "a.ppm"], stdout: "1:1;0:1;", error: undefined }
    ]) {
      let stdout = "", stderr = "";
      const sinks = {
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      };
      let result;
      if (route === "sync") result = runIdentifyCliSync(invocation.args, files);
      else if (route === "map") result = await runIdentifyCli(invocation.args, files);
      else if (route === "filesystem") result = await runIdentifyCli(invocation.args, { filesystem: fs, cwd: "/" });
      else if (route === "stream") {
        result = await runIdentifyCli(invocation.args, { filesystem: fs, cwd: "/", ...sinks });
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
        result = { ...result, stdout, stderr };
      } else {
        const argumentValues = createCommandArguments([...(route === "magick" ? ["identify"] : []), ...invocation.args]);
        result = await command.execute({
          command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
          signal: new AbortController().signal, stdin: (async function* () {})(), ...sinks
        });
        result = { ...result, stdout, stderr };
      }
      expect(result.stdout).toBe(invocation.stdout);
      expect(result.exitCode).toBe(invocation.error ? 1 : 0);
      if (invocation.error) expect(result.stderr).toContain(invocation.error);
      else expect(result.stderr).toBe("");
    }
  });
}
