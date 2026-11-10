import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("ff0000ff00ff00800000ff40fdfbf9bf080808ff627f9113", "hex")
]);
// ImageMagick 7.1.2-35 Q16-HDRI: each row starts on a byte boundary.
const cases = [
    { coder: "rgb", depth: 10, hex: "ffc0000000ffc0000000ffc0fdfeff9c2008020625fd9180" },
    { coder: "rgb", depth: 12, hex: "fff000000000fff000000000fff0fdffbff9f0800800806267f79190" },
    { coder: "gray", depth: 10, hex: "36adc128fc0207a8" },
    { coder: "gray", depth: 12, hex: "367b711280fc30807a90" },
    { coder: "rgba", depth: 10, hex: "ffc00003ff003ff0020200000ffd01fdfeff9efe08020083ff625fd9184c" },
    { coder: "rgba", depth: 12, hex: "fff000000fff000fff000808000000fff404fdffbff9fbfb080080080fff6267f7919131" },
    { coder: "rgb", depth: 16, hex: "ffff000000000000ffff000000000000fffffdfdfbfbf9f908080808080862627f7f9191" }
];

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const destination of ["file", "stdout", "write"] as const) {
        it.each(cases)(`packs $coder $depth output (${mode}, ${destination})`, async ({ coder, depth, hex }) => {
            const files = new Map<string, Uint8Array>([["/in.pam", input], ["/out", Buffer.from("KEEP")]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const target = `${coder}:${destination === "stdout" ? "-" : "/out"}`;
            const args = ["/in.pam", "-depth", String(depth), ...(depth !== 16 && destination !== "write" ? ["-endian", destination === "file" ? "MSB" : "LSB"] : []), ...(destination === "write" ? ["-write", target, "null:"] : [target])];
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect((mode === "command" ? (await fs.readdir("/")).map(entry => entry.name) : [...files.keys()].map(path => path.slice(1))).sort()).toEqual(["in.pam", "out"]);
            const output = destination === "stdout"
                ? mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array()
                : mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(hex);
            if (destination === "stdout") expect(new TextDecoder().decode(mode === "command" ? await fs.readFile("/out") : files.get("/out"))).toBe("KEEP");
        });
    }
}

for (const mode of ["sync", "retained"] as const) {
    it.each(cases.filter(test => test.depth !== 16).flatMap(test => [false, true].map(adjoin => ({ ...test, adjoin }))))(`preserves filenames and frame order (${mode}, $coder $depth, adjoin=$adjoin)`, async ({ coder, depth, hex, adjoin }) => {
        const files = new Map<string, Uint8Array>([["/in.pam", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.pam", input);
        const args = ["/in.pam", "(", "/in.pam", "-flip", ")", "-depth", String(depth), `${coder}:${adjoin ? "/out.raw" : "/out-%d.raw"}`];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const flipped = hex.slice(hex.length / 2) + hex.slice(0, hex.length / 2);
        const outputs = adjoin ? [["/out.raw", hex + flipped]] : [["/out-0.raw", hex], ["/out-1.raw", flipped]];
        expect(mode === "sync" ? [...files.keys()].sort() : (await fs.readdir("/")).map(entry => `/${entry.name}`).sort()).toEqual(["/in.pam", ...outputs.map(([path]) => path)].sort());
        for (const [path, expected] of outputs) {
            const output = mode === "sync" ? files.get(path!)! : await fs.readFile(path!);
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        }
    });

    it.each([10, 12])(`pads wide rows across storage reads (${mode}, %i bits)`, async depth => {
        const width = 4099;
        const ppm = Buffer.concat([Buffer.from(`P6\n${width} 2\n255\n`), Buffer.alloc(width * 3, 255), Buffer.alloc(width * 3)]);
        const files = new Map<string, Uint8Array>([["/in.ppm", ppm]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", ppm);
        for (const coder of ["rgb", "rgba", "gray"]) {
            const args = ["/in.ppm", "-depth", String(depth), `${coder}:/out`];
            const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            const channels = coder === "gray" ? 1 : coder === "rgb" ? 3 : 4;
            const rowBytes = Math.ceil(width * channels * depth / 8);
            const expected = Buffer.alloc(rowBytes * 2);
            expected.fill(255, 0, rowBytes);
            const padding = (8 - width * channels * depth % 8) % 8;
            expected[rowBytes - 1] = 255 << padding & 255;
            if (coder === "rgba") {
                // Opaque alpha remains white in the black second row.
                const pixel = Buffer.from(depth === 10 ? "00000003ff" : "000000000fff", "hex");
                for (let x = 0; x < width; x++) expected.set(pixel, rowBytes + x * pixel.length);
            }
            expect(mode === "sync" ? files.get("/out") : await fs.readFile("/out")).toEqual(new Uint8Array(expected));
        }
    });
}
