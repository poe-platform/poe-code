import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"])
for (const operation of ["copy", "roll"])
it.each([
    ["ordinary", [], []],
    ["above range", ["-evaluate", "multiply", "2"], ["-evaluate", "divide", "2"]],
    ["below range", ["-evaluate", "subtract", "2570"], ["-evaluate", "add", "2570"]]
])(`preserves %s samples through ${operation} (${mode})`, async (_name, before, after) => {
    const input = new Uint8Array([...new TextEncoder().encode("P6\n4 2\n255\n"), ...Array.from({ length: 24 }, (_, i) => i * 10)]);
    const files = new Map([["in.ppm", input], ["out", new TextEncoder().encode("KEEP")]]), fs = new MemoryFileSystem();
    for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
    const args = ["in.ppm", ...before, ...(operation === "copy" ? ["-copy", "2x1+0+0", "+2+1"] : ["-roll", "-5+3"]), ...after, "PNG32:out"];
    let stderr = "";
    const result = mode === "command"
        ? await createMagickCommand().execute({ command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } })
        : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
    const output = mode === "sync" || mode === "buffered" ? files.get("out")! : await fs.readFile("/out");
    expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe(operation === "copy"
        ? "000a14ff1e2832ff3c4650ff5a646eff78828cff96a0aaff000a14ff1e2832ff"
        : "96a0aaffb4bec8ffd2dce6ff78828cff1e2832ff3c4650ff5a646eff000a14ff");
});
