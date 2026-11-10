import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["minimum", ["-define", "trim:minSize=6x4", "+set", "option:trim:minSize"], 1, "3x1+2+2;"],
        ["later input", ["-define", "trim:minSize=6x4", "+set", "option:trim:minSize", "/in.ppm"], 2, "3x1+2+2;"],
        ["edges", ["-define", "trim:edges=north,west", "+set", "option:trim:edges"], 1, "3x1+2+2;"],
        ["background", ["-define", "trim:percent-background=95", "-define", "trim:background-color=white", "+set", "option:trim:background-color"], 1, "3x1+2+2;"],
        ["percentage", ["-define", "trim:percent-background=95", "+set", "option:trim:percent-background"], 1, "3x1+2+2;"],
        ["set option", ["-set", "option:trim:minSize", "6x4", "+set", "option:trim:minSize"], 1, "3x1+2+2;"],
        ["define reset control", ["-define", "trim:minSize=6x4", "+define", "trim:minSize"], 1, "3x1+2+2;"],
        ["active option control", ["-define", "trim:minSize=6x4"], 1, "6x4+1+1;"],
        ["image property control", ["-define", "trim:minSize=6x4", "+set", "trim:minSize"], 1, "6x4+1+1;"],
    ] as const)(`clears trim options: %s (${mode})`, async (_name, settings, count, geometry) => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n7 5\n255\n"),
            ...Array.from({ length: 35 }, (_, i) => Array(3).fill(i >= 16 && i <= 18 ? 255 : 0)).flat()]);
        const files = new Map([["/in.ppm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", ...settings, "-trim", "-depth", "8", "-write", "gray:/pixels", "-format", "%wx%h%X%Y;", "info:/geometry"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/geometry") : files.get("/geometry")!;
        const pixels = mode === "command" || mode === "retained" ? await filesystem.readFile("/pixels") : files.get("/pixels")!;
        expect(new TextDecoder().decode(output)).toBe(geometry.repeat(count));
        const expected = geometry.startsWith("3x1") ? [255, 255, 255] : Array.from({ length: 24 }, (_, i) => i >= 7 && i <= 9 ? 255 : 0);
        expect(Array.from(pixels)).toEqual(Array.from({ length: count }, () => expected).flat());
    });
}
