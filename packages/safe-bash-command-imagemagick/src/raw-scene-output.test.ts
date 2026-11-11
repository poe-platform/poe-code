import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "stream", "retained", "buffered", "sync"] as const)
for (const coder of ["rgb", "bgr"])
for (const selector of ["0", "1", "2,0"])
for (const output of ["info", "files"])
for (const frameCount of [3, 4])
it(`${mode}: preserves ${coder} scenes [${selector}] from ${frameCount} frames in ${output}`, async () => {
    const input = Buffer.from("010203040506111213141516212223242526313233343536", "hex").subarray(0, frameCount * 6);
    const files = new Map<string, Uint8Array>([["in.bin", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.bin", input);
    const argv = ["-size", "2x1", "-depth", "8", `${coder}:${mode === "stream" ? "-" : "in.bin"}[${selector}]`,
        ...(output === "info" ? ["-format", "%s/%p/%n;", "info:"] : [`${coder}:out-%d.bin`])];
    const argumentValues = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" || mode === "stream" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () { yield input; })(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "buffered" ? files : { filesystem, cwd: "/" });
    if ("stdout" in result) stdout = String(result.stdout);
    if ("stderr" in result) stderr = String(result.stderr);
    expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    const pages = selector.split(",").map(Number), start = pages[0]!;
    if (output === "info") {
        expect(stdout).toBe(pages.map((_, index) => `${start + index}/${index}/${pages.length};`).join(""));
    } else {
        const memory = mode === "sync" || mode === "buffered";
        const names = pages.map((_, index) => `out-${start + index}.bin`);
        expect((memory ? [...files.keys()] : (await filesystem.readdir("/")).map(entry => entry.name)).sort()).toEqual(["in.bin", ...names].sort());
        for (const [index, page] of pages.entries()) {
            const bytes = memory ? files.get(names[index]!) : await filesystem.readFile(`/${names[index]}`);
            expect(bytes).toEqual(new Uint8Array(input.subarray(page * 6, page * 6 + 6)));
        }
    }
});
