import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompositeCommand, createMagickCommand, runCompositeCli, runCompositeCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI references, using identical PPM inputs.
for (const route of ["magick", "composite", "retained", "buffered", "sync"] as const)
for (const shorthand of [true, false])
it.each([
    { geometry: "1x0", hex: "656f796e7882939da7" },
    { geometry: "0x0", hex: "656f79838d97a1abb5" }
])(`${route}: composite displacement $geometry, shorthand=${shorthand}`, async ({ geometry, hex }) => {
    const files = new Map([
        ["/left.ppm", new TextEncoder().encode("P3\n3 1\n255\n10 20 30  40 50 60  70 80 90\n")],
        ["/right.ppm", new TextEncoder().encode("P3\n3 1\n255\n101 111 121  131 141 151  161 171 181\n")],
        ["/out.raw", new TextEncoder().encode("KEEP")]
    ]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const argv = [
        ...(shorthand ? ["-displace", geometry] : ["-compose", "Displace", "-define", `compose:args=${geometry}`]),
        "/left.ppm", "/right.ppm", "rgb:/out.raw"
    ];
    const argumentValues = createCommandArguments(route === "magick" ? ["composite", ...argv] : argv);
    let stdout = "", stderr = "";
    const command = route === "magick" || route === "composite";
    const result = command ? await (route === "magick" ? createMagickCommand() : createCompositeCommand()).execute({
        command: route, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : route === "sync" ? runCompositeCliSync(argv, files)
        : await runCompositeCli(argv, route === "retained" ? { filesystem, cwd: "/" } : files);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect("stdout" in result ? result.stdout : stdout).toBe("");
    const output = command || route === "retained" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
    expect(Buffer.from(output).toString("hex")).toBe(hex);
});
