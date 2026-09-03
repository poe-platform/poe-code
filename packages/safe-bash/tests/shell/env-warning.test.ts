import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";

const hostEnv = process.env as Record<string, string>;

test("warns when env is literally process.env, at most once per object", async (context) => {
  const warn = context.mock.method(console, "warn");
  const { shell } = setup({ env: hostEnv });
  assert.equal(warn.mock.calls.length, 1);
  const message = String(warn.mock.calls[0]?.arguments[0]);
  assert.match(message, /\[safe-bash\]/);
  assert.match(message, /process\.env/);
  assert.match(message, /secret/i);
  assert.match(message, /Cloudflare Workers/);
  setup({ env: hostEnv });
  assert.equal(warn.mock.calls.length, 1);
  await shell.exec("true", { env: hostEnv });
  assert.equal(warn.mock.calls.length, 1);
});

test("warns when constructor env is a shallow copy of process.env", (context) => {
  const warn = context.mock.method(console, "warn");
  const copy = { ...hostEnv };
  setup({ env: copy });
  assert.equal(warn.mock.calls.length, 1);
  setup({ env: copy });
  assert.equal(warn.mock.calls.length, 1);
});

test("warns when exec env is a shallow copy of process.env", async (context) => {
  const warn = context.mock.method(console, "warn");
  const { shell } = setup();
  const copy = { ...hostEnv };
  await shell.exec("true", { env: copy });
  assert.equal(warn.mock.calls.length, 1);
  await shell.exec("true", { env: copy });
  assert.equal(warn.mock.calls.length, 1);
});

test("does not warn for ordinary env objects", async (context) => {
  const warn = context.mock.method(console, "warn");
  const { shell } = setup({ env: { FOO: "bar" } });
  await shell.exec("true", { env: { BAZ: "qux" } });
  const firstKey = Object.keys(hostEnv)[0];
  if (firstKey !== undefined) await shell.exec("true", { env: { [firstKey]: hostEnv[firstKey]! } });
  assert.equal(warn.mock.calls.length, 0);
});
