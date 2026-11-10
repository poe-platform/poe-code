import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 rejects tabs/newlines and preserves the destination.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const operation of ["-clone", "-delete"])
it.each([
    { spec: "1\t2", valid: false },
    { spec: "1\n2", valid: false },
    { spec: "1\t-\n2", valid: false },
    { spec: "1 2", valid: true },
    { spec: "1,2", valid: true },
])(`${mode}: ${operation} validates separator in $spec before replacing output`, async ({ spec, valid }) => {
    const keep = new TextEncoder().encode("KEEP");
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", keep);
    const files = new Map([["/out", keep]]);
    const args = ["xc:red", "xc:lime", "xc:blue", "xc:white", operation, spec, "+append", "-depth", "8", "rgb:/out"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(result.exitCode, String("stderr" in result ? result.stderr : stderr)).toBe(valid ? 0 : 1);
    expect(Buffer.from(output).toString("hex")).toBe(valid
        ? operation === "-clone" ? "ff000000ff000000ffffffff00ff000000ff" : "ff0000ffffff"
        : Buffer.from(keep).toString("hex"));
});
