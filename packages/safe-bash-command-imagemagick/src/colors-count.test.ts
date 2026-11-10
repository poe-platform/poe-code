import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: counts read the decimal prefix, not the whole number.
for (const mode of ["map", "sync", "filesystem", "command"] as const)
for (const output of ["info", "rgba"] as const)
it.each([
    { count: "2.9", exitCode: 0, colors: 2 },
    { count: "2e1", exitCode: 0, colors: 2 },
    { count: "2x3", exitCode: 0, colors: 2 },
    { count: "2%", exitCode: 0, colors: 2 },
    { count: "0x2", exitCode: 1, colors: 0 },
    { count: "-1", exitCode: 0, colors: 5 },
    { count: "2", exitCode: 0, colors: 2 },
    { count: "0", exitCode: 1, colors: 0 },
    { count: "02", exitCode: 0, colors: 2 },
    { count: "bad", exitCode: 1, colors: 0 },
])(`matches native -colors $count exit status and ${output} destination (${mode})`, async ({ count, exitCode, colors }) => {
    const initial = new TextEncoder().encode("KEEP"), fs = new MemoryFileSystem();
    const files = new Map([["/out", initial]]);
    await fs.writeFile("/out", initial);
    const args = [
        ...(count === "0x2" ? ["xc:red"] : ["xc:#b03010", "xc:#302010", "xc:#505080", "xc:#a07070", "xc:#d0d020", "+append"]),
        "-set", "option:n", "2", "+dither", "-colors", count,
        ...(output === "info" ? ["-format", "%r|%k", "info:/out"] : ["-depth", "8", "rgba:/out"]),
    ];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    if ("stderr" in result) stderr += result.stderr;
    expect(result.exitCode).toBe(exitCode);
    if (exitCode === 0) expect(stderr).toBe("");
    else expect(stderr).not.toBe("");
    const bytes = mode === "command" || mode === "filesystem" ? await fs.readFile("/out") : files.get("/out")!;
    const expected = exitCode ? "KEEP" : `PseudoClass sRGB |${colors}`;
    expect(Buffer.from(bytes).toString(output === "info" || exitCode ? "utf8" : "hex"))
        .toBe(output === "info" || exitCode ? expected : colors === 2
            ? "a85040ff706b3bff706b3bffa85040ffa85040ff"
            : "b03010ff302010ff505080ffa07070ffd0d020ff");
});
