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
        const context: CommandContext = {
          command: command.name, args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} },
        };
        if (parent === "directory") {
          expect((await command.execute(context)).exitCode).toBe(0);
          expect((await fs.readFile("/output/in.png")).byteLength).toBeGreaterThan(0);
        } else {
          await expect(command.execute(context)).rejects.toThrow(parent === "missing" ? /ENOENT/ : /ENOTDIR/);
          if (parent === "missing") await expect(fs.stat("/output")).rejects.toThrow(/ENOENT/);
          else expect(await fs.readFile("/output")).toEqual(new Uint8Array([1]));
        }
        expect(await fs.readFile("/in.png")).toEqual(png);
      });
    }
  }
}
