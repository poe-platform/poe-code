import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

// Native: magick 'xc:#20408070' 'xc:#90a0b0c0' +append -strip PNG32:-
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVQI12NUcGgoKEgwCAAAC5ICopdym6wAAAAASUVORK5CYII=", "base64");

for (const mode of ["buffered", "retained", "sync", "mogrify"] as const) {
  it.each([
    "min(u)", "min(u,0,1)", "max()", "max(u,0,1)",
    "round()", "round(u,0.2)", "clamp()", "clamp(u,0.2,0.5)",
    "pow(u)", "atan2(u,0,1)", "hypot(u)", "mod(u,0,1)",
    "if(u,0)", "if(u,0,1,0)", "rand(u)", "sin()", "sin(u,0)",
    "1 ? u : min(u)",
  ])(`rejects invalid FX arity before overwriting output (${mode}): %s`, async expression => {
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
    expect(result.stderr).toContain("argument");
    expect(mode === "mogrify" ? await filesystem.readFile("/input.png")
      : mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png"))
      .toEqual(mode === "mogrify" ? new Uint8Array(input) : original);
  });

  it.each(["clamp(u)", "min(u,1)", "max(u,0)", "if(1,u,0)", "u+0*rand()"])(`preserves valid FX pixels and unselected channels (${mode}): %s`, async expression => {
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
