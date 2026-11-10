import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick rejects zero width only when the rectangle has positive height.
for (const mode of ["command", "sync", "buffered", "retained"])
for (const format of ["PNG32", "info"])
it.each([
    ["0x1", "+1+0", 1, ""],
    ["0x2", "+0+0", 1, ""],
    ["x1", "+0+0", 1, ""],
    ["x0", "+0+0", 0, "000a14ff1e2832ff3c4650ff5a646eff78828cff96a0aaffb4bec8ffd2dce6ff"],
    ["2x0", "+1+0", 0, "000a14ff1e2832ff3c4650ff5a646eff78828cff96a0aaffb4bec8ffd2dce6ff"],
    ["1x1", "+1+0", 0, "000a14ff000a14ff3c4650ff5a646eff78828cff96a0aaffb4bec8ffd2dce6ff"]
])(`matches native copy rectangle %s (${mode}, ${format})`, async (geometry, offset, exitCode, pixels) => {
    const input = new Uint8Array([...new TextEncoder().encode("P6\n4 2\n255\n"), ...Array.from({ length: 24 }, (_, i) => i * 10)]);
    const files = new Map([["in.ppm", input], ["out", new TextEncoder().encode("KEEP")]]);
    const fs = new MemoryFileSystem();
    for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
    const args = ["in.ppm", "-copy", geometry, offset, "-format", "%w %h", `${format}:out`];
    let stderr = "";
    const result = mode === "command"
        ? await createMagickCommand().execute({ command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } })
        : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(exitCode);
    const output = mode === "sync" || mode === "buffered" ? files.get("out")! : await fs.readFile("/out");
    if (exitCode !== 0) expect(new TextDecoder().decode(output)).toBe("KEEP");
    else if (format === "info") expect(new TextDecoder().decode(output)).toBe("4 2");
    else expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe(pixels);
});
