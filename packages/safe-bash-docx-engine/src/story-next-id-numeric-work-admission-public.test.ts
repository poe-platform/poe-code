import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as source from "./index.js";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

const compiled = await compiledPublicRuntime;
for (const runtime of ["source", "compiled"] as const) for (const zeroes of [4096, 8192]) for (const remaining of [1024, 2048])
it(`live story identity census admits complete numeric lexical work before scanning; runtime=${runtime}; zeroes=${zeroes}; remaining=${remaining}`, async () => {
  const api = runtime === "source" ? source : compiled;
  const comments = '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:f="urn:original:story-numeric-work" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:comment w:id="2" w:author="Archive"><w:p/></w:comment><f:opaque id="' + '0'.repeat(zeroes) + '31"/><!--retained--><?audit exact?></w:comments>';
  const input = await textFixture('<w:p><w:r><w:t>Unselected海🌊</w:t></w:r></w:p>', { comments: { kind: "comments", xml: comments } });
  const memory = Volume.fromJSON({ "/input": Buffer.from(input) }), original = new Uint8Array(memory.readFileSync("/input") as Buffer), budget = new api.DocumentBudget({ work: 512 * 1024 * 1024 });
  const document = await api.Document(original, { ...textContext, budget }), part = document.comments.get(2)!.part;
  expect(part.next_id).toBe(32);
  expect(part.next_id).toBe(32);
  budget.charge("work", budget.limits.work - budget.usage.work - remaining);
  expect(() => part.next_id).toThrow(api.ResourceLimitError);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(original);
});
