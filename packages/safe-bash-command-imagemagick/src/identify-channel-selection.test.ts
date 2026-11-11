import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

const files = new Map([
  ["/movie.gif", Buffer.from("R0lGODlhAQABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAAAAACwAAAAAAQABAAACAkQBACH5BAAAAAAALAAAAAABAAEAgAAA/wAAAAICRAEAOw==", "base64")],
  ["/a.ppm", new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n")],
  ["/b.ppm", new TextEncoder().encode("P3\n2 1\n255\n0 0 255 0 255 0\n")]
]);

for (const route of ["sync", "buffered", "retained", "identify", "magick"] as const) {
  it.each([
    { args: ["-channel", "Red", "-format", "%[mean]|%[min]|%[max]|%[standard-deviation];", "/movie.gif", "-channel", "Blue", "/movie.gif[1,0]"], stdout: "65535|65535|65535|0;0|0|0|0;65535|65535|65535|0;0|0|0|0;" },
    { args: ["-channel", "Red", "-format", "%[mean]", "/a.ppm"], stdout: "65535" },
    { args: ["-channel", "Green", "-format", "%[mean]", "/a.ppm"], stdout: "0" },
    { args: ["-format", "%[mean]", "/a.ppm"], stdout: "21845" },
    { args: ["-format", "%[mean];", "/a.ppm", "-channel", "Red", "/a.ppm", "+channel", "/a.ppm"], stdout: "21845;65535;21845;" },
    { args: ["-channel", "Green", "-format", "%[mean]", "xc:red"], stdout: "0" },
    { args: ["-format", "%f:%wx%h;", "/a.ppm", "-channel", "Foo", "/b.ppm"], stdout: "a.ppm:1x1;", error: "unrecognized channel type 'Foo'" },
    { args: ["-format", "%f:%wx%h;", "/a.ppm", "-channel"], stdout: "a.ppm:1x1;", error: "missing required argument '-channel'" },
    { args: ["-channel", "Foo", "/b.ppm"], stdout: "", error: "unrecognized channel type 'Foo'" },
    { args: ["-channel"], stdout: "", error: "missing required argument '-channel'" }
  ])(`${route}: selects channels in operand order ($args)`, async ({ args, stdout: expected, error }) => {
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    let result;
    if (route === "sync") result = runIdentifyCliSync(args, files);
    else if (route === "buffered" || route === "retained") result = await runIdentifyCli(args, route === "buffered" ? files : { filesystem: fs, cwd: "/" });
    else {
      const argumentValues = createCommandArguments(route === "magick" ? ["identify", ...args] : args);
      let stdout = "", stderr = "";
      const status = await (route === "magick" ? createMagickCommand() : createIdentifyCommand()).execute({
        command: route, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      result = { ...status, stdout, stderr };
    }
    expect(result).toEqual({ exitCode: error ? 1 : 0, stdout: expected, stderr: error ? `identify: ${error}\n` : "" });
  });
}
