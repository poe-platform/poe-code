import assert from "node:assert/strict";
import test from "node:test";
import { createLlmService } from "./service.js";
import type { LlmRequest } from "./types.js";

test("declared model options reject before provider invocation and reach transport as typed values", async () => {
  const requests: LlmRequest[] = [];
  const rules = { temperature: { type: "number" as const, minimum: 0, maximum: 2 }, seed: { type: "integer" as const }, enabled: { type: "boolean" as const } };
  const service = createLlmService({ defaultModel: "model", providers: [{ name: "fixture", models: [{ id: "model", options: rules }], async *complete(request) { requests.push(request); yield "ok"; } }] });
  rules.temperature.maximum = 99;
  const request = { prompt: "test", attachments: [], signal: new AbortController().signal };
  for (const options of [{ unknown: "x" }, { temperature: "bad" }, { temperature: "2.1" }, { seed: "1.5" }, { enabled: "perhaps" }]) {
    assert.throws(() => service.complete({ ...request, options }), /unknown|temperature|seed|enabled/);
    assert.equal(requests.length, 0);
  }
  for (const temperature of ["0", "2"]) {
    for await (const unused of service.complete({ ...request, options: { temperature, seed: "7", enabled: "false" } })) assert.equal(unused, "ok");
    assert.deepEqual(requests.at(-1)?.options, { temperature: Number(temperature), seed: 7, enabled: false });
  }
});
