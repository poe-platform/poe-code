import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, -limit thread 1, RGBA8.
for (const mode of ["command", "retained", "buffered", "sync"]) {
    it.each([
        {"seed": "42", "method": "random", "geometry": "2x1+0", "before": [], "after": [], "expected": "660f0c16471fda0c1ab3527596c3cc401af6565879fec9e4802b4d5966269ed6", "width": 5, "height": 3},
        {"seed": "42", "method": "edge", "geometry": "2x1+0", "before": [], "after": [], "expected": "40d4b033082de65247ed135bbaa9cba1be7f33c15670943c577fce9654d476d4", "width": 5, "height": 3},
        {"seed": "0", "method": "random", "geometry": "2x1+0", "before": [], "after": [], "expected": "9423262d88ad131841551d5b97e8a8ea1f20c7d191175bb3b4ffeff405b2efea", "width": 5, "height": 3},
        {"seed": "17", "method": "random", "geometry": "2x1+90", "before": [], "after": [], "expected": "9e0eef141227ec018530a37575281657f429fb015f0167b0a2a0bd4b825fa61d", "width": 5, "height": 3},
        {"seed": "-2", "method": "random", "geometry": "2x1-45", "before": [], "after": [], "expected": "ab4d43579f49efd479884d23845da3fb1ef6fbe6e661b33d7a1f71731d78d727", "width": 5, "height": 3},
        {"seed": "42", "method": "random", "geometry": "2x1+0", "before": ["-channel", "G"], "after": [], "expected": "511f286f1c4b31e229782afcec20fcbd2d67992f288cf8a70f0f89762d29c8ae", "width": 5, "height": 3},
        {"seed": "42", "method": "random", "geometry": "2x1+0", "before": ["-colorspace", "gray"], "after": [], "expected": "f8f2a6480d66ca8bc466e00d74020c137a1f00a77ee8628ecec82da7d8f3b58f", "width": 5, "height": 3},
        {"seed": "42", "method": "random", "geometry": "2x1+0", "before": ["-colorspace", "cmyk"], "after": [], "expected": "8ad5be3940f13512bf2744599f9424f87c68b2d3cdb1f5573c49264575331037", "width": 5, "height": 3},
        {"seed": "42", "method": "random", "geometry": "2x1+0", "before": ["-alpha", "set", "-channel", "A", "-evaluate", "set", "50%", "+channel"], "after": [], "expected": "3bee52cbd19ea31ce54dd321d7db4d65d5e89fc87b949aa13322acc5eb026eae", "width": 5, "height": 3},
        {"seed": "42", "method": "random", "geometry": "2x1+0", "before": ["-channel-fx", "red=>meta0"], "after": ["-channel", "meta0", "-separate"], "expected": "8e17e1c68371f0f54bcfb4dbcb3b478b0bec9b4e872c41e4551c5380d596fbd2", "width": 5, "height": 3},
        {"seed": "42", "method": "random", "geometry": "2x1+0", "before": ["-channel-fx", "red=>meta0"], "after": [], "expected": "ed2dcec1e1c5928125898aadd86e7f4d401020ccf65a46c4e5440410e35a9015", "width": 5, "height": 3},
        {"seed": "42", "method": "random", "geometry": "2x1+0", "before": ["-channel-fx", "red=>meta0", "-channel", "meta0"], "after": ["-channel", "meta0", "-separate"], "expected": "270c5ae41c9b1623fa0b630339177c95bb663ad85ec3fb78b3a60037fe7344f1", "width": 5, "height": 3},
        {"seed": "42", "method": "random", "geometry": "2x1+0", "before": [], "after": [], "width": 1025, "height": 2, "expected": "c9448334ea6d95cf094df4d8416ca992ac4af09bc916f023062e6bcc51e670d2"},
        {"seed": "42", "method": "random", "geometry": "2x1+0", "before": [], "after": [], "width": 2, "height": 513, "expected": "d6191bca31e51cb3534cc79cffb3fb42a597ae1d6e6ba3ae99b1f8f6816e8aca"},
    ])(`matches native $method motion blur seed $seed, $geometry, $before, $after (${mode})`, async ({ seed, method, geometry, before, after, width, height, expected }) => {
        const input = Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), Buffer.from(
            Array.from({ length: width * height }, (_, i) => [i * 17, i * 47, 200 - i * 7]).flat()
        )]);
        for (let repeat = 0; repeat < 3; repeat++) {
            const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.ppm", input);
            const args = ["-limit", "thread", "1", "-seed", seed, "/in.ppm", "-virtual-pixel", method, ...before, "-motion-blur", geometry, ...after, "-seed", "123", "-depth", "8", "rgba:/out"];
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
            expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected);
        }
    });
}
