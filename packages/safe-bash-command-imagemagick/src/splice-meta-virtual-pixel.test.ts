import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: source rows, exposed row, inserted band.
for (const mode of ["command", "retained", "buffered", "sync"] as const) it.each([
    { method: "white", channel: "Meta0", hex: "40c00000" },
    { method: "gray", channel: "Meta0", hex: "40c00000" },
    { method: "edge", channel: "Meta0", hex: "40c0c000" },
    { method: "white", channel: "R", hex: "5050ffff" },
    { method: "gray", channel: "R", hex: "505080ff" },
])(`${mode}: splice preserves $channel with $method virtual pixels`, async ({ method, channel, hex }) => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const argv = ["-size", "1x2", "xc:#505050", "-duplicate", "3", "gradient:#404040-#c0c0c0", "-combine",
        "-virtual-pixel", method, "-splice", "0x2+0+3", "-channel", channel, "-separate", "+channel", "-depth", "8", "gray:/out"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(hex);
});
