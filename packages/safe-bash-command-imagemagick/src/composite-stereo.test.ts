import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompositeCommand, createMagickCommand, runCompositeCli, runCompositeCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: -stereo takes red from the second input,
// unlike -compose Stereo. Offsets sample virtual edge pixels of that input.
const cases = [
    { name: "zero offset", options: ["-stereo", "+0+0"], inputs: ["left.ppm", "right.ppm"], hex: "65141e83323ca1505a" },
    { name: "positive offset", options: ["-stereo", "+1+0"], inputs: ["left.ppm", "right.ppm"], hex: "65141e65323c83505a" },
    { name: "negative offset", options: ["-stereo", "-1+0"], inputs: ["left.ppm", "right.ppm"], hex: "83141ea1323ca1505a" },
    { name: "offset beyond width", options: ["-stereo", "+9+0"], inputs: ["left.ppm", "right.ppm"], hex: "65141e65323c65505a" },
    { name: "vertical offset", options: ["-stereo", "+0+1"], inputs: ["left-vertical.ppm", "right-vertical.ppm"], hex: "65141e65323c83505a" },
    { name: "negative vertical offset", options: ["-stereo", "+0-1"], inputs: ["left-vertical.ppm", "right-vertical.ppm"], hex: "83141ea1323ca1505a" },
    { name: "reversed inputs", options: ["-stereo", "+0+0"], inputs: ["right.ppm", "left.ppm"], hex: "0a6f79288d9746abb5" },
    { name: "missing pair", options: ["-stereo", "+0+0"], inputs: ["left.ppm"], hex: "4b454550", error: "missing an image filename" },
    { name: "different image dimensions", options: ["-stereo", "+0+0"], inputs: ["left.ppm", "right-vertical.ppm"], hex: "4b454550", error: "left and right image sizes differ" },
    { name: "16-bit samples", options: ["-stereo", "+0+0"], inputs: ["left16.ppm", "right16.ppm"], hex: "cdab45235634" },
    { name: "default compose control", options: [], inputs: ["left.ppm", "right.ppm"], hex: "0a141e28323c46505a" },
    { name: "Stereo compose control", options: ["-compose", "Stereo"], inputs: ["left.ppm", "right.ppm"], hex: "0a6f79288d9746abb5" }
];

for (const route of ["magick", "composite", "retained", "buffered", "sync"] as const)
it.each(cases)(`${route}: composite $name`, async ({ options, inputs, hex, error }) => {
    const encode = (text: string) => new TextEncoder().encode(text);
    const files = new Map([
        ["left.ppm", encode("P3\n3 1\n255\n10 20 30  40 50 60  70 80 90\n")],
        ["right.ppm", encode("P3\n3 1\n255\n101 111 121  131 141 151  161 171 181\n")],
        ["left-vertical.ppm", encode("P3\n1 3\n255\n10 20 30  40 50 60  70 80 90\n")],
        ["right-vertical.ppm", encode("P3\n1 3\n255\n101 111 121  131 141 151  161 171 181\n")],
        ["left16.ppm", encode("P3\n1 1\n65535\n4660 9029 13398\n")],
        ["right16.ppm", encode("P3\n1 1\n65535\n43981 48350 52719\n")],
        ["out.raw", encode("KEEP")]
    ]);
    const filesystem = new MemoryFileSystem();
    for (const [name, bytes] of files) await filesystem.writeFile("/" + name, bytes);
    const argv = [...options, ...inputs, "rgb:out.raw"];
    let stdout = "", stderr = "";
    const argumentValues = createCommandArguments(route === "magick" ? ["composite", ...argv] : argv);
    let exitCode: number;
    if (route === "magick" || route === "composite") {
        const result = await (route === "magick" ? createMagickCommand() : createCompositeCommand()).execute({
            command: route, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        exitCode = result.exitCode;
    } else {
        const result = route === "sync" ? runCompositeCliSync(argv, files)
            : await runCompositeCli(argv, route === "retained" ? { filesystem, cwd: "/" } : files);
        ({ exitCode, stderr, stdout } = result);
    }
    expect(exitCode).toBe(error ? 1 : 0);
    expect(stdout).toBe("");
    if (error) expect(stderr).toContain(error);
    else expect(stderr).toBe("");
    const bytes = route === "buffered" || route === "sync" ? files.get("out.raw")! : await filesystem.readFile("/out.raw");
    expect(Buffer.from(bytes).toString("hex")).toBe(hex);
});
