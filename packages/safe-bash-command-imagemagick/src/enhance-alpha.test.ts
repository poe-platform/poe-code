import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes after reactivating alpha.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { alpha: "discrete", enhance: true, expected: "34567881" },
        { alpha: "deactivate", enhance: true, expected: "34567881" },
        { alpha: "disassociate", enhance: true, expected: "68abef00" },
        { alpha: "off", enhance: true, expected: "34567800" },
        { alpha: "activate", enhance: true, expected: "34567881" },
        { alpha: "activate", enhance: false, expected: "34567880" },
    ])(`${mode}: alpha $alpha with enhance=$enhance`, async ({ alpha, enhance, expected }) => {
        const args = ["xc:#34567880", "-alpha", alpha, ...(enhance ? ["-enhance"] : []),
            "-alpha", "activate", "-depth", "8", "rgba:/out"];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result) stderr = String(result.stderr);
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
