import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// Native ImageMagick fixtures, independent of our packed writer; rows are byte-padded.
const fixtures = [
    [9, "0111914ce89d5ccdf7ffe24342b0", "0133802344c04555c0cd8900ef9a00ffab00", "013380cd89002344c0ef9a004555c0ffab00"],
    [11, "0104651533b8995740cdddffff890342ac80", "010cec233130455574cdc240efe684ffeac8", "010ceccdc240233130efe684455574ffeac8"],
    [13, "0101191150ced898d5d4cdcf7f7ffe2423432b28", "01033b4023244c4045455d40cdc89080efe9a180fffab280", "01033b40cdc8908023244c40efe9a18045455d40fffab280"],
    [14, "01008c945459d9898aaea0cdcfbfbfffc48434355950", "01019d90232626204546aea0cdcc4840efecd0d0fffd5950", "01019d90cdcc484023262620efecd0d04546aea0fffd5950"],
    [15, "0100464515133b3898957540cdcddfdffff89093434acac0", "0100cecc2323131045455754cdcc2424efee6868fffeacac", "0100cecccdcc242423231310efee686845455754fffeacac"]
] as const;
const cases = fixtures.flatMap(([depth, ...inputs]) => inputs.map((hex, index) => ({ depth, hex, interlace: ["None", "Line", "Plane"][index]! })));

for (const mode of ["file", "stream", "sync"] as const) {
    it.each(cases)(`${mode}: decodes $depth-bit RGB with $interlace interlace`, async ({ depth, hex, interlace }) => {
        const input = Buffer.from(hex, "hex");
        const argv = ["-size", "2x2", "-depth", String(depth), "-endian", "MSB", "-interlace", interlace,
            mode === "stream" ? "rgb:-" : "rgb:/in.bin", "-interlace", "None", "-depth", "8", "rgb:/out.bin"];
        let output: Uint8Array;
        if (mode === "sync") {
            const files = new Map<string, Uint8Array>([["/in.bin", input]]);
            const result = runMagickCliSync(argv, files);
            expect(result.stderr).toBe("");
            expect(result.exitCode).toBe(0);
            output = files.get("/out.bin")!;
        } else {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.bin", input);
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal,
                stdin: (async function* () { for (const byte of input) yield Uint8Array.of(byte); })(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(stderr).toBe("");
            expect(result.exitCode).toBe(0);
            output = await fs.readFile("/out.bin");
        }
        expect(Buffer.from(output).toString("hex")).toBe("0123456789abcdefff123456");
    });
}
