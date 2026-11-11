import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

const centroid = "#555555555555FFFF 3\n";
for (const mode of ["public", "retained", "map"])
it.each([
    { options: ["-verbose", "-kmeans", "1", "+verbose"], stderr: centroid },
    { colors: ["#010000", "#020000"], options: ["-verbose", "-kmeans", "1", "+verbose"], stderr: "#018200000000FFFF 2\n", pixels: "020000ff020000ff" },
    { colors: ["#202040", "#405080", "#808060", "#b0a040"], options: ["-verbose", "-kmeans", "4", "+verbose"], stderr: "#202020204040FFFF 1\n#B0B0A0A04040FFFF 1\n#808080806060FFFF 1\n#404050508080FFFF 1\n", pixels: "202040ff405080ff808060ffb0a040ff" },
    { options: ["-define", "kmeans:seed-colors=#123412341234", "-verbose", "-kmeans", "1", "+verbose"], stderr: "#555555555555 3\n" },
    { options: ["+verbose", "-kmeans", "1"], stderr: "" },
    { options: ["-kmeans", "1"], stderr: "" },
    { options: ["-verbose", "+verbose", "-kmeans", "1"], stderr: "" },
    { options: ["-verbose", "-kmeans", "1", "+verbose", "-kmeans", "1"], stderr: centroid },
    { options: ["-verbose", "-kmeans", "1", "-kmeans", "1", "+verbose"], stderr: centroid.repeat(2) },
    { options: ["-quiet", "-verbose", "-kmeans", "1", "+verbose"], stderr: centroid },
    { options: ["-depth", "8", "-verbose", "-kmeans", "1", "+verbose"], stderr: "#555555FF 3\n" },
    { options: ["-depth", "32", "-verbose", "-kmeans", "1", "+verbose"], stderr: "#555555555555555555555555FFFFFFFF 3\n" },
    { options: ["-colorspace", "CMYK", "-verbose", "-kmeans", "1", "+verbose"], stderr: "#AAAAAAAAAAAA0000FFFF 3\n" },
    { options: ["-verbose", "-kmeans", "1x0", "+verbose"], stderr: "", pixels: "ff0000ff00ff00ff0000ffff" },
    { options: ["-verbose", "-kmeans", "2", "+verbose"], stderr: "#00000000FFFFFFFF 1\n#800080000000FFFF 2\n", pixels: "808000ff808000ff0000ffff" },
    { colors: ["#ff000080", "#0000ff40"], options: ["-verbose", "-kmeans", "1", "+verbose"], stderr: "#8000000080006060 2\n", pixels: "8000806080008060" },
    { options: ["-define", "kmeans:seed-colors=red;lime;blue;white", "-verbose", "-kmeans", "4", "+verbose"], stderr: "#FF0000 1\n#00FF00 1\n#0000FF 1\n#000000 0\n", pixels: "ff0000ff00ff00ff0000ffff" },
])(`reports kmeans centroids on stderr without changing binary stdout (${mode}: $options)`, async ({ colors = ["red", "lime", "blue"], options, stderr: expectedStderr, pixels = "555555ff555555ff555555ff" }) => {
    const argv = ["-seed", "42", ...colors.map(color => `xc:${color}`), "+append", ...options, "-depth", "8", "-endian", "MSB", "rgba:-"];
    const fs = new MemoryFileSystem();
    let stderr = "";
    const chunks: Uint8Array[] = [];
    const args = createCommandArguments(argv);
    const result = mode === "public" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
    }) : await runMagickCli(argv, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
    if ("stderr" in result) stderr = result.stderr as string;
    if ("stdoutBytes" in result && result.stdoutBytes) chunks.push(result.stdoutBytes as Uint8Array);
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe(expectedStderr);
    expect(Buffer.concat(chunks).toString("hex")).toBe(pixels);
});
