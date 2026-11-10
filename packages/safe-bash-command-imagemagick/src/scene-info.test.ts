import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const append of [false, true])
for (const scene of [undefined, 0, 5])
for (const format of ["%s;", "%[scene]:%p:%n:%[fx:t]:%N;"])
it(`${mode}: formats scene ${scene} with append=${append} using ${format}`, async () => {
    const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/out", files.get("out")!);
    const sceneArgs = scene === undefined ? [] : ["-scene", String(scene)];
    const argv = [
        ...(append ? sceneArgs : []),
        "-size", "2x3", "xc:#8040c080", "-size", "3x2", "xc:#30905040",
        ...(append ? ["-append"] : sceneArgs), "-format", format, "info:out"
    ];
    let stdout = "", stderr = "";
    const argumentValues = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" });
    if ("stdout" in result) stdout = String(result.stdout);
    if ("stderr" in result) stderr = String(result.stderr);
    expect({ exitCode: result.exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await filesystem.readFile("/out");
    const start = scene ?? 0;
    expect(new TextDecoder().decode(output)).toBe(format === "%s;"
        ? append ? `${start};` : `${start};${start + 1};`
        : append ? `${start}:0:1:0:1\n;` : `${start}:0:2:0:;${start + 1}:1:2:1:2\n;`);
});
