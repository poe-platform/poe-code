import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "default", options: [], fuzzy: false },
        { name: "direct", options: ["-fuzz", "5%"], fuzzy: true },
        { name: "option", options: ["-set", "option:fuzz", "5%"], fuzzy: true },
        { name: "quantum option", options: ["-set", "option:fuzz", "3276.75"], fuzzy: true },
        { name: "reset", options: ["-set", "option:fuzz", "5%", "+fuzz"], fuzzy: false },
        { name: "override", options: ["-fuzz", "5%", "-set", "option:fuzz", "0"], fuzzy: false },
    ])(`${mode}: $name applies fuzz to bounds, trim pixels and page offsets`, async ({ options, fuzzy }) => {
        const pixel = (x: number, y: number) => (x === 3 || x === 4) && (y === 2 || y === 3)
            ? [160, 30, 90] : x === 1 && y === 1 ? [249, 249, 249] : [255, 255, 255];
        const input = new Uint8Array([...new TextEncoder().encode("P6\n7 5\n255\n"),
            ...Array.from({ length: 35 }, (_, i) => pixel(i % 7, Math.floor(i / 7))).flat()]);
        const files = new Map([["/in.ppm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", ...options, "-format", "%@", "-write", "info:/bounds",
            "-trim", "-depth", "8", "-write", "rgb:/pixels", "-format", "%wx%h %g", "info:/geometry"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const outputs = await Promise.all(["/bounds", "/pixels", "/geometry"].map(path =>
            mode === "command" || mode === "retained" ? filesystem.readFile(path) : files.get(path)!));
        expect(new TextDecoder().decode(outputs[0])).toBe(fuzzy ? "2x2+3+2" : "4x3+1+1");
        expect(new TextDecoder().decode(outputs[2])).toBe(fuzzy ? "2x2 7x5+3+2" : "4x3 7x5+1+1");
        const [w, h, x, y] = fuzzy ? [2, 2, 3, 2] as const : [4, 3, 1, 1] as const;
        expect(outputs[1]).toEqual(new Uint8Array(Array.from({ length: w * h }, (_, i) =>
            pixel(x + i % w, y + Math.floor(i / w))).flat()));
    });
}
