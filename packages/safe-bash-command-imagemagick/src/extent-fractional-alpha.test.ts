import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: composition retains fractional alpha until export.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const compose of [[], ["-compose", "Over"]]) {
        it.each([false, true])(`retains fractional extent alpha (${mode}, ${compose.join(" ") || "default"}, identity=%s)`, async identity => {
            const args = ["xc:#1ea6c490", "-background", "#bd355670",
                ...(identity ? ["-evaluate", "multiply", "1"] : []), ...compose, "-extent", "1x1",
                "-format", "%[fx:a]", "-write", "info:",
                "-channel", "A", "-evaluate", "subtract", "75%", "-evaluate", "multiply", "100", "+channel",
                "-depth", "16", "-endian", "MSB", "rgba:/out.rgba"];
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect("stdout" in result ? result.stdout : stdout).toBe("0.755894");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.rgba") : files.get("/out.rgba")!;
            expect(Buffer.from(output).toString("hex")).toBe("467d89f5a8d69697");
        });
    }
}
