import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 rejects these valid Radiance orientations before writing output.
for (const mode of ["sync", "buffered", "retained", "command", "stdin"] as const) {
    for (const resolution of ["-Y 2 -X 3", "+Y 2 -X 3", "+X 3 -Y 2", "-Y 2 +X 3"]) {
        it(`matches native acceptance for Radiance resolution ${resolution} (${mode})`, async () => {
            const header = new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n${resolution}\n`);
            const bytes = new Uint8Array([...header, 128, 0, 0, 129, 0, 128, 0, 128, 0, 0, 128, 130, 128, 128, 0, 127, 0, 128, 128, 127, 128, 0, 128, 127]);
            const keep = new TextEncoder().encode("KEEP");
            const files = new Map([["/in.hdr", bytes], ["/out.png", keep]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.hdr", bytes);
            await filesystem.writeFile("/out.png", keep);
            const args = [mode === "stdin" ? "hdr:-" : "/in.hdr", "PNG32:/out.png"];
            let result;
            if (mode === "command" || mode === "stdin") {
                let stderr = "";
                const stdout: Uint8Array[] = [];
                const status = await createMagickCommand().execute({
                    command: "magick", args, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal,
                    stdin: (async function* () { if (mode === "stdin") yield bytes; })(),
                    stdout: { async write(chunk) { stdout.push(chunk); } },
                    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
                });
                expect(stdout).toEqual([]);
                result = { ...status, stderr };
            } else result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            const output = ["retained", "command", "stdin"].includes(mode) ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
            if (resolution === "-Y 2 +X 3") {
                expect(result).toMatchObject({ exitCode: 0, stderr: "" });
                const image = decodeImage(output);
                expect([image.width, image.height]).toEqual([3, 2]);
                expect([...image.data]).toEqual([255, 0, 0, 255, 0, 128, 0, 255, 0, 0, 255, 255, 64, 64, 0, 255, 0, 64, 64, 255, 64, 0, 64, 255]);
            } else {
                expect(result).toMatchObject({ exitCode: 1 });
                expect(result.stderr).toContain("no pixels defined in cache");
                expect(output).toEqual(keep);
            }
            expect(["retained", "command", "stdin"].includes(mode) ? await filesystem.readFile("/in.hdr") : files.get("/in.hdr")).toEqual(bytes);
        });
    }
}
