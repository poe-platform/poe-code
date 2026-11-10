import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Exact native ImageMagick 7.1.2-35 Q16-HDRI regression vectors.
for (const mode of ["command", "sync", "buffered", "retained"])
for (const depth of [8, 16, "evaluate"])
it.each([
    ["tile", "5a646eff"],
    ["background", "123456ff"],
    ["transparent", "00000000"],
    ["edge", "000a14ff"],
    ["mirror", "000a14ff"]
])(`copies the selected virtual pixel (%s, ${mode}, ${depth})`, async (method, pixel) => {
    const pixels = Array.from({ length: 24 }, (_, i) => i * 10);
    const input = new Uint8Array([...new TextEncoder().encode(`P6\n4 2\n${depth === 16 ? 65535 : 255}\n`), ...pixels.flatMap(value => depth === 16 ? [value, value] : [value])]);
    const files = new Map([["in.ppm", input], ["out", new TextEncoder().encode("KEEP")]]);
    const fs = new MemoryFileSystem();
    for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
    const args = ["in.ppm", ...(depth === "evaluate" ? ["-evaluate", "add", "0"] : []), "-background", "#123456", "-virtual-pixel", method, "-copy", "2x1-1+0", "+2+1", "PNG32:out"];
    let stderr = "";
    const result = mode === "command"
        ? await createMagickCommand().execute({ command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } })
        : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
    expect(stderr).toBe("");
    const output = mode === "sync" || mode === "buffered" ? files.get("out")! : await fs.readFile("/out");
    expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe(
        `000a14ff1e2832ff3c4650ff5a646eff78828cff96a0aaff${pixel}000a14ff`);
});
