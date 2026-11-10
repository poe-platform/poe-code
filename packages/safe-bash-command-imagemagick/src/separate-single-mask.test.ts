import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick Q16-HDRI: masks clip the gray plane only when red is selected.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const evaluate of [false, true])
for (const mask of ["region", "write", "none"])
it.each([
    { channel: "R", hex: "2797" },
    { channel: "G", hex: "4d68" },
    { channel: "B", hex: "9335" },
    { channel: "A", hex: "af60" },
    { channel: "BA", hex: "9335af60" },
    { channel: "RA", hex: mask === "none" ? "2797af60" : "2797af97" },
    { channel: "RGB", hex: mask === "none" ? "27974d689335" : "27974d979397" },
])(`${mode}: separates $channel under ${mask} mask, evaluate=${evaluate}`, async ({ channel, hex }) => {
    const before = mask === "region" ? ["-region", "1x1+0+0"] : mask === "write"
        ? ["(", "xc:black", "xc:white", "+append", "-write", "mpr:mm", "+delete", ")", "-write-mask", "mpr:mm"] : [];
    const after = mask === "region" ? ["+region"] : mask === "write" ? ["+write-mask"] : [];
    const argv = ["xc:#274d93af", "xc:#97683560", "+append", ...(evaluate ? ["-evaluate", "Add", "0"] : []),
        ...before, "-channel", channel, "-separate", "+channel", ...after, "+append", "-depth", "8", "gray:out"];
    const files = new Map([["out", Buffer.from("KEEP")]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", Buffer.from("KEEP"));
    const args = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
    expect(Buffer.from(output).toString("hex")).toBe(hex);
});
