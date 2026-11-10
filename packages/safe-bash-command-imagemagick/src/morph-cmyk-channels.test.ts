import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["map", "sync", "filesystem", "command"])
it.each([
    ["C", "00ab4f2e5f006176be006176"],
    ["RGB", "00ab4f2e5f555876be006176"],
    ["A", "00ab4f2ebe006176be006176"],
    ["K", "00ab4f2ebe006152be006176"],
    ["CMYK", "00ab4f2e5f555852be006176"],
    [undefined, "00ab4f2e5f555852be006176"]
])(`honors CMYK morph channel selection %s (${mode})`, async (channels, hex) => {
    // Native ImageMagick 7.1.2-35 Q16-HDRI: both endpoints and the midpoint.
    const args = ["xc:#d14590", "xc:#238955", "-colorspace", "CMYK",
        ...(channels ? ["-channel", channels] : []), "-morph", "1", "+channel", "+append", "-depth", "8", "cmyk:/out"];
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    let stderr = "";
    const argumentValues = createCommandArguments(args);
    const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: argumentValues.args, argumentValues,
        fs, cwd: "/", env: {}, signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } })
        : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    expect(stderr).toBe("");
    const output = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(Buffer.from(output).toString("hex")).toBe(hex);
});
