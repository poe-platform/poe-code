import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, ToolError } from "../dist/index.js";
import {
  createServer as referenceCreateServer,
  ToolError as ReferenceToolError
} from "tiny-stdio-mcp-server";

const metadata = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {}
};

function register(server) {
  server.prompt(
    { name: "review", description: "Review", arguments: [{ name: "code", required: true }] },
    (args, context) => ({
      messages: [{ role: "user", content: { type: "text", text: args.code } }],
      description: context.clientCapabilities.marker === undefined ? "legacy" : "modern"
    })
  );
  server.resource(
    { uri: "memo://welcome", name: "welcome", icons: [{ src: "https://example.test/icon" }] },
    (uri) => ({ contents: [{ uri, text: "exact" }] })
  );
  server.resourceTemplate({ uriTemplate: "memo://{name}", name: "memo" }, (uri) => ({
    contents: [{ uri, text: "template" }]
  }));
  server.resourceTemplate({ uriTemplate: "search://{?query,limit}", name: "search" }, (uri) => ({
    contents: [{ uri, blob: "YQ==" }],
    ttlMs: 12,
    cacheScope: "public"
  }));
  for (const name of ["custom/echo", "__proto__", "constructor", "toString"])
    server.method(name, (params) => ({ value: params?.value ?? "default" }));
  return server;
}

test("feature discovery, prompt arguments, resource resolution and custom methods match reference", async () => {
  for (const modern of [false, true]) {
    const native = register(createServer({ name: "test", version: "0" })),
      reference = register(referenceCreateServer({ name: "test", version: "0" }));
    if (!modern) for (const server of [native, reference]) await server.handleMessage("initialize");
    for (const [method, params] of [
      ["prompts/list", {}],
      ["resources/list", {}],
      ["resources/templates/list", {}],
      ["prompts/get", {}],
      ["prompts/get", { name: "missing" }],
      ["prompts/get", { name: "review" }],
      ["prompts/get", { name: "review", arguments: { code: 1 } }],
      ["prompts/get", { name: "review", arguments: [] }],
      ["prompts/get", { name: "review", arguments: { code: "main.rs" } }],
      ["resources/read", {}],
      ["resources/read", { uri: "relative" }],
      ["resources/read", { uri: "other://missing" }],
      ["resources/read", { uri: "memo://welcome" }],
      ["resources/read", { uri: "memo://another" }],
      ["resources/read", { uri: "search://?query=mcp&limit=2" }],
      ["custom/echo", { value: "hello" }],
      ["__proto__", {}],
      ["constructor", {}],
      ["toString", {}]
    ]) {
      const request = {
        ...params,
        ...(modern
          ? { _meta: { ...metadata, "io.modelcontextprotocol/clientCapabilities": { marker: {} } } }
          : {})
      };
      assert.deepEqual(
        await native.handleMessage(method, request),
        await reference.handleMessage(method, request),
        JSON.stringify({ method, request })
      );
    }
  }
});

test("registration snapshots, duplicate errors and feature removal preserve reference behavior", async () => {
  const native = createServer({ name: "test", version: "0" }),
    reference = referenceCreateServer({ name: "test", version: "0" });
  for (const server of [native, reference]) {
    const prompt = { name: "review", arguments: [{ name: "code", required: true }] };
    server.prompt(prompt, () => ({ messages: [] }));
    prompt.arguments[0].required = false;
    server.resource({ uri: "memo://welcome", name: "welcome" }, (uri) => ({
      contents: [{ uri, text: "hello" }]
    }));
    server.resourceTemplate({ uriTemplate: "memo://{name}", name: "memo" }, (uri) => ({
      contents: [{ uri, text: "hello" }]
    }));
    await server.handleMessage("initialize");
  }
  for (const [api, definition] of [
    ["prompt", { name: "review" }],
    ["resource", { uri: "memo://welcome", name: "welcome" }],
    ["resourceTemplate", { uriTemplate: "memo://{name}", name: "memo" }],
    ["prompt", { name: "" }],
    ["resource", { uri: "relative", name: "bad" }],
    ["resourceTemplate", { uriTemplate: "relative/{name}", name: "bad" }],
    ["resourceTemplate", { uriTemplate: "memo://{", name: "bad" }]
  ]) {
    let expected;
    try {
      reference[api](definition, () => ({}));
    } catch (error) {
      expected = error.message;
    }
    assert.notEqual(expected, undefined);
    assert.throws(() => native[api](definition, () => ({})), { message: expected });
  }
  assert.deepEqual(
    await native.handleMessage("prompts/get", { name: "review" }),
    await reference.handleMessage("prompts/get", { name: "review" })
  );
  for (const [api, id] of [
    ["removePrompt", "review"],
    ["removeResource", "memo://welcome"],
    ["removeResourceTemplate", "memo://{name}"]
  ]) {
    assert.equal(native[api](id), reference[api](id));
    assert.equal(native[api](id), reference[api](id));
  }
  for (const method of ["prompts/list", "resources/list", "resources/templates/list"])
    assert.deepEqual(await native.handleMessage(method), await reference.handleMessage(method));
});

test("feature results and callback errors enforce negotiated prompt content and resource schemas", async () => {
  for (const version of ["2025-03-26", "2025-11-25", "modern"]) {
    for (const [kind, results] of [
      [
        "prompt",
        [
          undefined,
          null,
          {},
          { messages: [] },
          { messages: [{ role: "system", content: { type: "text", text: "bad" } }] },
          {
            messages: [
              {
                role: "user",
                content: { type: "resource_link", uri: "file:///document", name: "document" }
              }
            ]
          },
          {
            messages: [
              { role: "assistant", content: { type: "audio", data: "YQ==", mimeType: "audio/wav" } }
            ]
          }
        ]
      ],
      [
        "resource",
        [
          undefined,
          null,
          {},
          { contents: [] },
          { contents: [{ uri: "memo://x", blob: "bad" }] },
          { contents: [{ uri: "memo://x", text: "valid" }], ttlMs: -1 },
          { contents: [{ uri: "memo://x", text: "valid" }], cacheScope: "wrong" }
        ]
      ],
      ["method", [undefined, null, 1, { value: 1 }, { resultType: "unknown" }]]
    ]) {
      for (const result of results) {
        const native = createServer({ name: "test", version: "0" }),
          reference = referenceCreateServer({ name: "test", version: "0" });
        const definition =
          kind === "prompt"
            ? { name: "check" }
            : kind === "resource"
              ? { uri: "memo://x", name: "check" }
              : "custom/check";
        for (const server of [native, reference]) {
          server[kind](definition, () => result);
          if (version !== "modern")
            await server.handleMessage("initialize", { protocolVersion: version });
        }
        const method =
          kind === "prompt"
            ? "prompts/get"
            : kind === "resource"
              ? "resources/read"
              : "custom/check";
        const params = {
          ...(kind === "prompt"
            ? { name: "check" }
            : kind === "resource"
              ? { uri: "memo://x" }
              : {}),
          ...(version === "modern" ? { _meta: metadata } : {})
        };
        assert.deepEqual(
          await native.handleMessage(method, params),
          await reference.handleMessage(method, params),
          JSON.stringify({ version, kind, result })
        );
      }
      for (const special of [false, true]) {
        const native = createServer({ name: "test", version: "0" }),
          reference = referenceCreateServer({ name: "test", version: "0" });
        const definition =
          kind === "prompt"
            ? { name: "check" }
            : kind === "resource"
              ? { uri: "memo://x", name: "check" }
              : "custom/check";
        native[kind](definition, () => {
          throw special
            ? new ToolError(-32010, "failure", { reason: "policy" })
            : new Error("failure");
        });
        reference[kind](definition, () => {
          throw special
            ? new ReferenceToolError(-32010, "failure", { reason: "policy" })
            : new Error("failure");
        });
        for (const server of [native, reference])
          if (version !== "modern")
            await server.handleMessage("initialize", { protocolVersion: version });
        const method =
          kind === "prompt"
            ? "prompts/get"
            : kind === "resource"
              ? "resources/read"
              : "custom/check";
        const params = {
          ...(kind === "prompt"
            ? { name: "check" }
            : kind === "resource"
              ? { uri: "memo://x" }
              : {}),
          ...(version === "modern" ? { _meta: metadata } : {})
        };
        assert.deepEqual(
          await native.handleMessage(method, params),
          await reference.handleMessage(method, params)
        );
      }
    }
  }
});

test("feature cancellation preserves global capacity until its callback settles", async () => {
  const native = createServer({ name: "test", version: "0", maxActiveRequests: 1 });
  let release, signal;
  const settled = new Promise((resolve) => {
    release = resolve;
  });
  native.prompt({ name: "pending" }, (_args, context) => {
    signal = context.signal;
    return settled;
  });
  await native.handleMessage("initialize");
  const pending = native.handleMessage("prompts/get", { name: "pending" }, { requestId: "one" });
  await Promise.resolve();
  assert.equal((await native.handleMessage("resources/list")).error.code, -32000);
  await native.handleMessage("notifications/cancelled", { requestId: "one" });
  assert.equal(signal.aborted, true);
  assert.deepEqual(await pending, { result: undefined });
  assert.equal((await native.handleMessage("resources/list")).error.code, -32000);
  release({ messages: [] });
  await settled;
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(await native.handleMessage("resources/list"), { result: { resources: [] } });
});
