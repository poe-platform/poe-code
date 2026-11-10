import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "filesystem", "map", "sync"] as const)
for (const direction of ["-append", "+append"])
for (const single of [false, true])
for (const oriented of [false, true])
it(`${mode}: ${direction} retains orientation (${single ? "single" : "multiple"}, ${oriented})`, async () => {
    const fs = createMemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const source = ["(", "-size", "2x1", "xc:#2060b080", ")",
        ...(single ? [] : ["(", "-size", "1x2", "xc:#c04020ed", ")"]),
        ...(oriented ? ["-orient", "RightTop"] : []), direction];
    for (const autoOrient of [false, true]) {
        await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
        files.set("/out", new TextEncoder().encode("KEEP"));
        const args = [...source, ...(autoOrient ? ["-auto-orient"] : []), "-format",
            autoOrient ? "%wx%h" : "%[orientation]", "info:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        const [width, height] = single ? [2, 1] : direction === "-append" ? [2, 3] : [3, 2];
        expect(new TextDecoder().decode(output)).toBe(autoOrient
            ? oriented ? `${height}x${width}` : `${width}x${height}`
            : oriented ? "RightTop" : "Undefined");
    }
});
