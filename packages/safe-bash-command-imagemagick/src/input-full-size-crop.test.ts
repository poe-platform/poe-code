import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: same-size filename crops ignore offsets.
const palette = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAIAAACUgoPjAAAADklEQVR4nGP4z8DAAMYADvsC/gkcFjQAAAAASUVORK5CYII=", "base64");
const blue = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC", "base64");
const pixels = [65535, 0, 0, 65535, 0, 65535, 0, 65535, 0, 0, 65535, 65535];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { args: ["pal.png[3x1+2+0]"], width: 3, x: 0, samples: pixels },
        { args: ["pal.png[3x1+4+4]"], width: 3, x: 0, samples: pixels },
        { args: ["pal.png[1x1+2+0]"], width: 1, x: 2, samples: pixels.slice(8) },
        { args: ["pal.png", "-crop", "3x1+2+0"], width: 1, x: 2, samples: pixels.slice(8) },
        { args: ["pal.png", "+dither", "-remap", "one.png[1x1+4+4]"], width: 3, x: 0, samples: Array(3).fill(pixels.slice(8)).flat() }
    ])(`${mode}: preserves pixels and page for $args`, async ({ args, width, x, samples }) => {
        const files = new Map<string, Uint8Array>([["pal.png", palette], ["one.png", blue]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        const argv = [...args, "PNG64:out.png"];
        const commandArgs = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: commandArgs.args, argumentValues: commandArgs, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([width, 1]);
        expect(output.virtualCanvas ?? { width: output.width, height: output.height, x: 0, y: 0 }).toEqual({ width: 3, height: 1, x, y: 0 });
        expect(Array.from(output.data16!)).toEqual(samples);
    });
}
