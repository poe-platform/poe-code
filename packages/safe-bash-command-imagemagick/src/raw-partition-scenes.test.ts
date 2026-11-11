import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.from("010203040506111213141516212223242526", "hex");
// ImageMagick 7.1.2-35 Q16-HDRI: each later partition repeats the scene suffix.
const cases = [
    { name: "numbered partitions", frames: 3, options: [], target: "/out-%02d.bin", interlace: "Partition", outputs: {
        "/out-07.R": "0104", "/out-07-7.G": "0205", "/out-07-7-7.B": "0306",
        "/out-08.R": "1114", "/out-08-8.G": "1215", "/out-08-8-8.B": "1316",
        "/out-09.R": "2124", "/out-09-9.G": "2225", "/out-09-9-9.B": "2326"
    } },
    { name: "unadjoined partitions", frames: 3, options: ["+adjoin"], target: "/out.bin", interlace: "Partition", outputs: {
        "/out-7.R": "0104", "/out-7-7.G": "0205", "/out-7-7-7.B": "0306",
        "/out-8.R": "1114", "/out-8-8.G": "1215", "/out-8-8-8.B": "1316",
        "/out-9.R": "2124", "/out-9-9.G": "2225", "/out-9-9-9.B": "2326"
    } },
    { name: "adjoined partitions", frames: 3, options: [], target: "/out.bin", interlace: "Partition", outputs: {
        "/out.R": "010411142124", "/out.G": "020512152225", "/out.B": "030613162326"
    } },
    { name: "numbered packed output", frames: 3, options: [], target: "/out-%02d.bin", interlace: "None", outputs: {
        "/out-07.bin": "010203040506", "/out-08.bin": "111213141516", "/out-09.bin": "212223242526"
    } },
    { name: "single numbered partition", frames: 1, options: [], target: "/out-%02d.bin", interlace: "Partition", outputs: {
        "/out-07.R": "0104", "/out-07.G": "0205", "/out-07.B": "0306"
    } }
];

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const destination of ["final", "-write", "+write"] as const) {
        it.each(cases)(`${mode} ${destination} preserves native paths and bytes for $name`, async fixture => {
            const files = new Map<string, Uint8Array>([["/in.bin", input.subarray(0, fixture.frames * 6)]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const target = `rgb:${fixture.target}`;
            const args = ["-size", "2x1", "-depth", "8", "rgb:/in.bin", "-scene", "7", "-interlace", fixture.interlace,
                ...fixture.options, ...(destination === "final" ? [target] : [destination, target, "null:"])];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const paths = mode === "command" ? (await fs.readdir("/")).map(entry => `/${entry.name}`) : [...files.keys()];
            expect(paths.filter(path => path !== "/in.bin").sort()).toEqual(Object.keys(fixture.outputs).sort());
            for (const [path, hex] of Object.entries(fixture.outputs)) {
                const bytes = mode === "command" ? await fs.readFile(path) : files.get(path)!;
                expect(Buffer.from(bytes).toString("hex"), path).toBe(hex);
            }
        });
    }
}
