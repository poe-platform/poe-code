import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, big-endian 16-bit gray output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "Meta0 mean", selection: ["-channel", "Meta0"], method: "Mean", expected: "55ab8080ab55" },
        { name: "Default mean", selection: ["-channel", "Default"], method: "Mean", expected: "55ab8080ab55" },
        { name: "Meta0 maximum", selection: ["-channel", "Meta0"], method: "Maximum", expected: "8080c0c0c0c0" },
        { name: "red preserves Meta0", selection: ["-channel", "R"], method: "Mean", expected: "40408080c0c0" },
        { name: "no statistic preserves Meta0", selection: ["-channel", "Meta0"], method: "", expected: "40408080c0c0" },
        { name: "implicit default mean", selection: [], method: "Mean", expected: "55ab8080ab55" },
        { name: "reset channel mean", selection: ["-channel", "R", "+channel"], method: "Mean", expected: "55ab8080ab55" },
        { name: "absent Meta1 preserves Meta0", selection: ["-channel", "Meta1"], method: "Mean", expected: "40408080c0c0" },
    ])(`${mode}: $name`, async ({ selection, method, expected }) => {
        const argv = ["-size", "3x1", "xc:black", "-duplicate", "3", "(", "-size", "1x1",
            "xc:#404040", "xc:#808080", "xc:#c0c0c0", "+append", ")", "-combine", ...selection,
            ...(method ? ["-statistic", method, "3x1"] : []), "+channel", "-channel", "Meta0", "-separate", "+channel",
            "-depth", "16", "-endian", "MSB", mode === "command" ? "gray:-" : "gray:/out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv), stdout: Buffer[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
