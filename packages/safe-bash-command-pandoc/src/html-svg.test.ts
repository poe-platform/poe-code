import { expect, it } from "vitest";
import { readDocument } from "./engine.js";
import { createStandalonePandocCommand } from "./safe-bash.js";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><circle cx="0.5" cy="0.5" r="0.5"></circle></svg>';
const target = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
const image = { t: "Image", c: [["", [], []], [], [target, ""]] };

it("preserves inline SVG between surrounding text in command JSON output", async () => {
  const stdout: Uint8Array[] = [];
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "html", "-t", "json"],
    stdin: [new TextEncoder().encode('<p>Icon <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><circle cx="0.5" cy="0.5" r="0.5"/></svg> end.</p>')],
    signal: new AbortController().signal,
    stdout: { write: async bytes => { stdout.push(bytes); } },
    stderr: { write: async () => {} }
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(new TextDecoder().decode(Buffer.concat(stdout))).blocks).toEqual([
    { t: "Para", c: [{ t: "Str", c: "Icon" }, { t: "Space" }, image, { t: "Space" }, { t: "Str", c: "end." }] }
  ]);
});

it("preserves SVG namespaces, Unicode, and escaped text through the SDK", async () => {
  const markup = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><path id="shape" d="M0 0"></path></defs><use xlink:href="#shape"></use><text>雪 &amp; café</text></svg>';
  const document = await readDocument({ bytes: new TextEncoder().encode(markup) }, { from: "html" }, {});
  expect(document.blocks).toEqual([{ t: "Plain", c: [
    { t: "Image", c: [["", [], []], [], ["data:image/svg+xml;base64," + Buffer.from(markup).toString("base64"), ""]] }
  ] }]);
});

it("accounts for the embedded SVG in the retained memory budget", async () => {
  await expect(readDocument({ bytes: new TextEncoder().encode(svg) }, { from: "html" }, {
    limits: { retainedBytes: 2000 }
  })).rejects.toMatchObject({ code: "E_LIMIT" });
});
