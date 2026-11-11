import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createCompositeCommand, runCompositeCli, runCompositeCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes, including its 16-bit stegano output.
const cases = [
    { name: "offset zero", options: ["-stegano", "0"], hex: "64656f6f797983838c8d9797a1a1ababb4b5" },
    { name: "offset one", options: ["-stegano", "1"], hex: "65656f6f797982838d8d9797a1a1aaabb5b5" },
    { name: "offset at the end", options: ["-stegano", "3"], hex: "65656f6f797983838d8d9797a1a1ababb5b5" },
    { name: "square carrier wraps", size: [2, 2], options: ["-stegano", "0"], hex: "6467ed6b79794564666ffb7df5654f66787924656f6b5970" },
    { name: "square carrier wraps from offset one", size: [2, 2], options: ["-stegano", "1"], hex: "24656f6b59706467ed6b79794564666ffb7df5654f667879" },
    { name: "tall carrier wraps at width squared", size: [2, 3], options: ["-stegano", "0"], hex: "6467ed6b79794564666ffb7df5654f66787924656f6b597065656f6f797965656f6f7979" },
    { name: "offset beyond wrapping point", size: [1, 3], options: ["-stegano", "1"], hex: "65656f6f797964656f6f797965656e6f7979" },
    { name: "ordinary composite", options: [], hex: "0a141e28323c46505a" },
    { name: "minus one disables stegano", options: ["-stegano", "-1"], hex: "0a141e28323c46505a" },
    { name: "disabled stegano", options: ["-stegano", "1", "+stegano"], hex: "0a141e28323c46505a" }
];

for (const route of ["magick", "composite", "filesystem", "map", "sync"] as const)
it.each(cases)(`${route}: composite $name`, async ({ options, hex, size }) => {
    const encoder = new TextEncoder(), fs = new MemoryFileSystem();
    const files = new Map([
        ["left.ppm", encoder.encode("P3\n3 1\n255\n10 20 30  40 50 60  70 80 90\n")],
        ["right.ppm", encoder.encode(size ? `P3\n${size[0]} ${size[1]}\n255\n${"101 111 121 ".repeat(size[0]! * size[1]!)}\n`
            : "P3\n3 1\n255\n101 111 121  131 141 151  161 171 181\n")],
        ["out.raw", encoder.encode("KEEP")]
    ]);
    for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
    const argv = [...options, "left.ppm", "right.ppm", "rgb:out.raw"];
    let stdout = "", stderr = "";
    const command = route === "magick" ? createMagickCommand() : createCompositeCommand();
    const argumentValues = createCommandArguments(route === "magick" ? ["composite", ...argv] : argv);
    const result = route === "magick" || route === "composite" ? await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : route === "sync" ? runCompositeCliSync(argv, files)
        : await runCompositeCli(argv, route === "filesystem" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect("stdout" in result ? result.stdout : stdout).toBe("");
    const bytes = route === "map" || route === "sync" ? files.get("out.raw")! : await fs.readFile("/out.raw");
    expect(Buffer.from(bytes).toString("hex")).toBe(hex);
});

for (const retained of [false, true])
it.each([
    { args: ["-stegano"], diagnostic: "missing argument" },
    { args: ["-stegano", "invalid", "left.ppm", "right.ppm", "rgb:out.raw"], diagnostic: "invalid argument" }
])(`rejects an invalid stegano offset without replacing output (filesystem=${retained}): $args`, async ({ args, diagnostic }) => {
    const files = new Map([["out.raw", new TextEncoder().encode("KEEP")]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out.raw", files.get("out.raw")!);
    const result = await runCompositeCli(args, retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(diagnostic);
    expect(result.stderr).toContain("-stegano");
    expect(new TextDecoder().decode(retained ? await fs.readFile("/out.raw") : files.get("out.raw")!)).toBe("KEEP");
});
