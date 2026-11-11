import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, -limit thread 1, RGBA8.
// The reported 2x1 seed-42 output is 919191ff4d4d4dff.
for (const mode of ["command", "retained", "buffered", "sync"]) {
    it.each([
        { width: 2, height: 1, seed: "42", method: "random", hash: "9a66686c99246b03a753bbf56cea82012ff9d0f826cf90b27c56418dac996a8d" },
        { width: 2, height: 1, seed: "42", method: "edge", hash: "f7de83e68898a01578837f351b3b3124fe92eeb21c9d2f40ee114e670204f964" },
        { width: 2, height: 1, seed: "0", method: "random", hash: "1e147bc45df7963c88ad6bb9f4da2cf057659416716d3b318a7d798e89f482a5" },
        { width: 2, height: 1, seed: "-2", method: "random", hash: "5df86d4c08bfcf17bfd52be8a599fe4286fa10c14fd1473af609b2cf23dbc69d" },
        { width: 3, height: 3, seed: "17", method: "random", hash: "9a3711a8c6cfe1412687157782902824f94d71529ebf9a821077b5b4b72c1ff7" },
        { width: 1025, height: 2, seed: "42", method: "random", hash: "61a351bc7050be755aeb0751b1aa043b5411967666e87841880ae1249445c36d" },
        { width: 2, height: 513, seed: "42", method: "random", hash: "fd9dd1a63be3e09602cbb8aab4dd2fbcdba3870428e381f1dbe33b075d3ffe26" },
    ])(`matches native $width x $height $method shade with seed $seed (${mode})`, async ({ width, height, seed, method, hash }) => {
        const input = Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), Buffer.from(
            width === 2 && height === 1 ? [10, 20, 30, 90, 110, 130] : Array.from({ length: width * height * 3 }, (_, i) => (13 * i + 9) % 256)
        )]);
        for (let repeat = 0; repeat < 3; repeat++) {
            const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.ppm", input);
            const args = ["-limit", "thread", "1", "-seed", seed, "/in.ppm", "-virtual-pixel", method, "-shade", "0x45", "-seed", "123", "-depth", "8", "rgba:/out"];
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs: filesystem, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
            const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
        }
    });
}
