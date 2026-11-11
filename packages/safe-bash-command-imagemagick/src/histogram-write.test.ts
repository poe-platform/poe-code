import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "streamed"] as const) {
    it.each(["-write", "+write"])(`routes intermediate histogram destinations without changing source pixels (${mode}, %s)`, async write => {
        for (const destination of ["histogram:report.png", "histogram:info:", "histogram:info:report.txt", "histogram:png:-", "histogram:-"]) {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem(), chunks: Uint8Array[] = [];
            const input = mode === "buffered" || mode === "sync" ? files : {
                filesystem, cwd: "/", ...(mode === "streamed" ? { stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } } } : {})
            };
            const args = ["-size", "3x2", "xc:red", "-format", "%wx%h", "-depth", "8", write, destination, "-negate", "rgb:end.raw"];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, input);
            expect(result.exitCode, `${destination}: ${result.stderr}`).toBe(0);
            expect(result.stderr).toBe("");
            const read = async (path: string) => mode === "buffered" || mode === "sync" ? files.get(path)! : filesystem.readFile(`/${path}`);
            expect([...await read("end.raw")]).toEqual(Array.from({ length: 6 }, () => [0, 255, 255]).flat());
            if (destination === "histogram:report.png" || destination === "histogram:png:-" || destination === "histogram:-") {
                const bytes = destination === "histogram:report.png" ? await read("report.png") : mode === "streamed" ? Buffer.concat(chunks) : result.stdoutBytes!;
                expect(bytes).toBeDefined();
                const image = decodeImage(bytes);
                expect([image.width, image.height]).toEqual([256, 200]);
                expect([...image.data.slice(0, 4)]).toEqual([0, 255, 255, 255]);
                expect([...image.data.slice(255 * 4, 256 * 4)]).toEqual([255, 0, 0, 255]);
            } else if (destination === "histogram:info:report.txt") {
                expect(new TextDecoder().decode(await read("report.txt"))).toBe("256x200");
            } else {
                expect(mode === "streamed" ? new TextDecoder().decode(Buffer.concat(chunks)) : result.stdout).toBe("256x200");
            }
            const names = mode === "buffered" || mode === "sync" ? [...files.keys()] : (await filesystem.readdir("/")).map(entry => entry.name);
            expect(names.sort()).toEqual(destination === "histogram:report.png" ? ["end.raw", "report.png"] : destination === "histogram:info:report.txt" ? ["end.raw", "report.txt"] : ["end.raw"]);
        }
    });

    it(`captures histogram settings and writes every image without replacing the stack (${mode})`, async () => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem(), chunks: Uint8Array[] = [];
        const input = mode === "buffered" || mode === "sync" ? files : {
            filesystem, cwd: "/", ...(mode === "streamed" ? { stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } } } : {})
        };
        const args = ["-size", "3x2", "xc:red", "xc:blue", "-format", "%wx%h;", "-write", "histogram:info:",
            "-format", "%c", "+write", "histogram:info:counts.txt", "-format", "%wx%h;", "info:"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, input);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(mode === "streamed" ? new TextDecoder().decode(Buffer.concat(chunks)) : result.stdout).toBe("256x200;256x200;3x2;3x2;");
        const counts = new TextDecoder().decode(mode === "buffered" || mode === "sync" ? files.get("counts.txt") : await filesystem.readFile("/counts.txt"));
        expect(counts.split("\n").map(line => line.trimStart())).toEqual(["6: (65535,0,0) #FFFF00000000 red", "6: (0,0,65535) #00000000FFFF blue", ""]);
    });

}
