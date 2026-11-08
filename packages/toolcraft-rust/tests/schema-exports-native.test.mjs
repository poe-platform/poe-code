import assert from "node:assert/strict";
import { test } from "node:test";
import * as root from "toolcraft-rust";
import * as schema from "toolcraft-rust/schema";
import * as reference from "toolcraft/schema";

test("schema subpath exposes the reference API and root schema functions", () => {
  assert.deepEqual(Object.keys(schema).sort(), Object.keys(reference).sort());
  assert.equal(root.S, schema.S);
  assert.equal(root.toJsonSchema, schema.toJsonSchema);
  assert.equal(root.withStandardSchema, schema.withStandardSchema);
});

test("native schema exports compose with commands and managed streams", async () => {
  const params = schema.S.Object({ label: schema.S.String() });
  const command = root.defineCommand({ name: "echo", params, handler: ({ params }) => params.label });
  assert.equal(command.params, params);
  assert.deepEqual(root.toJsonSchema(params), reference.toJsonSchema(params));
  const standard = root.withStandardSchema(params);
  assert.deepEqual(standard["~standard"].validate({ label: "ready" }), { value: { label: "ready" } });
  const stream = root.createManagedStream({ eventSchema: schema.S.String(), create: async () => (async function* () { yield "ready"; })() });
  const values = [];
  for await (const value of stream) values.push(value);
  assert.deepEqual(values, ["ready"]);
});
