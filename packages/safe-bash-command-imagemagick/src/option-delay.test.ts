import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const option of [["-set", "option:delay", "7x50"], ["-delay", "7x50"]]) {
        it.each([
            { position: 0, delays: [140, 140] },
            { position: 1, delays: [0, 140] },
            { position: 2, delays: [0, 0] }
        ])(`applies ${option.join(" ")} only to following GIF frames in ${mode} at $position`, async ({ position, delays }) => {
            const args = ["xc:red", "xc:blue"];
            args.splice(position, 0, ...option);
            args.push(mode === "command" ? "gif:-" : "out.gif");
            const files = new Map<string, Uint8Array>();
            const filesystem = new MemoryFileSystem();
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect(stderr).toBe("");
            const bytes = mode === "command" ? Buffer.concat(chunks)
                : mode === "retained" ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
            const image = decodeImage(bytes, { animated: true });
            expect(image.pages).toBe(2);
            expect(image.delay).toEqual(delays);
        });
    }
}
