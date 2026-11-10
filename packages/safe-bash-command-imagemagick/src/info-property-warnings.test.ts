import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const fixtures = [
  ["a.ppm", "P3\n2 1\n255\n13 30 79 235 153 61\n"],
  ["b.ppm", "P3\n2 1\n255\n52 73 91 114 137 180\n"],
  ["c.ppm", "P3\n1 2\n255\n52 73 91 114 137 180\n"]
] as const;

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([
    { count: 1, format: "%[label]", options: [], output: "", warnings: ["%[label]"] },
    { count: 2, format: "%[label]", options: [], output: "", warnings: ["%[label]"] },
    { count: 3, format: "%[label]", options: [], output: "", warnings: ["%[label]"] },
    { count: 3, format: "%[label]", options: ["-quiet"], output: "", warnings: [] },
    { count: 3, format: "%[label]", options: ["-set", "label", "caption"], output: "captioncaptioncaption", warnings: [] },
    { count: 3, format: "%[label]|%w\n", options: [], output: "|2\n|2\n|1\n", warnings: ["%[label]"] },
    { count: 3, format: "%a", options: [], output: "", warnings: ["%a"] },
    { count: 1, format: "%[label]%[comment]", options: [], output: "", warnings: ["%[label]", "%[comment]"] },
    { count: 2, format: "%[label]%[comment]", options: [], output: "", warnings: ["%[label]", "%[comment]", "%[comment]"] }
  ])(`reports missing INFO properties without changing output (${mode}): $count, $format, $options`, async ({ count, format, options, output, warnings }) => {
    const files = new Map<string, Uint8Array>(fixtures.map(([name, data]) => [name, new TextEncoder().encode(data)]));
    const fs = new MemoryFileSystem();
    for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
    files.set("out", new TextEncoder().encode("KEEP"));
    await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
    const args = [...fixtures.slice(0, count).map(([name]) => name), ...options, "-format", format, "info:out"];
    let result;
    if (mode === "command") {
      const argumentValues = createCommandArguments(args);
      let stdout = "", stderr = "";
      const status = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      result = { ...status, stdout, stderr };
    } else {
      result = mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    }
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: warnings.map(token => `magick: unknown image property '${token}'\n`).join("") });
    expect(new TextDecoder().decode(mode === "sync" || mode === "buffered" ? files.get("out") : await fs.readFile("/out"))).toBe(output);
  });
}
