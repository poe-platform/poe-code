import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.from("50360a3220320a3235350a0123456789abcdefff123456", "hex");
// ImageMagick 7.1.2-35 Q16-HDRI: ppm:- -depth N -endian MSB -interlace LAYOUT rgb:-.
const cases = [
    { depth: 9, layout: "None", hex: "0111914ce89d5ccdf7ffe24342b0" },
    { depth: 9, layout: "Line", hex: "0133802344c04555c0cd8900ef9a00ffab00" },
    { depth: 9, layout: "Plane", hex: "013380cd89002344c0ef9a004555c0ffab00" },
    { depth: 10, layout: "None", hex: "0108c4559d89aae0cdbbfffc48345590" },
    { depth: 10, layout: "Line", hex: "0119d0232260456ae0cd8480efcd10ffd590" },
    { depth: 10, layout: "Plane", hex: "0119d0cd8480232260efcd10456ae0ffd590" },
    { depth: 11, layout: "None", hex: "0104651533b8995740cdddffff890342ac80" },
    { depth: 11, layout: "Line", hex: "010cec233130455574cdc240efe684ffeac8" },
    { depth: 11, layout: "Plane", hex: "010ceccdc240233130efe684455574ffeac8" },
    { depth: 12, layout: "None", hex: "010232454676898abacdcefefff121343565" },
    { depth: 12, layout: "Line", hex: "010676232898454abacdc121efe343fff565" },
    { depth: 12, layout: "Plane", hex: "010676cdc121232898efe343454abafff565" },
    { depth: 13, layout: "None", hex: "0101191150ced898d5d4cdcf7f7ffe2423432b28" },
    { depth: 13, layout: "Line", hex: "01033b4023244c4045455d40cdc89080efe9a180fffab280" },
    { depth: 13, layout: "Plane", hex: "01033b40cdc8908023244c40efe9a18045455d40fffab280" },
    { depth: 14, layout: "None", hex: "01008c945459d9898aaea0cdcfbfbfffc48434355950" },
    { depth: 14, layout: "Line", hex: "01019d90232626204546aea0cdcc4840efecd0d0fffd5950" },
    { depth: 14, layout: "Plane", hex: "01019d90cdcc484023262620efecd0d04546aea0fffd5950" },
    { depth: 15, layout: "None", hex: "0100464515133b3898957540cdcddfdffff89093434acac0" },
    { depth: 15, layout: "Line", hex: "0100cecc2323131045455754cdcc2424efee6868fffeacac" },
    { depth: 15, layout: "Plane", hex: "0100cecccdcc242423231310efee686845455754fffeacac" },
    { depth: 16, layout: "None", hex: "01012323454567678989ababcdcdefefffff121234345656" },
    { depth: 16, layout: "Line", hex: "01016767232389894545ababcdcd1212efef3434ffff5656" },
    { depth: 16, layout: "Plane", hex: "01016767cdcd121223238989efef34344545ababffff5656" },
];

for (const mode of ["command", "sync", "retained"] as const) {
    for (const endian of ["MSB", "LSB"]) {
        it.each(cases)(`packs RGB $depth-bit $layout rows (${mode}, ${endian})`, async ({ depth, layout, hex }) => {
            const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const args = ["/in.ppm", "-depth", String(depth), "-endian", endian, "-interlace", layout,
                ...(mode === "command" ? ["rgb:-"] : mode === "retained" ? ["-write", "rgb:/out", "null:"] : ["rgb:/out"])];
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const expected = Buffer.from(hex, "hex");
            if (depth === 16 && endian === "LSB") expected.swap16();
            const output = mode === "command" ? Buffer.concat(stdout) : mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
            expect(Buffer.from(output).toString("hex")).toBe(expected.toString("hex"));
        });
    }
}

for (const mode of ["sync", "retained"] as const) {
    for (const sourceDepth of [8, 16]) {
        for (const layout of ["None", "Line", "Plane"]) {
            it.each([9, 11, 13, 14, 15])(`pads RGB %i-bit rows across storage reads (${mode}, ${sourceDepth}-bit input, ${layout})`, async depth => {
                const width = 4099;
                const input = Buffer.concat([
                    Buffer.from(`P6\n${width} 2\n${2 ** sourceDepth - 1}\n`),
                    Buffer.alloc(width * 3 * sourceDepth / 8, 255), Buffer.alloc(width * 3 * sourceDepth / 8)
                ]);
                const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
                const fs = new MemoryFileSystem();
                await fs.writeFile("/in.ppm", input);
                const args = ["/in.ppm", "-depth", String(depth), "-interlace", layout, "rgb:/out"];
                const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
                expect(result).toMatchObject({ exitCode: 0, stderr: "" });
                const rowBits = width * (layout === "None" ? 3 : 1) * depth;
                const rowBytes = Math.ceil(rowBits / 8);
                const white = Buffer.alloc(rowBytes, 255), black = Buffer.alloc(rowBytes);
                white[rowBytes - 1] = 255 << ((8 - rowBits % 8) % 8) & 255;
                const expected = Buffer.concat(layout === "None" ? [white, black]
                    : layout === "Line" ? [white, white, white, black, black, black]
                    : [white, black, white, black, white, black]);
                expect(Buffer.from(mode === "sync" ? files.get("/out")! : await fs.readFile("/out")).equals(expected)).toBe(true);
            });
        }
    }
}
