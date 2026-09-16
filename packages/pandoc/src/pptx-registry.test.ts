import { expect, it } from "vitest";
import { createFormatRegistry, convert } from "./index.js";
import { createPandocCommand } from "./safe-bash.js";

it("exposes verified PPTX conversion through the registry and byte command adapter", async () => {
  const registry = createFormatRegistry();
  expect(registry.list("read")).toContain("pptx");
  expect(registry.list("write")).toContain("pptx");
  const input = new TextEncoder().encode("## Spring\n\n## Summer");
  const options = {from: "commonmark", to: "pptx", metadata: {"pptx-slide-level": {t: "MetaString" as const, c: "2"}}};
  const sdk = await convert([{bytes: input}], options, {});
  const chunks: Uint8Array[] = [], warnings: Uint8Array[] = [];
  const result = await createPandocCommand().execute({
    args: ["-f", "commonmark", "-t", "pptx", "--metadata", "pptx-slide-level=2"],
    stdin: [input], signal: new AbortController().signal,
    stdout: {write: async bytes => {chunks.push(new Uint8Array(bytes));}},
    stderr: {write: async bytes => {warnings.push(new Uint8Array(bytes));}}
  });
  expect(result, new TextDecoder().decode(Buffer.concat(warnings))).toEqual({exitCode: 0});
  expect(new TextDecoder().decode(Buffer.concat(warnings))).toContain("W_LAYOUT_UNMEASURED");
  if (sdk.kind !== "binary") throw new Error("Expected presentation bytes");
  expect(new Uint8Array(Buffer.concat(chunks))).toEqual(sdk.bytes);
});
