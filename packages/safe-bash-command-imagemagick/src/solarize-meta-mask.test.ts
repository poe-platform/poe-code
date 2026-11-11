import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes from the reported PPM fixture.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "region", mask: ["-region", "1x1+1+0"], reset: ["+region"], expected: "0aa5" },
        { name: "partial write mask", mask: ["-write-mask", "/in.ppm"], reset: ["+write-mask"], expected: "e485" },
        { name: "unmasked control", mask: [], reset: [], expected: "f5a5" },
    ])(`${mode}: solarizes Meta0 with $name`, async ({ mask, reset, expected }) => {
        const argv = ["/in.ppm", "-channel-fx", "red=>meta0", ...mask,
            "-channel", "Meta0", "-solarize", "0", ...reset,
            "-channel", "Meta0", "-separate", "-depth", "8", mode === "command" ? "gray:-" : "gray:/out"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([10, 20, 30, 90, 110, 130])]);
        await fs.writeFile("/in.ppm", input);
        files.set("/in.ppm", input);
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
