import test from "node:test";
import assert from "node:assert/strict";
import { createGhClient, resolveAuth } from "../dist/backends/gh-issues-client.js";
import { ghIssuesBackend } from "../dist/backends/gh-issues.js";
test("GraphQL native JSON preserves data priority and own proto properties", async () => {
  const response =
    '{"data":{"__proto__":{"safe":true},"name":"\\ud800","huge":1e400},"errors":[{"message":"ignored"}]}';
  const client = createGhClient({ token: "test", fetch: async () => new Response(response) });
  const data = await client.graphql("mock", {});
  assert.ok(Object.hasOwn(data, "__proto__"));
  assert.equal(data.name, "\ud800");
  assert.equal(data.huge, Infinity);
  assert.equal(await resolveAuth({ explicitToken: "" }), "");
  const malformed = createGhClient({ token: "test", fetch: async () => new Response("{invalid") });
  await assert.rejects(() => malformed.graphql("mock", {}), SyntaxError);
});
test("invalid GitHub identities reject before any network call", async () => {
  let calls = 0;
  const fetch = async () => {
    calls++;
    throw Error("no network");
  };
  await assert.rejects(
    () =>
      ghIssuesBackend({
        repo: "a/b/c",
        token: "test",
        fetch,
        defaults: { metadata: {} },
        state: { labelPrefix: "state:" },
        stateMachine: { initial: "draft", states: ["draft"], events: {} }
      }),
    /Invalid GitHub repository/
  );
  assert.equal(calls, 0);
  const backend = await ghIssuesBackend({
    repo: "a/b",
    token: "test",
    fetch,
    defaults: { metadata: {} },
    state: { labelPrefix: "state:" },
    stateMachine: { initial: "draft", states: ["draft"], events: {} }
  });
  for (const id of ["01", "1e2", "9007199254740992", "\ud800"])
    await assert.rejects(() => backend.list("a/b").get(id), /not found/);
  assert.equal(calls, 0);
});
