import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const first = readFileSync(new URL("./fixtures/morph-properties-a.png", import.meta.url));
const second = readFileSync(new URL("./fixtures/morph-properties-b.png", import.meta.url));
// ImageMagick 7.1.2-35 Q16-HDRI: a.png b.png -morph '%[fx:w/2]' out.gif.
const reference = decodeImage(readFileSync(new URL("./fixtures/morph-properties.gif", import.meta.url)), { animated: true });

for (const mode of ["sync", "map", "filesystem", "command"] as const) {
    it.each([
        { name: "literal", args: ["/a.png", "/b.png", "-morph", "2"] },
        { name: "constant FX", args: ["/a.png", "/b.png", "-morph", "%[fx:1+1]"] },
        { name: "image width FX", args: ["/a.png", "/b.png", "-morph", "%[fx:w/2]"] },
        { name: "image property", args: ["/a.png", "-set", "mid", "2", "/b.png", "-morph", "%[mid]"] },
        { name: "option property", args: ["/a.png", "/b.png", "-set", "option:mid", "2", "-morph", "%[mid]"] },
        { name: "explicit option property", args: ["/a.png", "/b.png", "-set", "option:mid", "2", "-morph", "%[option:mid]"] },
        { name: "option captured at morph", args: ["/a.png", "/b.png", "-set", "option:mid", "2", "-morph", "%[mid]", "-set", "option:mid", "0"] }
    ])(`expands $name morph counts against the first image (${mode})`, async ({ args }) => {
        const files = new Map<string, Uint8Array>([["/a.png", first], ["/b.png", second]]), fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argumentValues = createCommandArguments([...args, "/out.gif"]);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argumentValues.args, files)
            : await runConvertCli(argumentValues.args, mode === "filesystem" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        const output = decodeImage(mode === "filesystem" || mode === "command" ? await fs.readFile("/out.gif") : files.get("/out.gif")!, { animated: true });
        expect([output.width, output.height, output.pages]).toEqual([reference.width, reference.height, 4]);
        expect(output.data).toEqual(reference.data);
    });
}

for (const mode of ["sync", "map", "filesystem"] as const) {
    it.each(["", "invalid", "Infinity"])(`rejects invalid expanded morph count %j without replacing output (${mode})`, async value => {
        const original = Uint8Array.of(1, 2, 3), files = new Map<string, Uint8Array>([["/a.png", first], ["/out.gif", original]]), fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["/a.png", "-set", "option:mid", value, "-morph", "%[mid]", "/out.gif"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "filesystem" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("invalid argument for option '-morph'");
        expect(mode === "filesystem" ? await fs.readFile("/out.gif") : files.get("/out.gif")).toEqual(original);
    });
}
