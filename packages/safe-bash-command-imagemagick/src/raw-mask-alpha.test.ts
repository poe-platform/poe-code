import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI: only editable pixels acquire zero alpha.
for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        [["-region", "2x1+1+0"], "rgba", "f00a21ff34cc53002053ea00fbcd20ff"],
        [["-write-mask", "/mask.pgm"], "rgba", "f00a210034cc53ff2053ea00fbcd20ff"],
        [["-region", "2x1+1+0"], "rgb", "f00a2134cc532053eafbcd20"],
        [["-read-mask", "/mask.pgm"], "rgba", "f00a21ff34cc53ff2053eafffbcd20ff"],
        [["-region", "2x1+1+0", "+region"], "rgba", "f00a21ff34cc53ff2053eafffbcd20ff"],
    ] as [string[], string, string][])(`${mode}: %j %s`, async (options, coder, expected) => {
        const files = new Map<string, Uint8Array>([
            ["/a.ppm", Buffer.from("UDYKNCAxCjI1NQrwCiE0zFMgU+r7zSA=", "base64")],
            ["/mask.pgm", Buffer.from("UDUKNCAxCjI1NQoA/wD/", "base64")],
            ["/out", Buffer.from("KEEP")],
        ]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["/a.ppm", ...options, "-depth", "8", `${coder}:/out`];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(Buffer.from(mode === "command" ? await fs.readFile("/out") : files.get("/out")!).toString("hex")).toBe(expected);
    });
}
