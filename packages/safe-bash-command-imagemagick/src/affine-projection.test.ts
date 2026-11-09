import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";
import fixtures from "./affine-projection-fixtures.json" with { type: "json" };

// Decoded RGBA references from ImageMagick 7.1.2-35 Q16-HDRI.
const input = Buffer.from(fixtures.input, "base64");
const keep = new TextEncoder().encode("KEEP");

for (const mode of ["command", "sync"] as const) {
    async function run(options: string[]) {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", keep]]);
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/out.png", keep);
        const args = ["/in.png", ...options, "/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : runConvertCliSync(args, files);
        if ("stderr" in result) stderr += result.stderr;
        return { exitCode: result.exitCode, stderr, output: mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")! };
    }

    it.each(fixtures.cases)(`matches native AffineProjection $name (${mode})`, async reference => {
        const result = await run([...reference.options, reference.operator, "AffineProjection", reference.coefficients]);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        const output = decodeImage(result.output);
        expect([output.width, output.height, output.virtualCanvas?.x ?? 0, output.virtualCanvas?.y ?? 0]).toEqual([reference.width, reference.height, reference.x, reference.y]);
        expect(output.data).toEqual(new Uint8Array(Buffer.from(reference.rgba, "base64")));
    });

    it.each(["", "1,0,0,1,4", "1,0,0,1,4,3,2", "1,0,0,1,NaN,3", "1,0,0,1,4,Infinity"])(`rejects invalid coefficients %s without replacing output (${mode})`, async coefficients => {
        const result = await run(["-distort", "AffineProjection", coefficients]);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).not.toBe("");
        expect(result.output).toEqual(keep);
    });
}
