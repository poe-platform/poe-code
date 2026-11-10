import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from("ff000000ff000000ffffee00991177245384", "hex")]);
// Native ImageMagick 7.1.2-35 Q16-HDRI outputs, including the literal and no-op controls.
const cases = [
    { name: "FX", options: ["-resample", "%[fx:144]"], size: "6x4", density: "72", length: 72 },
    { name: "option", options: ["-set", "option:target", "144", "-resample", "%[option:target]"], size: "6x4", density: "72", length: 72 },
    { name: "FX division", options: ["-resample", "%[fx:288/2]"], size: "6x4", density: "72", length: 72 },
    { name: "literal", options: ["-resample", "144"], size: "6x4", density: "72", length: 72 },
    { name: "no resampling", options: [], size: "3x2", density: "72", length: 18 },
];

for (const mode of ["command", "sync", "buffered", "retained"]) {
    for (const output of ["rgb", "info"]) {
        it.each(cases)(`${mode}: resamples $name to native ${output} output`, async ({ options, size, density, length }) => {
            const files = new Map([["/im.ppm", input], ["/out", Buffer.from("KEEP")]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const args = ["/im.ppm", "-density", "72", "-filter", "point", ...options,
                ...(output === "rgb" ? ["-depth", "8", "rgb:/out"] : ["-format", "%wx%h,%Wx%H%X%Y,%x,%y,%U", "info:/out"])];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const bytes = mode === "sync" || mode === "buffered" ? files.get("/out")! : await fs.readFile("/out");
            if (output === "info") {
                expect(new TextDecoder().decode(bytes)).toBe(`${size},${size}+0+0,${density},${density},Undefined`);
            } else {
                expect(bytes.length).toBe(length);
                expect(createHash("sha256").update(bytes).digest("hex")).toBe(length === 72
                    ? "d1ebfc840746c703e5a65cd3dcf470be292962aa8749d7395640e34c19af2298"
                    : "6506f1e2b70ee28fae8fbae9489470c1ab444d3f9bd3182f235a0c2851188895");
            }
        });
    }
}

it.each(["sync", "buffered", "retained"])("expands resampling FX against each current image (%s)", async mode => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const args = ["-size", "3x2", "xc:red", "-size", "6x4", "xc:blue", "-density", "72", "-filter", "point",
        "-resample", "%[fx:w*24]x%[fx:h*36]", "-format", "%wx%h;", "info:"];
    const result = mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "", stdout: "3x2;12x8;" });
});
