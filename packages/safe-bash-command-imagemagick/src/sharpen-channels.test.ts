import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete -depth 8 rgba:- output.
const cases = [
    { name: "alpha", selection: ["-channel", "A"], rgba: "5040606fa08090d1" },
    { name: "red", selection: ["-channel", "R"], rgba: "2c406080ad8090c0" },
    { name: "RGB", selection: ["-channel", "RGB"], rgba: "2c234b80ad8a98c0" },
    { name: "RGBA", selection: ["-channel", "RGBA"], rgba: "2c234b6fad8a98d1" },
    { name: "Default", selection: ["-channel", "Default"], rgba: "2c234b6fad8a98d1" },
    { name: "implicit default", selection: [], rgba: "2c234b6fad8a98d1" },
    { name: "reset selection", selection: ["-channel", "A", "+channel"], rgba: "2c234b6fad8a98d1" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each(cases)(`sharpens only selected channels (${mode}, $name)`, async ({ selection, rgba }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const tokens = ["xc:#50406080", "xc:#a08090c0", "+append", ...selection,
        "-sharpen", "0x1", "+channel", "-depth", "8", "rgba:/out"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(tokens).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
    }) : mode === "sync" ? runConvertCliSync(tokens, files)
        : await runConvertCli(tokens, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(rgba);
});
