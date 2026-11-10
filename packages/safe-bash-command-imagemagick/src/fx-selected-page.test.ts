import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const frames = ["-size", "3x2", "xc:red", "-repage", "8x6+1+2", "(", "-size", "1x2", "xc:white", "-repage", "11x12-3+4", ")"];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
  it.each([
    { expression: "u[1].page.width", expected: "begin:11:endbegin:11:end" },
    { expression: "v.page.height", expected: "begin:12:endbegin:12:end" },
    { expression: "v.page.x", expected: "begin:-3:endbegin:-3:end" },
    { expression: "u.page.y", expected: "begin:2:endbegin:2:end" },
    { expression: "page.width", expected: "begin:8:endbegin:11:end" },
    { expression: "w", expected: "begin:3:endbegin:1:end" },
    { expression: "u.page.width+u.page.height+u.page.x+u.page.y", expected: "begin:17:endbegin:17:end" },
    { expression: "v.page.width+v.page.height+v.page.x+v.page.y", expected: "begin:24:endbegin:24:end" },
    { expression: "u[-1].page.width+u[-1].page.height+u[-1].page.x+u[-1].page.y", expected: "begin:24:endbegin:24:end" },
  ])(`${mode}: resolves $expression from the selected image's page`, async ({ expression, expected }) => {
    // The reported cases match ImageMagick 7.1.2-35 Q16-HDRI; the sums exercise every field.
    const files = new Map([["/out", new TextEncoder().encode("KEEP")]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out", files.get("/out")!);
    const args = [...frames, "-format", `begin:%[fx:${expression}]:end`, "info:/out"];
    const argumentValues = createCommandArguments(args);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result : { ...result, stderr }).toMatchObject({ exitCode: 0, stderr: "" });
    const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
    expect(new TextDecoder().decode(output)).toBe(expected);
  });

  it.each([
    { input: ["-size", "3x2", "xc:#80402060", "-repage", "8x6+1+2"], expression: "u.page.width/10", value: 204 },
    { input: frames, expression: "v.page.height/20", value: 153 },
    { input: ["-size", "3x2", "xc:red", "(", "-size", "1x2", "xc:white", ")"], expression: "(u[1].page.width+u[1].page.height+u[1].page.x+u[1].page.y)/5", value: 153 },
  ])(`${mode}: pixel FX reads $expression`, async ({ input, expression, value }) => {
    const files = new Map([["/out", new TextEncoder().encode("KEEP")]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out", files.get("/out")!);
    const args = [...input, "-fx", expression, "-depth", "8", "gray:/out"];
    const argumentValues = createCommandArguments(args);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result : { ...result, stderr }).toMatchObject({ exitCode: 0, stderr: "" });
    const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
    expect([...output]).toEqual(Array(6).fill(value));
  });
}
