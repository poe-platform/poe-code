import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const first = ["(", "-size", "2x1", "xc:#2060b080", ")"];
const second = ["(", "-size", "1x2", "xc:#c04020ed", ")"];

// Native ImageMagick 7.1.2-35 Q16-HDRI RGBA8 output, including unblended alpha.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { name: "vertical scoped East", args: [...first, ...second.slice(0, -1), "-gravity", "east", ")", "-append"], hex: "2060b0802060b080ffffffffc04020edffffffffc04020ed" },
    { name: "vertical global East", args: [...first, ...second, "-gravity", "east", "-append"], hex: "2060b0802060b080ffffffffc04020edffffffffc04020ed" },
    { name: "vertical default", args: [...first, ...second, "-append"], hex: "2060b0802060b080c04020edffffffffc04020edffffffff" },
    { name: "horizontal scoped South", args: [...first.slice(0, -1), "-gravity", "south", ")", ...second, "+append"], hex: "ffffffffffffffffc04020ed2060b0802060b080c04020ed" },
    { name: "global reset overrides scoped East", args: [...first, ...second.slice(0, -1), "-gravity", "east", ")", "+gravity", "-append"], hex: "2060b0802060b080c04020edffffffffc04020edffffffff" },
    { name: "global West overrides scoped East", args: [...first, ...second.slice(0, -1), "-gravity", "east", ")", "-gravity", "west", "-append"], hex: "2060b0802060b080c04020edffffffffc04020edffffffff" },
])(`${mode}: $name`, async ({ args, hex }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const previous = new TextEncoder().encode("KEEP");
    await fs.writeFile("/out", previous);
    files.set("/out", previous);
    const argv = ["-respect-parentheses", ...args, "-depth", "8", "rgba:/out"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString("hex")).toBe(hex);
});
