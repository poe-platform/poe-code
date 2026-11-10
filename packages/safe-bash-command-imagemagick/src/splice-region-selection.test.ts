import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

const input = new TextEncoder().encode("P3\n3 2\n255\n10 25 40 50 65 80 90 105 120\n130 145 160 170 185 200 210 225 240\n");

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw RGB8 bytes.
const cases = [
    { name: "column insertion alone", geometry: "1x0+0+0", after: [], hex: "0000000a19283241505a69780000008291a0aab9c8d2e1f0" },
    { name: "column insertion then negate", geometry: "1x0+0+0", after: ["-negate"], hex: "ffffff0a1928cdbeaf5a6978ffffff8291a0aab9c8d2e1f0" },
    { name: "cleared region", geometry: "1x0+0+0", after: ["+region", "-negate"], hex: "fffffff5e6d7cdbeafa59687ffffff7d6e5f5546372d1e0f" },
    { name: "row insertion then negate", geometry: "0x1+0+0", after: ["-negate"], hex: "0000000000000000000a1928cdbeaf5a69788291a0aab9c8d2e1f0" },
    { name: "selection after another splice", geometry: "1x0+0+0", after: ["-splice", "1x0+0+0", "-negate"], hex: "ffffffffffff0a1928cdbeaf5a6978ffffffffffff8291a0aab9c8d2e1f0" },
    { name: "replacement region", geometry: "1x0+0+0", after: ["-region", "1x1+1+0", "-negate"], hex: "000000f5e6d73241505a69780000008291a0aab9c8d2e1f0" },
    { name: "identity splice", geometry: "0x0+0+0", after: ["-negate"], hex: "0a1928cdbeaf5a69788291a0aab9c8d2e1f0" },
];

for (const mode of ["buffered", "retained", "sync", "command"]) {
    it.each(cases)(`preserves native splice selection: $name (${mode})`, async ({ geometry, after, hex }) => {
        const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-region", "1x1+1+0", "-splice", geometry, ...after, "-depth", "8", mode === "command" ? "rgb:-" : "rgb:/out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const stdout: Uint8Array[] = [];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
        const bytes = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    });
}
