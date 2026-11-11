import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

for (const route of ["sync", "map", "filesystem", "stream", "identify", "magick"]) {
  it.each([
    { name: "ordinary warning", args: ["a.ppm"], stdout: "a.ppm:1x1:AB;", warning: true },
    { name: "quiet", args: ["-quiet", "a.ppm"], stdout: "a.ppm:1x1:AB;" },
    { name: "plus quiet", args: ["+quiet", "a.ppm"], stdout: "a.ppm:1x1:AB;" },
    { name: "plus quiet after quiet", args: ["-quiet", "+quiet", "a.ppm"], stdout: "a.ppm:1x1:AB;" },
    { name: "quiet between inputs", args: ["a.ppm", "-quiet", "b.ppm"], stdout: "a.ppm:1x1:AB;b.ppm:2x1:AB;" },
    { name: "plus quiet between inputs", args: ["a.ppm", "+quiet", "b.ppm"], stdout: "a.ppm:1x1:AB;b.ppm:2x1:AB;" },
    { name: "trailing quiet", args: ["a.ppm", "b.ppm", "-quiet"], stdout: "a.ppm:1x1:AB;b.ppm:2x1:AB;" },
    { name: "missing first input", args: ["-quiet", "miss.ppm", "a.ppm"], stdout: "a.ppm:1x1:AB;", missing: true },
    { name: "missing middle input", args: ["a.ppm", "-quiet", "miss.ppm", "b.ppm"], stdout: "a.ppm:1x1:AB;b.ppm:2x1:AB;", missing: true },
    { name: "missing last input", args: ["-quiet", "+quiet", "a.ppm", "b.ppm", "miss.ppm"], stdout: "a.ppm:1x1:AB;b.ppm:2x1:AB;", missing: true },
    { name: "read error control", args: ["-quiet", "-format", "%f:%wx%h;", "miss.ppm", "a.ppm"], stdout: "a.ppm:1x1;", missing: true },
    { name: "FX error", args: ["-quiet", "-format", "A%[fx:page.z]B", "a.ppm"], stdout: "AB", error: "Bad channel qualifier: z" },
    { name: "malformed format", args: ["-quiet", "-format", "A%[widthB", "a.ppm"], stdout: "", error: "unbalanced braces" }
  ])(`identify quiet preserves output and errors through ${route}: $name`, async ({ args: operands, stdout: expected, warning, missing, error }) => {
    const files = new Map([
      ["a.ppm", new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n")],
      ["b.ppm", new TextEncoder().encode("P3\n2 1\n255\n0 0 255 0 255 0\n")]
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
    const args = ["-format", "%f:%wx%h:A%[no-such-prop]B;", ...operands];
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
      expect(result).toMatchObject({ stdout: "", stderr: "" });
      result = { ...result, stdout, stderr };
    } else {
      const command = route === "magick" ? createMagickCommand() : createIdentifyCommand();
      const argumentValues = createCommandArguments(route === "magick" ? ["identify", ...args] : args);
      result = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(), ...sinks
      });
      result = { ...result, stdout, stderr };
    }
    expect(result.exitCode).toBe(missing || error ? 1 : 0);
    expect(result.stdout).toBe(expected);
    if (error) expect(result.stderr).toContain(error);
    else expect(result.stderr).toBe(missing
      ? "identify: unable to open image 'miss.ppm': No such file or directory\n"
      : warning ? "magick: unknown image property '%[no-such-prop]'\n" : "");
  });
}
