import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runIdentifyCli, runIdentifyCliSync, runConvertCli, runConvertCliSync } from "./index.js";

for (const identify of [true, false])
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const quoted of [false, true])
for (const surround of [false, true])
it(`expands ordered ${identify ? "identify" : "conversion"} lists via ${mode}, quoted: ${quoted}, surrounding inputs: ${surround}`, async () => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();
  for (const [name, text] of [
    ["a.ppm", "P3\n1 1\n255\n255 0 0\n"],
    ["b.ppm", "P3\n2 1\n255\n0 255 0 0 255 0\n"],
    ["two words.ppm", "P3\n1 1\n255\n0 0 255\n"],
    ["batch.lst", `b.ppm\n${quoted ? '"two words.ppm"' : "a.ppm"}\nb.ppm\n`]
  ]) {
    const bytes = encoder.encode(text);
    files.set(name!, bytes);
    await fs.writeFile("/" + name, bytes);
  }
  const args = identify ? ["-format", "%wx%h;", ...(surround ? ["a.ppm"] : []), "@batch.lst", ...(surround ? ["a.ppm"] : [])] : [...(surround ? ["a.ppm"] : []), "@batch.lst", ...(surround ? ["a.ppm"] : []), "-format", "%wx%h;", "info:"];
  let result;
  if (mode === "command") {
    const command = createMagickCommand(), argumentValues = createCommandArguments(identify ? ["identify", ...args] : args);
    let stdout = "", stderr = "";
    const context: CommandContext = {
      command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(), registerCleanup() {},
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    };
    result = { ...await command.execute(context), stdout, stderr };
  } else {
    result = mode === "sync" ? (identify ? runIdentifyCliSync : runConvertCliSync)(args, files)
      : await (identify ? runIdentifyCli : runConvertCli)(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  }
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe(surround ? "1x1;2x1;1x1;2x1;1x1;" : "2x1;1x1;2x1;");
});

for (const retained of [true, false])
it(`identify continues after missing listed images, retained: ${retained}`, async () => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  for (const [name, text] of [["a.ppm", "P3\n1 1\n255\n255 0 0\n"], ["batch.lst", "a.ppm\nmissing.ppm\na.ppm\n"]]) {
    const bytes = new TextEncoder().encode(text);
    files.set(name!, bytes);
    await fs.writeFile("/" + name, bytes);
  }
  const result = await runIdentifyCli(["-format", "%wx%h;", "@batch.lst"], retained ? { filesystem: fs, cwd: "/" } : files);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("1x1;1x1;");
  expect(result.stderr).toContain("unable to open image 'missing.ppm'");
});

for (const identify of [true, false])
it(`charges ${identify ? "identify" : "conversion"} list bytes to the input budget`, async () => {
  const fs = new MemoryFileSystem(), failure = new Error("list input limit");
  await fs.writeFile("/batch.lst", new TextEncoder().encode("a.ppm\n"));
  await expect((identify ? runIdentifyCli : runConvertCli)(identify ? ["@batch.lst"] : ["@batch.lst", "info:"], {
    filesystem: fs, cwd: "/", inputBudget: { check(total) { if (total > 5) throw failure; } }
  })).rejects.toBe(failure);
});

for (const identify of [true, false])
it(`reports missing lists consistently for ${identify ? "identify" : "conversion"}`, async () => {
  const args = identify ? ["@absent.lst"] : ["@absent.lst", "info:"];
  const files = new Map<string, Uint8Array>();
  const expected = (identify ? runIdentifyCliSync : runConvertCliSync)(args, files);
  expect(expected.exitCode).toBe(1);
  expect(expected.stderr).toContain("unable to open image '@absent.lst'");
  expect(await (identify ? runIdentifyCli : runConvertCli)(args, files)).toEqual(expected);
  expect(await (identify ? runIdentifyCli : runConvertCli)(args, { filesystem: new MemoryFileSystem(), cwd: "/" })).toEqual(expected);
});
