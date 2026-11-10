import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, LC_ALL=C, MAGICK_THREAD_LIMIT=1.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([false, true])(`${mode}: requires images before sketch (loaded=%s)`, async loaded => {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/out.raw", keep]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out.raw", keep);
    const inputs = ["xc:#204060", "xc:#b06020", "+append"];
    const args = ["-seed", "42", ...(loaded ? inputs : []), "-sketch", "1x1+30",
        ...(loaded ? [] : inputs), "-depth", "8", "rgba:/out.raw"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    stderr = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
    const output = mode === "buffered" || mode === "sync" ? files.get("/out.raw")! : await fs.readFile("/out.raw");
    expect(result.exitCode, stderr).toBe(loaded ? 0 : 1);
    if (loaded) {
        expect(stderr).toBe("");
        expect(Buffer.from(output).toString("hex")).toBe("4a93ddffffff70ff");
    } else {
        expect(stderr).toContain("no images found for operation '-sketch'");
        expect(output).toEqual(keep);
    }
});
