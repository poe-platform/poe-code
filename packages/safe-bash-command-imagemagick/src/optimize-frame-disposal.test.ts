import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "command", "sync"]) {
  it.each([
    { options: [], disposal: "Undefined" },
    { options: ["-layers", "OptimizeFrame"], disposal: "None" },
    { options: ["-layers", "Optimize"], disposal: "None" },
    { options: ["-coalesce", "-layers", "OptimizeFrame"], disposal: "None" },
  ].flatMap(test => [undefined, "Background", "Previous"].map(inputDisposal => ({ ...test, inputDisposal }))))(`reports native inline frame disposal (${mode}, $options, $inputDisposal)`, async ({ options, disposal, inputDisposal }) => {
    const args = ["xc:red", "(", ...(inputDisposal ? ["-dispose", inputDisposal] : []), "xc:blue", ")", ...options, "-format", "%wx%h %g %D;", "info:-"];
    const filesystem = new MemoryFileSystem();
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async chunk => { stdout += new TextDecoder().decode(chunk); } },
      stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
    }) : mode === "sync" ? runConvertCliSync(args, new Map()) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect("stdout" in result ? result.stdout : stdout).toBe(`1x1 1x1+0+0 ${disposal};1x1 1x1+0+0 ${options.length ? disposal : inputDisposal ?? disposal};`);
  });
}

for (const mode of ["buffered", "retained"]) {
  it.each(["OptimizeFrame", "Optimize"])(`preserves opaque pixels (${mode}, %s)`, async operation => {
    const result = await runConvertCli(["xc:red", "xc:blue", "-layers", operation, "-depth", "8", "rgba:-"],
      mode === "retained" ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map());
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdoutBytes).toEqual(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]));
  });
}

for (const mode of ["buffered", "retained", "command", "sync"]) {
  it.each([
    { operation: "OptimizeFrame", inputDisposal: "Background", firstSize: "1x1" },
    { operation: "OptimizeFrame", inputDisposal: "None", firstSize: "1x1" },
    { operation: "Optimize", inputDisposal: "Background", firstSize: "3x2" },
  ])(`recomputes first-frame disposal for coincident pixels (${mode}, $operation, $inputDisposal)`, async ({ operation, inputDisposal, firstSize }) => {
    const args = ["-size", "1x1", "(", "xc:red", "-repage", "3x2+0+0", "-set", "dispose", inputDisposal, ")",
      "(", "xc:blue", "-repage", "3x2+0+0", ")", "-layers", operation, "-format", "%wx%h %g %D;", "info:"];
    const filesystem = new MemoryFileSystem();
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async chunk => { stdout += new TextDecoder().decode(chunk); } },
      stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
    }) : mode === "sync" ? runConvertCliSync(args, new Map()) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect("stdout" in result ? result.stdout : stdout).toBe(`${firstSize} 3x2+0+0 None;1x1 3x2+0+0 None;`);
  });
}
