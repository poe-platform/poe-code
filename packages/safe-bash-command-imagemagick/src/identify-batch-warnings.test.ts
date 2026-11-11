import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

for (const route of ["sync", "map", "filesystem", "stream", "identify", "magick"] as const) {
  it.each([
    { name: "one input", args: ["-format", "A%[no-such-prop]B", "a.ppm"], stdout: "AB", properties: ["no-such-prop"] },
    { name: "two inputs", args: ["-format", "A%[no-such-prop]B", "a.ppm", "b.ppm"], stdout: "ABAB", properties: ["no-such-prop"] },
    { name: "different properties", args: ["-format", "%[unknown-first]", "a.ppm", "-format", "%[unknown-last]", "b.ppm"], stdout: "", properties: ["unknown-first", "unknown-last"] },
    { name: "first property repeated after another warning", args: ["-format", "%[unknown-first]%w;", "a.ppm", "-format", "%[unknown-last]%w;", "b.ppm", "-format", "%[unknown-first]%w;", "a.ppm"], stdout: "1;2;1;", properties: ["unknown-first", "unknown-last"] },
    { name: "earlier and later formatted output", args: ["-format", "%w;", "b.ppm", "-format", "A%[no-such-prop]B", "a.ppm", "b.ppm", "-format", "%w;", "a.ppm"], stdout: "2;ABAB1;", properties: ["no-such-prop"] },
    { name: "missing input between valid inputs", args: ["-format", "A%[no-such-prop]B", "a.ppm", "missing.ppm", "b.ppm"], stdout: "ABAB", properties: ["no-such-prop"], missing: true }
  ])(`shares property warnings only within each invocation (${route}): $name`, async ({ args, stdout: expectedStdout, properties, missing }) => {
    const files = new Map([
      ["a.ppm", new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n")],
      ["b.ppm", new TextEncoder().encode("P3\n2 1\n255\n0 0 255 0 255 0\n")]
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
    const command = route === "magick" ? createMagickCommand() : createIdentifyCommand();
    for (let invocation = 0; invocation < 2; invocation++) {
      let stdout = "", stderr = "";
      const sinks = {
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      };
      let result;
      if (route === "sync") result = runIdentifyCliSync(args, files);
      else if (route === "map") result = await runIdentifyCli(args, files);
      else if (route === "filesystem") result = await runIdentifyCli(args, { filesystem: fs, cwd: "/" });
      else if (route === "stream") {
        result = await runIdentifyCli(args, { filesystem: fs, cwd: "/", ...sinks });
        expect(result).toEqual({ exitCode: missing ? 1 : 0, stdout: "", stderr: "" });
        result = { ...result, stdout, stderr };
      } else {
        const argumentValues = createCommandArguments([...(route === "magick" ? ["identify"] : []), ...args]);
        result = await command.execute({
          command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
          signal: new AbortController().signal, stdin: (async function* () {})(), ...sinks
        });
        result = { ...result, stdout, stderr };
      }
      expect(result).toEqual({
        exitCode: missing ? 1 : 0,
        stdout: expectedStdout,
        stderr: properties.map(property => `identify: unknown image property '%[${property}]'\n`).join("")
          + (missing ? "identify: unable to open image 'missing.ppm': No such file or directory\n" : "")
      });
    }
  });
}
