import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runCompositeCli, runCompositeCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI output for the same PPM inputs.
const cases = [
    { settings: [], hex: "0a141e28323c46505a" },
    { settings: ["-quality", "90"], hex: "0a141e28323c46505a" },
    { settings: ["-depth", "8"], hex: "0a141e28323c46505a" },
    { settings: ["-depth", "16"], hex: "0a0a14141e1e282832323c3c464650505a5a" },
    { settings: ["-colorspace", "Gray"], hex: "1313133131314f4f4f" },
    { settings: ["-interlace", "plane"], hex: "0a28461432501e3c5a" },
    { settings: ["-endian", "MSB"], hex: "0a141e28323c46505a" },
];

for (const route of ["command", "buffered", "sync"])
for (const placement of ["before", "after"])
for (const { settings, hex } of cases)
it(`${route}: composite ${settings.join(" ") || "defaults"} ${placement} inputs`, async () => {
    const files = new Map([
        ["/left.ppm", Buffer.from("P3\n3 1\n255\n10 20 30  40 50 60  70 80 90\n")],
        ["/right.ppm", Buffer.from("P3\n3 1\n255\n101 111 121  131 141 151  161 171 181\n")],
        ["/out.raw", Buffer.from("KEEP")],
    ]);
    const inputs = ["/left.ppm", "/right.ppm"];
    const args = [...(placement === "before" ? [...settings, ...inputs] : [...inputs, ...settings]), "rgb:/out.raw"];
    if (route === "command") {
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        let stdout = "", stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(["composite", ...args]).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        });
        expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        expect(Buffer.from(await fs.readFile("/out.raw")).toString("hex")).toBe(hex);
    } else {
        const result = route === "sync" ? runCompositeCliSync(args, files) : await runCompositeCli(args, files);
        expect({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        expect(Buffer.from(files.get("/out.raw")!).toString("hex")).toBe(hex);
    }
});
