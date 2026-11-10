import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { geometry: "2x3+50%+2", warning: true, expected: "0008101820283038404850586068707880889098a0a8b0b8c0c8d0d8e0e8" },
        { geometry: "2x3+50%+20%", warning: true, expected: "0008101820283038404850586068707880889098a0a8b0b8c0c8d0d8e0e8" },
        { geometry: "2x3+50+20", warning: true, expected: "0008101820283038404850586068707880889098a0a8b0b8c0c8d0d8e0e8" },
        { geometry: "2x3+2+1", warning: false, expected: "00082028c0c8e0e8" },
    ])(`preserves native chop offsets for $geometry (${mode})`, async ({ geometry, warning, expected }) => {
        // Native ImageMagick 7.1.2-35 Q16-HDRI reference pixels and warning presence.
        const input = Buffer.concat([Buffer.from("P5\n6 5\n255\n"), Buffer.from(Array.from({ length: 30 }, (_, i) => i * 8))]);
        const files = new Map([["/in.pgm", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const args = ["/in.pgm", "-chop", geometry, "-depth", "8", "gray:/out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
        const diagnostic = "stderr" in result ? result.stderr : stderr;
        if (warning) expect(diagnostic).toContain("geometry does not contain image");
        else expect(diagnostic).toBe("");
    });
}
