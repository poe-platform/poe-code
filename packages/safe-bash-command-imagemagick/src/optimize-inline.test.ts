import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"]) {
  it.each([
    { options: ["-coalesce", "-layers", "OptimizeFrame"], second: "2x2:4x3+2+1" },
    { options: ["-layers", "Optimize"], second: "2x2:4x3+2+1" },
    { options: ["-coalesce"], second: "4x3:4x3+0+0" },
  ])(`reports positioned inline frame rectangles before encoding (${mode}, $options)`, async ({ options, second }) => {
    const args = [
      "(", "-size", "2x2", "xc:red", "-repage", "4x3+1+0", ")",
      "(", "-size", "2x2", "xc:blue", "-repage", "4x3+2+1", ")",
      ...options, "-format", "%s:%wx%h:%g:%D;", "info:-",
    ];
    const filesystem = new MemoryFileSystem();
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async chunk => { stdout += new TextDecoder().decode(chunk); } },
      stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
    }) : mode === "sync" ? runConvertCliSync(args, new Map()) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
    expect(result.exitCode).toBe(0);
    expect(mode === "command" ? stderr : ("stderr" in result ? result.stderr : undefined)).toBe("");
    expect(mode === "command" ? stdout : ("stdout" in result ? result.stdout : undefined)).toBe(`0:4x3:4x3+0+0:None;1:${second}:None;`);
  });
}

for (const retained of [false, true]) {
  it.each([["-coalesce", "-layers", "OptimizeFrame"], ["-layers", "Optimize"], ["-coalesce", "-layers", "Optimize"]])(`compares original canvases across three frames (retained=${retained}, %j)`, async (...options) => {
    const input = [
      "(", "-size", "2x2", "xc:red", "-repage", "4x3+1+0", ")",
      "(", "-size", "2x2", "xc:blue", "-repage", "4x3+2+1", ")",
      "(", "-size", "1x1", "xc:lime", "-repage", "4x3+0+2", ")",
    ];
    const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const context = retained ? { filesystem, cwd: "/" } : files;
    expect(await runConvertCli([...input, ...options, "-format", "%s:%wx%h:%g:%D;", "info:-"], context)).toMatchObject({
      exitCode: 0, stderr: "", stdout: "0:4x3:4x3+0+0:None;1:2x2:4x3+2+1:None;2:1x1:4x3+0+2:None;",
    });
    expect(await runConvertCli([...input, "-coalesce", "-depth", "8", "rgba:before"], context)).toMatchObject({ exitCode: 0 });
    expect(await runConvertCli([...input, ...options, "-coalesce", "-depth", "8", "rgba:after"], context)).toMatchObject({ exitCode: 0 });
    expect(retained ? await filesystem.readFile("/after") : files.get("after"))
      .toEqual(retained ? await filesystem.readFile("/before") : files.get("before"));
  });
}
