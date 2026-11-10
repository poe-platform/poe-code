import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("4080c0207020906020607040", "hex"),
]);

// ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA8 output.
const cases = [
    { name: "sRGB alpha unchanged", channel: "A", expected: "4080c0207020906020607040" },
    { name: "sRGB red with alpha unchanged", channel: "RA", expected: "6680c020ff20906000607040" },
    { name: "sRGB independent color ranges", channel: "RGB", expected: "66ffff20ff00666000aa0040" },
    { name: "sRGB shared color and alpha range", channel: undefined, expected: "3399ff008000b36600668033" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: auto-level uses $name`, async ({ channel, expected }) => {
        const files = new Map([["/in.pam", input], ["/out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/in.pam", "-colorspace", "sRGB", ...(channel ? ["-channel", channel] : []), "-auto-level", "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
