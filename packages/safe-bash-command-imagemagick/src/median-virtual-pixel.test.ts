import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// RGBA8 reference output from ImageMagick 7.1.2-35 Q16-HDRI.
const input = Buffer.concat([Buffer.from("P6\n5 3\n255\n"), Buffer.from(Array.from({ length: 45 }, (_, i) => (i * 73 + 19) % 256))]);
const white = "ffffffffc97ec7ffeb7ea2ffc9c87dffffffffffa1c5c7ff5a7ea2ff7c7b80ff7f597dffc6c89fffffffffff7cc5e9ff7ca0c7ffc67bc4ffffffffff";
const edge = "355ca5ff5a59a2ffc9377dffa45958ffa4c836ff5aa3a5ff5a7ea2ff7c7b80ff7f597dff7f5658ff7cc533ff5aa3a2ff577ec4ff3259a2ff32569fff";
const cases = [
    { name: "white", settings: ["-virtual-pixel", "white"], expected: white },
    { name: "tile", settings: ["-virtual-pixel", "tile"], expected: "7c7e80ff5a7ea2ff7c7b80ff7f597dff7f7b7dff".repeat(3) },
    { name: "edge", settings: ["-virtual-pixel", "edge"], expected: edge },
    { name: "default", settings: [], expected: edge },
    { name: "reset", settings: ["-virtual-pixel", "white", "+virtual-pixel"], expected: edge },
    { name: "background", settings: ["-background", "white", "-virtual-pixel", "background"], expected: white },
];

for (const route of ["command", "buffered", "sync", "retained"] as const)
for (const operation of [["-median", "3"], ["-statistic", "Median", "3"]])
it.each(cases)(`${route}: ${operation.join(" ")} honors $name borders`, async ({ settings, expected }) => {
    const fs = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
    await fs.writeFile("/in.ppm", input);
    // Later settings must not change the border selected for this operation.
    const args = ["-quiet", "/in.ppm", ...settings, ...operation,
        "-virtual-pixel", "edge", "-background", "black", "-depth", "8", "rgba:/out.raw"];
    const stderr: string[] = [];
    const arguments_ = createCommandArguments(args);
    const result = route === "command" ? await createMagickCommand().execute({
        command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr.push(String(chunk)); } },
    }) : route === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, route === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    expect(stderr).toEqual([]);
    if (route !== "command") expect(result).toMatchObject({ stdout: "", stderr: "" });
    const output = route === "buffered" || route === "sync" ? files.get("/out.raw")! : await fs.readFile("/out.raw");
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
