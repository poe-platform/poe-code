import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("ff0000ff00ff00800000ff40fdfbf9bf080808ff627f9113", "hex")
]);
// ImageMagick 7.1.2-35 Q16-HDRI: in.pam -depth N CODER:out.
const cases = [
    { coder: "rgb", depth: 1, expected: "8880e080" },
    { coder: "rgb", depth: 2, expected: "c0c0c0fc0580" },
    { coder: "rgb", depth: 4, expected: "f000f000f0fff0006790" },
    { coder: "rgba", depth: 4, expected: "f00f0f0800f4fffb000f6791" },
    { coder: "gray", depth: 1, expected: "4080" },
    { coder: "gray", depth: 4, expected: "3b10f070" },
    { coder: "rgb", depth: 8, expected: "ff000000ff000000fffdfbf9080808627f91" }
];

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const destination of ["file", "stdout", "write"] as const) {
        it.each(cases)(`${mode} ${destination}: packs $coder depth $depth at row boundaries`, async ({ coder, depth, expected }) => {
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map<string, Uint8Array>([["/in.pam", input], ["/out", keep]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const target = `${coder}:${destination === "stdout" ? "-" : "/out"}`;
            const args = ["/in.pam", "-depth", String(depth), ...(destination === "write" ? ["-write", target, "null:"] : [target])];
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = destination === "stdout"
                ? mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array()
                : mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
            expect(mode === "command" ? (await fs.readdir("/")).map(entry => entry.name).sort() : [...files.keys()].map(path => path.slice(1)).sort()).toEqual(["in.pam", "out"]);
            if (destination === "stdout") expect(mode === "command" ? await fs.readFile("/out") : files.get("/out")).toEqual(keep);
        });
    }
}

for (const mode of ["sync", "retained"] as const) {
    it.each([1, 2, 4])(`${mode}: pads wide packed rows after bounded storage reads (depth %i)`, async depth => {
        const width = 4099, height = 2;
        const pam = Buffer.concat([
            Buffer.from(`P6\n${width} ${height}\n255\n`),
            Buffer.alloc(width * 3, 255), Buffer.alloc(width * 3)
        ]);
        const files = new Map<string, Uint8Array>([["/in.ppm", pam]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", pam);
        const args = ["/in.ppm", "-depth", String(depth), "rgb:/out"];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const rowBytes = Math.ceil(width * 3 * depth / 8);
        const expected = Buffer.alloc(rowBytes * height);
        expected.fill(255, 0, rowBytes - 1);
        expected[rowBytes - 1] = (255 << (8 - width * 3 * depth % 8)) & 255;
        expect(mode === "sync" ? files.get("/out") : await fs.readFile("/out")).toEqual(new Uint8Array(expected));
    });

    it(`${mode}: preserves scene filenames and frame order for packed output`, async () => {
        const files = new Map<string, Uint8Array>([["/in.pam", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.pam", input);
        const args = ["/in.pam", "(", "/in.pam", "-flip", ")", "-depth", "4", "rgb:/out-%d.raw"];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(mode === "sync" ? [...files.keys()].sort() : (await fs.readdir("/")).map(entry => `/${entry.name}`).sort()).toEqual(["/in.pam", "/out-0.raw", "/out-1.raw"]);
        for (const [index, expected] of ["f000f000f0fff0006790", "fff0006790f000f000f0"].entries()) {
            const output = mode === "sync" ? files.get(`/out-${index}.raw`)! : await fs.readFile(`/out-${index}.raw`);
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        }
    });
}
