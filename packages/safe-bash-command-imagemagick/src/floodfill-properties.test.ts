import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: two connected gray pixels, red, isolated gray.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAE0lEQVR4nGNw8Ej4D8L/GRjANAA91Qe0ftVsfAAAAABJRU5ErkJggg==", "base64");
const pixels = [64, 72, 96, 255, 64, 72, 96, 255, 255, 0, 0, 255, 64, 72, 96, 255];

for (const mode of ["command", "retained", "buffered", "sync", "mogrify"] as const) {
    it.each([
        { seed: "+%[fx:w-1]+0", target: "#404860", painted: [3] },
        { seed: "+3+0", target: "#404860", painted: [3] },
        { seed: "+0+0", target: "%[pixel:p{0,0}]", painted: [0, 1] },
        { seed: "+0+0", target: "%[pixel:p{2,0}]", painted: [] },
        { seed: "%[option:seed]", target: "%[target]", painted: [3] },
        { seed: "+%[fx:w-1]+0", target: "%[pixel:p{0,0}]", painted: [3] },
        { seed: "+0+0", target: "%[bad-target]", painted: [] },
        { seed: "%[bad-seed]", target: "red", painted: undefined },
        { seed: "+0+0", target: "%[pixel:p{2,0}]", painted: [0, 1], option: "+floodfill" }
    ])(`${mode} expands floodfill seed $seed and target $target`, async ({ seed, target, painted, option = "-floodfill" }) => {
        const keep = Buffer.from("KEEP");
        const files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", keep]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const options = ["-set", "option:seed", "+3+0", "-set", "target", "#404860", "-set", "bad-target", "invalid-color", "-set", "bad-seed", "invalid-geometry", "-fill", "lime", option, seed, target];
        const argv = mode === "mogrify" ? [...options, "/in.png"] : ["/in.png", ...options, "/out.png"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await (mode === "mogrify" ? runMogrifyCli : runConvertCli)(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(painted ? 0 : 1);
        if (target === "%[bad-target]") expect("stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toContain("unrecognized color `invalid-color'");
        const output = mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile(mode === "mogrify" ? "/in.png" : "/out.png");
        if (painted) expect([...decodeImage(output).data]).toEqual([0, 1, 2, 3].flatMap(i => painted.includes(i) ? [0, 255, 0, 255] : pixels.slice(i * 4, i * 4 + 4)));
        else expect([...output]).toEqual([...(mode === "mogrify" ? input : keep)]);
    });
}

for (const mode of ["retained", "buffered", "sync"] as const) {
    it(`${mode} expands floodfill arguments separately for each image`, async () => {
        const files = new Map<string, Uint8Array>([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["/in.png", "-size", "2x1", "xc:red", "-fill", "lime", "-floodfill", "+%[fx:w-1]+0", "%[pixel:p{0,0}]", "+append", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual([...pixels.slice(0, 12), ...[0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255]]);
    });
}
