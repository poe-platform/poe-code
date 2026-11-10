import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: extraction is masked, subsequent edits are not.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const rows of [1, 257])
for (const selection of ["write-mask", "region"])
for (const order of ["extraction", "clear-before", "clear-after"])
it(`${mode}: ${selection} ${order} on separated planes (${rows} rows)`, async () => {
    const files = new Map([["out", Buffer.from("KEEP")]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", files.get("out")!);
    const before = selection === "write-mask"
        ? ["(", "xc:black", "xc:white", "+append", "-write", "mpr:mm", "+delete", ")", "-write-mask", "mpr:mm"]
        : ["-region", `1x${rows}+0+0`];
    const clear = `+${selection}`;
    const after = order === "extraction" ? [clear]
        : order === "clear-before" ? [clear, "-negate"] : ["-negate", clear];
    const argv = ["-size", `1x${rows}`, "xc:#274d93af", "xc:#97683560", "+append", ...before,
        "-channel", "RGB", "-separate", "+channel", ...after, "+append", "-depth", "8", "gray:out"];
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
    expect(Buffer.from(output).toString("hex")).toBe((order === "extraction" ? "27974d979397" : "d868b2686c68").repeat(rows));
});
