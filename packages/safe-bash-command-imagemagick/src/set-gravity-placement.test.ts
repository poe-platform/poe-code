import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i))]);
// Native ImageMagick RGB output for the asymmetric 4x3 fixture.
const operations = [
    { option: "-chop", geometry: "1x1+0+0", length: 18,
        southeast: "e3a97f6169e27403eb5c71c870d73f69c4330ac03f5608d0e88a168f4a211ae8",
        northwest: "7be2b9359a0d9233621febbb8d88bbc5e3a0af3dec76d173d392715b0ab3475d" },
    { option: "-splice", geometry: "1x1+0+0", length: 60,
        southeast: "1a1259946aa1c3f920e5ed5db01c1b325168e9a2e8e869de265501bb69e98565",
        northwest: "72311cc505f01a0c6652262ec016d4672ff38db89fb4a72c180f15a1b4086217" },
    { option: "-extent", geometry: "6x5+1+1", length: 90,
        southeast: "9146a177a2e58cf18fe69c0a8be982fb643f79db6cf0623b3b82d70cffeff1eb",
        northwest: "233da5f637f5256fbf50a1e53aa9393250f2abf68be0d3a14e31c32828c09af5" }
];
const settings = [
    { name: "default", args: [], southeast: false },
    { name: "explicit gravity", args: ["-gravity", "SouthEast"], southeast: true },
    { name: "image gravity", args: ["-set", "gravity", "SouthEast"], southeast: true },
    { name: "option gravity", args: ["-set", "option:gravity", "SouthEast"], southeast: true },
    { name: "existing option overrides image", args: ["-gravity", "NorthWest", "-set", "gravity", "SouthEast"], southeast: false },
    { name: "later option overrides image", args: ["-set", "gravity", "SouthEast", "-set", "option:gravity", "NorthWest"], southeast: false },
    { name: "reset gravity", args: ["-set", "gravity", "SouthEast", "+gravity"], southeast: false },
    { name: "property removal retains image gravity", args: ["-set", "gravity", "SouthEast", "+set", "gravity"], southeast: true }
];

for (const mode of ["public", "buffered", "sync"] as const) {
    for (const operation of operations) {
        for (const setting of settings) {
            it(`${mode}: ${operation.option} uses ${setting.name}`, async () => {
                const fs = new MemoryFileSystem();
                await fs.writeFile("/in.ppm", input);
                const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
                const args = ["/in.ppm", ...setting.args, operation.option, operation.geometry, "-depth", "8", "rgb:/out"];
                const argumentValues = createCommandArguments(args);
                let stderr = "";
                const context = {
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(value: string | Uint8Array) { stderr += typeof value === "string" ? value : new TextDecoder().decode(value); } }, registerCleanup() {}
                } as unknown as CommandContext;
                const result = mode === "public" ? await createMagickCommand().execute(context)
                    : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
                expect(result.exitCode).toBe(0);
                expect("stderr" in result ? result.stderr : stderr).toBe("");
                const output = mode === "public" ? await fs.readFile("/out") : files.get("/out")!;
                expect(output.length).toBe(operation.length);
                expect(createHash("sha256").update(output).digest("hex")).toBe(setting.southeast ? operation.southeast : operation.northwest);
            });
        }
    }
}
