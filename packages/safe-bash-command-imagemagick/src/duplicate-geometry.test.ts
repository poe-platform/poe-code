import { createCommandArguments } from "safe-bash-contracts";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    // Byte-for-byte results from native ImageMagick, including the integer controls.
    it.each([
        ["2%", 2], ["(1)", 0], ["1 2", 1], ["2!", 2], ["2/1", 2], ["2x2+1+1", 2],
        ["+2+1", 2], ["+2-1", 2], ["+2+1,0", 2], ["+2-1,0", 2], ["+2", 2],
        ["2", 2], ["0", 0], ["2foo", null], ["2+0", null], ["2-0", null], ["2+1", null], ["2+1,0", null]
    ] as const)(`${mode}: duplicate '%s' preserves native status and destination bytes`, async (count, repeats) => {
        const keep = new TextEncoder().encode("KEEP");
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", keep);
        const files = new Map([["out", keep]]);
        const args = ["xc:red", "xc:lime", "xc:blue", "xc:white", "-duplicate", count, "+append", "-depth", "8", "rgb:out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs: filesystem, cwd: "/", env: {},
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(repeats === null ? 1 : 0);
        if (repeats !== null) expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        const repeatedPixel = count.endsWith(",0") ? [255, 0, 0] : [255, 255, 255];
        expect([...output]).toEqual(repeats === null ? [...keep] : [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, ...Array(repeats).fill(repeatedPixel).flat()]);
    });
}
