import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "selected Meta0", selection: ["-channel", "Meta0"], color: "404040", adjust: true, expected: "5e" },
        { name: "default selection", selection: [], color: "404040", adjust: true, expected: "5e" },
        { name: "reset selection", selection: ["-channel", "R", "+channel"], color: "404040", adjust: true, expected: "5e" },
        { name: "red selection control", selection: ["-channel", "R"], color: "404040", adjust: true, expected: "40" },
        { name: "unadjusted control", selection: ["-channel", "Meta0"], color: "404040", adjust: false, expected: "40" },
        { name: "higher Meta0 sample", selection: ["-channel", "Meta0"], color: "606060", adjust: true, expected: "89" },
    ])(`${mode}: brightness-contrast: $name`, async ({ selection, color, adjust, expected }) => {
        const argv = ["xc:black", "-duplicate", "3", `xc:#${color}`, "-combine",
            ...selection, ...(adjust ? ["-brightness-contrast", "15x25"] : []), "+channel",
            "-channel", "Meta0", "-separate", "-depth", "8", mode === "command" ? "gray:-" : "gray:/out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const args = createCommandArguments(argv);
        let stderr = "", stdout = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: { MAGICK_THREAD_LIMIT: "1" }, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const hex = mode === "command" ? stdout : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
        expect(hex).toBe(expected);
    });
}
