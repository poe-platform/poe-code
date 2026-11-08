import { expect, test } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { createOverlayFileSystem } from "@poe-code/safe-fs/fs/overlay";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, createConvertCommand, createMogrifyCommand, runConvertCli } from "./index.js";

for (const overlay of [false, true]) {
  for (const command of [createMagickCommand(), createConvertCommand(), createMogrifyCommand()]) {
    for (const parent of ["missing", "file", "directory"] as const) {
      test(`${command.name} output parent ${parent} on ${overlay ? "overlay" : "memory"}`, async () => {
        const files = new Map<string, Uint8Array>();
        await runConvertCli(["-size", "1x1", "xc:red", "in.png"], files);
        const png = files.get("in.png")!;
        const lower = createMemoryFileSystem();
        await lower.writeFile("/in.png", png);
        if (parent === "directory") await lower.mkdir("/output");
        if (parent === "file") await lower.writeFile("/output", new Uint8Array([1]));
        const fs = overlay ? createOverlayFileSystem({ lower, upper: createMemoryFileSystem() }) : lower;
        const argv = command.name === "mogrify" ? ["-path", "/output", "in.png"] : ["in.png", "/output/in.png"];
        let stderr = "";
        const context: CommandContext = {
          command: command.name, args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
        };
        if (parent === "directory") {
          expect((await command.execute(context)).exitCode).toBe(0);
          expect((await fs.readFile("/output/in.png")).byteLength).toBeGreaterThan(0);
        } else {
          expect((await command.execute(context)).exitCode).toBe(1);
          expect(stderr).toContain("/output/in.png");
          expect(stderr).toContain(parent === "missing" ? "ENOENT" : "ENOTDIR");
          if (parent === "missing") await expect(fs.stat("/output")).rejects.toThrow(/ENOENT/);
          else expect(await fs.readFile("/output")).toEqual(new Uint8Array([1]));
        }
        expect(await fs.readFile("/in.png")).toEqual(png);
      });
    }
  }
}

for (const buffered of [false, true]) for (const args of [
  ["in.png", "missing/out.png"],
  ["in.png", "-write", "missing/dir/mid.png", "-negate", "out.png"],
]) {
  test(`missing output parent returns a diagnostic (buffered=${buffered}): ${args.join(" ")}`, async () => {
    const fs = createMemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    await runConvertCli(["-size", "1x1", "xc:red", "in.png"], files);
    await fs.writeFile("/in.png", files.get("in.png")!);
    let stderr = "", stdout = "";
    const filesystem = buffered ? new Proxy(fs, { get(target, key) {
      if (key === "capabilities") return undefined;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } }) : fs;
    const context: CommandContext = {
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
      stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
    };
    expect(await createMagickCommand().execute(context)).toEqual({ exitCode: 1 });
    expect(stderr).toContain(args.find(arg => arg.startsWith("missing/")));
    expect(stdout).toBe("");
    await expect(fs.stat("/missing")).rejects.toThrow("ENOENT");
    await expect(fs.stat("/out.png")).rejects.toThrow("ENOENT");
  });
}
