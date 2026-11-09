import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: cluster.png +dither -treedepth N -colors 16 PNG32:out.png.
const input = readFileSync(new URL("./fixtures/treedepth-cluster.png", import.meta.url));
const references = [1, 8].map(depth => decodeImage(readFileSync(new URL(`./fixtures/treedepth-${depth}.png`, import.meta.url))).data);
const keep = new TextEncoder().encode("KEEP");

for (const mode of ["command", "sync"] as const) {
    async function run(options: string[]) {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", keep]]);
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/out.png", keep);
        const args = ["/in.png", "+dither", ...options, "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : runConvertCliSync(args, files);
        if ("stderr" in result) stderr += result.stderr;
        return { exitCode: result.exitCode, stderr, output: mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")! };
    }

    it.each([1, 8])(`matches every native pixel at tree depth %i (${mode})`, async depth => {
        const result = await run(["-treedepth", String(depth), "-colors", "16"]);
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = decodeImage(result.output);
        expect([output.width, output.height]).toEqual([256, 1]);
        expect(output.data).toEqual(references[depth === 1 ? 0 : 1]);
    });

    it(`clamps depth and captures settings at each colors operator (${mode})`, async () => {
        for (const [options, expected] of [
            [["-treedepth", "2", "-colors", "16"], references[0]],
            [["-treedepth", "64", "-colors", "16"], references[1]],
            [["-treedepth", "1", "-treedepth", "8", "-colors", "16"], references[1]],
            [["-treedepth", "8", "-colors", "16", "-treedepth", "1"], references[1]],
            [["-treedepth", "1"], decodeImage(input).data],
            [["-treedepth", "1", "-colors", "256"], decodeImage(input).data],
        ] as const) {
            const result = await run([...options]);
            expect(result.stderr).toBe("");
            expect(result.exitCode).toBe(0);
            expect(decodeImage(result.output).data).toEqual(expected);
        }
        const defaults = await run(["-colors", "16"]);
        for (const reset of [["+treedepth"], ["-treedepth", "0"]]) {
            const result = await run(["-treedepth", "1", ...reset, "-colors", "16"]);
            expect(result.exitCode).toBe(0);
            expect(decodeImage(result.output).data).toEqual(decodeImage(defaults.output).data);
        }
    });

    it.each(["", "invalid", "-1", "1.5", "Infinity", "9007199254740992"])(`rejects invalid depth %j without replacing output (${mode})`, async depth => {
        const result = await run(["-treedepth", depth, "-colors", "16"]);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("-treedepth");
        expect(result.output).toEqual(keep);
    });

}
