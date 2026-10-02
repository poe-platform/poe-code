import { expect, it } from "vitest";
import { Volume } from "memfs";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";

const body = '<w:p><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" id="box" style="width:10pt;height:20pt"><v:textbox><w:txbxContent><w:p><w:r><w:t>Original box</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>';
it("inventories and replaces box text through explicit memfs document capability", async () => {
  const input = await textFixture(body), volume = Volume.fromJSON({ "/work/input.docx": Buffer.from(input) }); let reads = 0;
  const run = async (words: string[]) => {
    let stdout = "", stderr = "";
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: words.map(value => new TextEncoder().encode(value)), cwd: "/work", signal: textContext.signal,
      filesystem: { async readFile(path) { reads++; return new Uint8Array(volume.readFileSync(path) as Buffer); }, readStream(path) { reads++; return { async *[Symbol.asyncIterator]() { yield new Uint8Array(volume.readFileSync(path) as Buffer); } }; } },
      stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
    expect(result.exitCode, stderr).toBe(0); return JSON.parse(stdout);
  };
  const list = await run(["shapes", "list", "input.docx", "--json"]);
  expect(list.data.items).toHaveLength(1); expect(list.data.items[0]).toMatchObject({ kind: "shape", location: { kind: "shape" } });
  const set = await run(["shapes", "set", "input.docx", "--shape", "1", "--text", "Changed", "--dry-run", "--json"]);
  expect(set.affected).toBe(1); expect(reads).toBe(2); expect(volume.readFileSync("/work/input.docx")).toEqual(Buffer.from(input));
});
