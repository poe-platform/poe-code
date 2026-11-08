import assert from "node:assert/strict";
import test from "node:test";
import { createLlmService } from "./service.js";
import type { LlmRequest } from "./types.js";
import { validateModelOptions } from "./model-options.js";

test("declared boolean options accept the pinned reference's case-insensitive shorthand", () => {
  const model = { id: "model", options: { enabled: { type: "boolean" as const } } };
  for (const [input, expected] of [["y", true], ["Y", true], ["t", true], ["T", true], ["n", false], ["N", false], ["f", false], ["F", false]] as const) {
    assert.deepEqual(validateModelOptions(model, { enabled: input }), { enabled: expected });
  }
});

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
