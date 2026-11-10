import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const route of ["sync", "map", "filesystem", "command"]) {
  it.each([
    { args: ["xc:red", "xc:blue", "-set", "dispose", "%[fx:t+1]"], expected: "None||;Background||;" },
    { args: ["-set", "option:method", "Previous", "-dispose", "%[option:method]", "xc:red", "xc:blue"], expected: "Previous;Previous;" },
    { args: ["xc:red", "-set", "method", "Background", "-dispose", "%[method]", "xc:blue"], expected: "Undefined;Background;" },
    { args: ["xc:red", "xc:blue", "-set", "dispose", "Previous"], expected: "Previous||;Previous||;" },
    { args: ["-dispose", "pReViOuS", "xc:red", "xc:blue"], expected: "Previous;Previous;" },
  ])(`expands disposal in the correct image context (${route}): $args`, async ({ args, expected }) => {
    const format = args.includes("-dispose") ? "%D;" : "%D|%[dispose]|%[option:dispose];";
    const argv = [...args, "-format", format, "info:-"];
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    let result;
    if (route === "sync") result = runMagickCliSync(argv, files);
    else if (route === "map") result = await runMagickCli(argv, files);
    else if (route === "filesystem") result = await runMagickCli(argv, { filesystem: fs, cwd: "/" });
    else {
      const command = createMagickCommand(), argumentValues = createCommandArguments(argv);
      let stdout = "", stderr = "";
      const execution = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      });
      result = { ...execution, stdout, stderr };
    }
    expect(result).toMatchObject({ exitCode: 0, stdout: expected });
  });
}
