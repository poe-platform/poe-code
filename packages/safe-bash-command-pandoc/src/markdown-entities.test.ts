import {readFileSync} from "node:fs";
import {expect, it} from "vitest";
import {createStandalonePandocCommand} from "./safe-bash.js";

const cases = JSON.parse(readFileSync(new URL("../conformance/markdown-entities.json", import.meta.url), "utf8")) as {
  name: string; input: string; blocks: unknown[]; plain: string; html: string;
}[];

it.each(cases)("decodes Markdown references once: $name", async fixture => {
  for (const to of ["json", "plain", "html"] as const) {
    const chunks: Uint8Array[] = [];
    const result = await createStandalonePandocCommand().execute({
      args: ["-f", "markdown", "-t", to],
      stdin: [new TextEncoder().encode(fixture.input)],
      signal: new AbortController().signal,
      stdout: {async write(bytes) {chunks.push(bytes);}},
      stderr: {async write() {}}
    });
    expect(result.exitCode).toBe(0);
    const output = new TextDecoder().decode(Buffer.concat(chunks));
    if (to === "json") expect(JSON.parse(output).blocks).toEqual(fixture.blocks);
    else expect(output).toBe(fixture[to]);
  }
});
