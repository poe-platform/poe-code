import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompositeCommand, createMagickCommand, runCompositeCli, runCompositeCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: composite -unsharp sharpens the inputs and
// selects Threshold composition, preserving the sharpened destination here.
for (const route of ["magick", "composite", "buffered", "sync"])
for (const afterInputs of [false, true])
it.each([
    [undefined, "0a141e28323c46505a"],
    ["1x1", "5d6771838d97a9b3bd"],
    ["0x2", "525c66838d97b4bec8"],
    ["invalid", "4b454550"],
] as const)(`${route}: composite unsharp %s (after inputs=${afterInputs})`, async (geometry, expected) => {
    const files = new Map([
        ["/left.ppm", new TextEncoder().encode("P3\n3 1\n255\n10 20 30 40 50 60 70 80 90\n")],
        ["/right.ppm", new TextEncoder().encode("P3\n3 1\n255\n101 111 121 131 141 151 161 171 181\n")],
        ["/out.raw", new TextEncoder().encode("KEEP")],
    ]);
    const options = geometry === undefined ? [] : ["-unsharp", geometry];
    const inputs = ["/left.ppm", "/right.ppm"];
    const args = [...(afterInputs ? [...inputs, ...options] : [...options, ...inputs]), "rgb:/out.raw"];
    let exitCode: number, stdout = "", stderr = "", output: Uint8Array;
    if (route === "magick" || route === "composite") {
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const result = await (route === "magick" ? createMagickCommand() : createCompositeCommand()).execute({
            command: route, args: createCommandArguments(route === "magick" ? ["composite", ...args] : args).args,
            cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        });
        exitCode = result.exitCode;
        output = await fs.readFile("/out.raw");
    } else {
        const result = route === "sync" ? runCompositeCliSync(args, files) : await runCompositeCli(args, files);
        ({ exitCode, stdout, stderr } = result);
        output = files.get("/out.raw")!;
    }
    expect(exitCode).toBe(geometry === "invalid" ? 1 : 0);
    expect(stdout).toBe("");
    if (geometry === "invalid") expect(stderr.toLowerCase()).toContain("invalid unsharp geometry");
    else expect(stderr).toBe("");
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
