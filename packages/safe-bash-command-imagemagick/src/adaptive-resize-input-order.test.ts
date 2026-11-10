import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI results for the 5x4 PPM reproduction.
for (const mode of ["public", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "rejects resize before input", operands: ["-adaptive-resize", "4x3!", "/im.ppm"], exitCode: 1, length: 4, hash: "1dd17190a2f261044d8e04d099db4ebe2754ff402e5c2b8b759498176ddd343a" },
        { name: "rejects resize before a missing input", operands: ["-adaptive-resize", "4x3!", "/missing.ppm"], exitCode: 1, length: 4, hash: "1dd17190a2f261044d8e04d099db4ebe2754ff402e5c2b8b759498176ddd343a" },
        { name: "resizes an existing input", operands: ["/im.ppm", "-adaptive-resize", "4x3!"], exitCode: 0, length: 36, hash: "dd50a492c698a2b9519d14ac38de901ab9376ce35694d7458b78552924395086" },
        { name: "preserves an input already at the requested size", operands: ["/im.ppm", "-adaptive-resize", "5x4!"], exitCode: 0, length: 60, hash: "c9a65f38f3665df178b32e7ef826b9f2be4fea37c0ee7db1c09ef89b9f91427b" },
    ])(`$name (${mode})`, async ({ operands, exitCode, length, hash }) => {
        const input = Uint8Array.from([
            ...new TextEncoder().encode("P6\n5 4\n255\n"),
            ...Array.from({ length: 60 }, (_, i) => (i * 53 + 11) % 256),
        ]);
        const files = new Map([["/im.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argumentValues = createCommandArguments([...operands, "-depth", "8", "rgb:/out"]);
        let stdout = "", stderr = "";
        const result = mode === "public" ? { ...await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(argumentValues.args, files)
            : await runMagickCli(argumentValues.args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(exitCode);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(exitCode ? "magick: no images found for operation '-adaptive-resize'\n" : "");
        const output = mode === "public" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(output).toHaveLength(length);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
