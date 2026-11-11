import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete -depth 8 rgba:- output.
const cases = [
    { name: "identity", selection: ["-channel", "R"], rgba: "0a141e405a6e82c0" },
    { name: "alpha", selection: ["-channel", "A"], rgba: "0a141e6b5a6e8295" },
    { name: "red", selection: ["-channel", "R"], rgba: "3a141e404f6e82c0" },
    { name: "RGB", selection: ["-channel", "RGB"], rgba: "3a4a5a404f6174c0" },
    { name: "RGBA", selection: ["-channel", "RGBA"], rgba: "3a4a5a6b4f617495" },
    { name: "Default", selection: ["-channel", "Default"], rgba: "3a4a5a6b4f617495" },
    { name: "implicit default", selection: [], rgba: "3a4a5a6b4f617495" },
    { name: "reset selection", selection: ["-channel", "A", "+channel"], rgba: "3a4a5a6b4f617495" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each(cases)(`convolves only selected channels (${mode}, $name)`, async ({ name, selection, rgba }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const tokens = ["xc:#0a141e40", "xc:#5a6e82c0", "+append", ...selection,
        "-convolve", name === "identity" ? "0,0,0,0,1,0,0,0,0" : "0,0,0,1,1,1,0,0,0", "+channel", "-depth", "8", "rgba:/out"];
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
