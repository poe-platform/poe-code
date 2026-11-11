import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const bytes = new Uint8Array([...new TextEncoder().encode("P6\n2 1\n255\n"), 10, 20, 30, 90, 110, 130]);

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([
    { name: "single image", args: ["in.ppm", "-format", "%i|%f;", "info:"], stdout: "|in.ppm;" },
    { name: "two images", args: ["in.ppm", "in.ppm", "-format", "%i|%f;", "info:"], stdout: "|in.ppm;info:|in.ppm;" },
    { name: "three images", args: ["in.ppm", "in.ppm", "in.ppm", "-format", "%i|%f;", "info:"], stdout: "|in.ppm;info:|in.ppm;info:|in.ppm;" },
    { name: "different sources", args: ["in.ppm", "other.ppm", "-format", "%i|%f;", "info:"], stdout: "|in.ppm;info:|other.ppm;" },
    { name: "smushed images", args: ["in.ppm", "in.ppm", "+smush", "0", "-format", "%i|%f;", "info:"], stdout: "|in.ppm;" },
    { name: "explicit stdout", args: ["in.ppm", "other.ppm", "-format", "%i|%f;", "info:-"], stdout: "-|in.ppm;info:-|other.ppm;" },
    { name: "named output", args: ["in.ppm", "other.ppm", "-format", "%i|%f;", "info:report"], stdout: "", report: "report|in.ppm;info:report|other.ppm;" },
    { name: "uppercase coder", args: ["in.ppm", "other.ppm", "-format", "%i|%f;", "INFO:"], stdout: "|in.ppm;INFO:|other.ppm;" },
    { name: "inline write", args: ["in.ppm", "other.ppm", "-format", "%i|%f;", "-write", "info:", "null:"], stdout: "|in.ppm;info:|other.ppm;" },
    { name: "inline named output", args: ["in.ppm", "other.ppm", "-format", "%i|%f;", "-write", "info:report", "null:"], stdout: "", report: "report|in.ppm;info:report|other.ppm;" },
    { name: "identify", args: ["identify", "-format", "%i|%f;", "in.ppm", "other.ppm"], stdout: "in.ppm|in.ppm;other.ppm|other.ppm;" },
    { name: "inline identify", args: ["in.ppm", "other.ppm", "-format", "%i|%f;", "-identify", "null:"], stdout: "in.ppm|in.ppm;other.ppm|other.ppm;" },
    { name: "histogram images", args: ["in.ppm", "other.ppm", "-format", "%i|%f;", "histogram:info:"], stdout: "|in.ppm;|other.ppm;" }
  ])(`${mode}: $name filenames`, async ({ args, stdout, report }) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", bytes);
    await fs.writeFile("/other.ppm", bytes);
    const files = new Map([["in.ppm", bytes], ["other.ppm", bytes]]);
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
    expect(result).toEqual({ exitCode: 0, stdout, stderr: "" });
    if (report !== undefined) {
      const output = mode === "command" || mode === "retained" ? await fs.readFile("/report") : files.get("report");
      expect(output).toEqual(new TextEncoder().encode(report));
    }
    expect(await fs.readFile("/in.ppm")).toEqual(bytes);
    expect(await fs.readFile("/other.ppm")).toEqual(bytes);
  });
}
