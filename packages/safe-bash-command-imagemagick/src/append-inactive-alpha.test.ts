import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI treats inactive source alpha as opaque.
for (const mode of ["command", "buffered", "sync"])
for (const direction of ["-append", "+append"])
for (const alpha of ["first off", "second off", "active", "first set"])
for (const storage of ["byte", "ushort", "working"])
it(`${mode} ${direction}: ${alpha}, ${storage} samples`, async () => {
    const fs = new MemoryFileSystem();
    const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
    await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
    const argv = [
        "(", "-size", "2x3", storage === "ushort" ? "xc:#80804040c0c08080" : "xc:#8040c080",
        ...(alpha === "first off" ? ["-alpha", "off"] : alpha === "first set" ? ["-alpha", "set"] : []), ")",
        "(", "-size", "3x2", storage === "ushort" ? "xc:#3030909050504040" : "xc:#30905040",
        ...(alpha === "second off" ? ["-alpha", "off"] : []), ")",
        ...(storage === "working" ? ["-evaluate", "Divide", "1"] : []),
        direction, "-depth", "8", "rgba:/out"
    ];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const first = alpha === "first off" ? "8040c0ff" : "8040c080";
    const second = alpha === "second off" ? "309050ff" : "30905040";
    const expected = direction === "-append"
        ? (first.repeat(2) + "ffffffff").repeat(3) + second.repeat(6)
        : (first.repeat(2) + second.repeat(3)).repeat(2) + first.repeat(2) + "ffffffff".repeat(3);
    expect(Buffer.from(mode === "command" ? await fs.readFile("/out") : files.get("/out")!).toString("hex")).toBe(expected);
});
