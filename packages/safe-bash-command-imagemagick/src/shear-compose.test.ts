import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";
import fixtures from "./shear-compose-fixtures.json" with { type: "json" };

// Native ImageMagick 7.1.2-35 Q16-HDRI: alpha-bearing 7x5 PNG, RGBA:- at the selected depth (LSB).
for (const mode of ["command", "sync"] as const) {
    it.each(fixtures.cases)(`${mode}: $depth-bit $compose onto $background before shear $geometry`, async ({ compose, background, geometry, depth, rgba }) => {
        const input = Buffer.from(depth === 16 ? fixtures.input16 : fixtures.input, "base64");
        const keep = new TextEncoder().encode("KEEP"), fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", keep]]);
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/out.png", keep);
        const args = ["/in.png", "-background", background, "-compose", compose,
            ...(compose === "Blend" ? ["-define", "compose:args=30,70"] : []), "-shear", geometry, `${depth === 16 ? "PNG64" : "PNG32"}:/out.png`];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : runConvertCliSync(args, files);
        if ("stderr" in result) stderr += result.stderr;
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual(geometry === "0x0" ? [7, 5] : [9, 6]);
        const expected = Buffer.from(rgba, "base64");
        if (depth === 16) {
            expect(output.data16).toBeDefined();
            expect(output.data16!.length).toBe(expected.length / 2);
            // Native HDRI stores intermediate float samples; allow one Q16 rounding unit.
            for (let i = 0; i < output.data16!.length; i++) {
                expect(Math.abs(output.data16![i]! - expected.readUInt16LE(i * 2))).toBeLessThanOrEqual(1);
            }
        } else expect(output.data).toEqual(new Uint8Array(expected));
    });
}
