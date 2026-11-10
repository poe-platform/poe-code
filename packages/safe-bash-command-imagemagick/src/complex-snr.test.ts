import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// RGBA8 samples from ImageMagick 7.1.2-35 Q16-HDRI, real then imaginary.
for (const mode of ["command", "buffered", "sync", "retained"])
it.each([
    ["0x2", "0b121e18050e0010"],
    ["0x10", "0102040301020002"],
    ["2", "0b121e18050e0010"],
    ["16", "0102040301020002"],
    ["0", "76fffffa31ff00a9"],
    ["  +0X2", "0b121e18050e0010"],
    ["2e0", "0b121e18050e0010"],
    ["2suffix", "0b121e18050e0010"],
    ["0b10", "76fffffa31ff00a9"],
])(`${mode}: complex division parses SNR %s`, async (snr, expected) => {
    const fs = new MemoryFileSystem(), keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/out", keep]]);
    await fs.writeFile("/out", keep);
    const tokens = ["xc:#2070a031", "xc:#30906082", "xc:#60402060", "xc:#40108044",
        "-define", `complex:snr=${snr}`, "-complex", "Divide", "+append", "-depth", "8", "rgba:/out"];
    const args = createCommandArguments(tokens);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runConvertCliSync(tokens, files)
        : await runConvertCli(tokens, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
