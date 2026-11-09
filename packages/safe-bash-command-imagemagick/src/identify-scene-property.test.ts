import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync, runMagickCliSync } from "./index.js";

for (const route of ["sync", "buffered", "retained", "identify", "magick"] as const) {
  it(`${route}: expands the default scene setting independently of the frame and list size`, async () => {
    const files = new Map<string, Uint8Array>();
    expect(runMagickCliSync(["-size", "3x2", "xc:red", "/photo.png"], files).exitCode).toBe(0);
    expect(runMagickCliSync(["-size", "3x2", "xc:red", "xc:blue", "/frames.gif"], files).exitCode).toBe(0);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    for (const [path, scenes, count] of [["/photo.png", [0], 1], ["/frames.gif", [0, 1], 2], ["/frames.gif[0]", [0], 1], ["/frames.gif[1]", [1], 1]] as const) {
      const args = ["-format", "%S|%s|%n|%%S|%S", path];
      let result;
      if (route === "magick" || route === "identify") {
        const command = route === "magick" ? createMagickCommand() : createIdentifyCommand();
        const argumentValues = createCommandArguments(route === "magick" ? ["identify", ...args] : args);
        let stdout = "", stderr = "";
        const status = await command.execute({
          command: command.name, args: argumentValues.args, argumentValues, fs: filesystem, cwd: "/", env: {},
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        result = { ...status, stdout, stderr };
      } else {
        result = route === "sync" ? runIdentifyCliSync(args, files)
          : await runIdentifyCli(args, route === "buffered" ? files : { filesystem, cwd: "/" });
      }
      expect(result).toEqual({ exitCode: 0, stdout: scenes.map(scene => `2147483647|${scene}|${count}|%S|2147483647`).join(""), stderr: "" });
    }
  });
}
