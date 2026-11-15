import {expect, it} from "vitest";
import {convert, convertToOutput} from "./engine.js";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {createStandalonePandocCommand} from "./safe-bash.js";
import fixtures from "./fixtures/inline-html.json" with {type: "json"};

function rawInlines(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(rawInlines);
  if (!value || typeof value !== "object") return [];
  return "t" in value && value.t === "RawInline" ? [value] : Object.values(value).flatMap(rawInlines);
}

it.each(fixtures)("preserves inline HTML: $name", async (fixture) => {
  const bytes = new TextEncoder().encode(fixture.source);
  const rawContent = (fixture.args?.find(arg => arg.startsWith("--raw-content="))?.split("=")[1]
    ?? (fixture.args?.includes("--raw-content") ? fixture.args[fixture.args.indexOf("--raw-content") + 1] : undefined)) as "reject" | "escape" | "retain" | undefined;
  const options = {from: fixture.from, to: fixture.to, lossy: fixture.args?.includes("--lossy") ?? false, stripComments: fixture.args?.includes("--strip-comments") ?? false,
    ...(rawContent === undefined ? {} : {rawContent})};
  for (const retained of [false, true]) {
    let output = "";
    const run = async () => {
      if (retained) {
        await convertToOutput([{bytes}], options, {
          workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384},
          output: {async write(chunk) {output += new TextDecoder().decode(chunk);}, async close() {}, async abort() {}}
        });
      } else {
        const result = await convert([{bytes}], options, {});
        if (result.kind !== "text") throw new Error("Expected text output");
        output = result.text;
      }
    };
    if (fixture.error) {await expect(run()).rejects.toMatchObject({code: expect.stringMatching(/^E_/)}); continue;}
    await run();
    if (fixture.blocks) expect(JSON.parse(output).blocks).toEqual(fixture.blocks);
    else if (fixture.raw) expect(rawInlines(JSON.parse(output))).toEqual(fixture.raw);
    else expect(output).toBe(fixture.output);
  }
  let stdout = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", fixture.from, "-t", fixture.to, ...(fixture.args ?? [])], stdin: [bytes],
    signal: new AbortController().signal,
    stdout: {async write(chunk) {stdout += new TextDecoder().decode(chunk);}}, stderr: {async write() {}}
  });
  if (fixture.error) {expect(result.exitCode).not.toBe(0); expect(stdout).toBe("");}
  else {
    expect(result.exitCode).toBe(0);
    if (fixture.blocks) expect(JSON.parse(stdout).blocks).toEqual(fixture.blocks);
    else if (fixture.raw) expect(rawInlines(JSON.parse(stdout))).toEqual(fixture.raw);
    else expect(stdout).toBe(fixture.output);
  }
});

it("does not replace a saved file when nested raw content cannot be converted", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/saved.txt", new TextEncoder().encode("KEEP"));
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "gfm", "-t", "plain", "-o", "/saved.txt"],
    stdin: [new TextEncoder().encode("before\n\n- a<!-- hidden -->b")], fs,
    signal: new AbortController().signal, stdout: {async write() {}}, stderr: {async write() {}}
  });
  expect(result.exitCode).not.toBe(0);
  expect(new TextDecoder().decode(await fs.readFile("/saved.txt"))).toBe("KEEP");
});
