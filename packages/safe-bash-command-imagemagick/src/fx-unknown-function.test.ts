import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

// Native: magick 'xc:#20408070' 'xc:#90a0b0c0' +append -strip PNG32:-
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVQI12NUcGgoKEgwCAAAC5ICopdym6wAAAAASUVORK5CYII=", "base64");

it("magick rejects an unknown FX function without replacing an existing output", async () => {
  const fs = new MemoryFileSystem();
  const original = new TextEncoder().encode("keep");
  await fs.writeFile("/input.png", input);
  await fs.writeFile("/out.png", original);
  let stderr = "";
  const result = await createMagickCommand().execute({
    command: "magick",
    args: createCommandArguments(["input.png", "-channel", "R", "-fx", "bogus(u)", "out.png"]).args,
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { write: async () => {} },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
  });
  expect(result.exitCode).toBe(1);
  expect(stderr).toContain("Unknown FX function: bogus");
  expect(await fs.readFile("/out.png")).toEqual(original);
});

for (const mode of ["buffered", "retained", "sync", "mogrify"] as const) {
  it.each(["bogus(u)", "unknown(u,0)", "abs(bogus(u))", "1 ? u : bogus(u)"])(`rejects unknown FX functions before overwriting output (${mode}): %s`, async expression => {
    const original = new TextEncoder().encode("keep");
    const files = new Map([["/input.png", input], ["/out.png", original]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    await filesystem.writeFile("/out.png", original);
    const options = ["-channel", "R", "-fx", expression];
    const args = ["/input.png", ...options, "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
      : mode === "mogrify" ? await runMogrifyCli([...options, "/input.png"], { filesystem, cwd: "/" })
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown FX function");
    expect(mode === "mogrify" ? await filesystem.readFile("/input.png")
      : mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png"))
      .toEqual(mode === "mogrify" ? new Uint8Array(input) : original);
  });

  it.each(["u", "abs(u)"])(`preserves valid FX pixels and unselected channels (${mode}): %s`, async expression => {
    const files = new Map([["/input.png", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const options = ["-channel", "R", "-fx", expression];
    const args = ["/input.png", ...options, "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
      : mode === "mogrify" ? await runMogrifyCli([...options, "/input.png"], { filesystem, cwd: "/" })
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const output = mode === "mogrify" ? await filesystem.readFile("/input.png")
      : mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
    expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe("2040807090a0b0c0");
  });
}
