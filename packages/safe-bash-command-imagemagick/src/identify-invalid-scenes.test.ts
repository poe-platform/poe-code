import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

const gif = Buffer.from("R0lGODlhAgABAPAAAAD/AAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAAAAACwAAAAAAgABAAACAgQKACH5BAAAAAAALAAAAAABAAEAgP8AAAAAAAICRAEAOw==", "base64");

for (const route of ["sync", "buffered", "filesystem", "identify", "magick"] as const) {
  it.each(["2,1", "1,2"])(`${route}: keeps valid scenes around invalid index [%s]`, async selector => {
    const files = new Map([["/clip.gif", gif], ["/a.ppm", Buffer.from("P3\n1 1\n255\n255 0 0\n")]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["-format", "%s;", `/clip.gif[${selector}]`, "/a.ppm"];
    let result;
    if (route === "sync") result = runIdentifyCliSync(args, files);
    else if (route === "buffered") result = await runIdentifyCli(args, files);
    else if (route === "filesystem") result = await runIdentifyCli(args, { filesystem: fs, cwd: "/" });
    else {
      const command = route === "magick" ? createMagickCommand() : createIdentifyCommand();
      const argumentValues = createCommandArguments(route === "magick" ? ["identify", ...args] : args);
      let stdout = "", stderr = "";
      const status = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      result = { ...status, stdout, stderr };
    }
    expect(result.stdout).toBe("1;0;");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid image index 2");
  });
}
