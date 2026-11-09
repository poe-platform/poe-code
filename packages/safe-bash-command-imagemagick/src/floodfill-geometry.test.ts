import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { geometry: "+0+0", painted: [0, 3, 6] },
        { geometry: "-", painted: [0, 3, 6] },
        { geometry: "+0+0!", painted: [0, 3, 6] },
        { geometry: "+1e0+0", painted: [] },
        { geometry: "2x2+0+0", painted: [0, 3, 6] },
        { geometry: "2x2", painted: [0, 3, 6] },
        { geometry: "+1+0", painted: [] },
        { geometry: "2x2+1+0", painted: [] },
        { geometry: "2x2+2+0", painted: [2] },
        { geometry: "2x2+0+2", painted: [0, 3, 6] },
        { geometry: "2x2-1+0", painted: [] },
        { geometry: "2x2+3+0", painted: [] }
    ])(`${mode}: floodfill uses geometry offsets ($geometry)`, async ({ geometry, painted }) => {
        const pixels = [1, 0, 1, 1, 0, 0, 1, 0, 1].flatMap(white => [white * 255, white * 255, white * 255, 255]);
        const input = encodeImage({ width: 3, height: 3, data: Uint8Array.from(pixels),
            format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["in.png", "-fill", "red", "-floodfill", geometry, "white", "PNG32:out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].flatMap(i => painted.includes(i) ? [255, 0, 0, 255] : pixels.slice(i * 4, i * 4 + 4)));
    });
}

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["-floodfill", "+floodfill"]) {
        it.each(["oops", "+1garbage+0", "+0+0oops", "", "+", "1,2"])(`${mode}: rejects ${operation} %j without overwriting output`, async geometry => {
            const input = encodeImage({ width: 3, height: 1,
                data: Uint8Array.from([64, 72, 96, 255, 64, 72, 96, 255, 0, 0, 0, 255]),
                format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
            }, { format: "png" }).data;
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["in.png", input], ["out.png", keep]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            await fs.writeFile("/out.png", keep);
            const argv = ["in.png", "-fill", "lime", operation, geometry, "#404860", "out.png"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
            expect(output).toEqual(keep);
            expect(result.exitCode).toBe(1);
            expect("stderr" in result ? result.stderr : stderr).toContain(`invalid argument for option '${operation}'`);
        });
    }
}
