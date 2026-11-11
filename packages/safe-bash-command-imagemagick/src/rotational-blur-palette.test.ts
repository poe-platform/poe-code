import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n5 3\n255\n"), Buffer.from(Array.from({ length: 15 }, (_, i) => [i * 17, (i * 47) % 256, 200 - i * 7]).flat())]);

// ImageMagick 7.1.2-35 Q16-HDRI promotes blurred indexed input to DirectClass.
for (const mode of ["buffered", "retained", "command"])
it.each([false, true])(`reports indexed storage correctly with rotational blur=%s (${mode})`, async blur => {
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.ppm", input);
    const args = ["in.ppm", "-colors", "16", ...(blur ? ["-rotational-blur", "130"] : []), "-format", "%r|%k", "info:"];
    let stdout = "", stderr = "", exitCode: number;
    if (mode === "command") {
        const command = createMagickCommand(), argumentValues = createCommandArguments(args);
        const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
            cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } } });
        exitCode = result.exitCode;
    } else {
        const result = await runMagickCli(args, mode === "buffered" ? new Map([["in.ppm", input]]) : { filesystem, cwd: "/" });
        ({ stdout, stderr, exitCode } = result);
    }
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe(`${blur ? "DirectClass" : "PseudoClass"} sRGB |15`);
});
