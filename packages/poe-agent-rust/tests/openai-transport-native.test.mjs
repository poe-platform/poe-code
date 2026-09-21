import { test } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { getEventListeners } from "node:events";
import OwnOpenAI from "../dist/openai-transport.js";

const encoder = new TextEncoder();
function response(text, split = text.length, onCancel = () => {}) {
  const bytes = encoder.encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
      cancel: onCancel
    }),
    { headers: { "content-type": "text/event-stream" } }
  );
}
const collect = async (stream) => {
  const result = [];
  for await (const event of stream) result.push(event);
  return result;
};

test("frame projection batches each read and delivers its valid prefix before a stream error", async () => {
  const client = new OwnOpenAI({
    apiKey: "test",
    fetch: async () =>
      response(
        'data: {"text":"one"}\n\ndata: {"text":"two"}\n\ndata: {"error":{"message":"failed"}}\n\n'
      )
  });
  const stream = await client.chat.completions.create({ stream: true });
  const batches = [],
    events = [];
  await assert.rejects(
    (async () => {
      for await (const event of stream.mapFrames((frames) => {
        batches.push(frames.length);
        return frames.map((frame) => frame.text);
      }))
        events.push(event);
    })(),
    { message: "failed" }
  );
  assert.deepEqual(events, ["one", "two"]);
  assert.deepEqual(batches, [2]);
});

test("Responses frame projection batches named events per network read", async () => {
  const client = new OwnOpenAI({
    apiKey: "test",
    fetch: async () =>
      response(
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"one"}\n\nevent: response.completed\ndata: {"type":"response.completed"}\n\n'
      )
  });
  const batches = [];
  const events = await collect(
    client.responses.stream({ model: "m", input: "hello" }).mapFrames((frames) => {
      batches.push(frames.length);
      return frames.map((frame) => frame.type);
    })
  );
  assert.deepEqual(events, ["response.output_text.delta", "response.completed"]);
  assert.deepEqual(batches, [2]);
});

test("abort cancels a returned stream even before its iterator is started", async () => {
  let canceled = 0;
  const controller = new AbortController(),
    reason = new Error("unconsumed");
  const client = new OwnOpenAI({
    apiKey: "test",
    fetch: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            canceled++;
          }
        })
      )
  });
  const stream = await client.chat.completions.create(
    { stream: true },
    { signal: controller.signal }
  );
  controller.abort(reason);
  await Promise.resolve();
  assert.equal(canceled, 1);
  await assert.rejects(collect(stream), (error) => error === reason);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("breaking a stream cancels its reader and removes the caller abort listener", async () => {
  let canceled = 0,
    wireSignal;
  const controller = new AbortController();
  const client = new OwnOpenAI({
    apiKey: "test",
    fetch: async (_url, init) => {
      wireSignal = init.signal;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"text":"first"}\n\n'));
          },
          cancel() {
            canceled++;
          }
        })
      );
    }
  });
  const stream = await client.chat.completions.create(
    { stream: true },
    { signal: controller.signal }
  );
  for await (const item of stream) {
    assert.equal(item.text, "first");
    break;
  }
  assert.equal(canceled, 1);
  assert.equal(wireSignal.aborted, true);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("caller abort releases a pending stream read and preserves the caller reason", async () => {
  let entered,
    canceled = 0;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const controller = new AbortController(),
    reason = new Error("caller stopped");
  const client = new OwnOpenAI({
    apiKey: "test",
    fetch: async () =>
      new Response(
        new ReadableStream({
          pull() {
            entered();
          },
          cancel() {
            canceled++;
          }
        })
      )
  });
  const outcome = collect(
    await client.chat.completions.create({ stream: true }, { signal: controller.signal })
  );
  await started;
  controller.abort(reason);
  await assert.rejects(outcome, (error) => error === reason);
  assert.equal(canceled, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("bounded error bodies cancel their readers without retaining caller listeners", async () => {
  let canceled = 0;
  const controller = new AbortController();
  const client = new OwnOpenAI({
    apiKey: "test",
    maxRetries: 0,
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(1048577));
          },
          cancel() {
            canceled++;
          }
        }),
        { status: 400 }
      )
  });
  await assert.rejects(
    client.chat.completions.create({ stream: true }, { signal: controller.signal }),
    { message: "Provider error response exceeds 1048576 bytes" }
  );
  assert.equal(canceled, 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("all byte splits preserve chat SSE output against the official SDK", async () => {
  const text =
    ': keepalive\r\ndata: {"choices":[{"delta":{"content":"🌍"}}]}\r\n\r\ndata: {"usage":{"prompt_tokens":2}}\n\ndata: [DONE]\n\ndata: {"ignored":true}\n\n';
  for (let split = 0; split <= encoder.encode(text).length; split++) {
    const fetch = async () => response(text, split);
    const options = { apiKey: "test", baseURL: "https://example.test/v1", fetch, maxRetries: 0 };
    const body = { model: "model", messages: [], stream: true };
    assert.deepEqual(
      await collect(await new OwnOpenAI(options).chat.completions.create(body)),
      await collect(await new OpenAI(options).chat.completions.create(body))
    );
  }
});

test("named Responses events and multiline data match SDK raw streams", async () => {
  const text =
    'event: response.output_text.delta\ndata: {"type":"response.output_text.delta",\ndata: "delta":"hello"}\n\nevent: response.completed\ndata: {"type":"response.completed","response":{"id":"resp1"}}\n\n';
  const options = { apiKey: "test", fetch: async () => response(text), maxRetries: 0 };
  const body = { model: "model", input: "hello" };
  assert.deepEqual(
    await collect(new OwnOpenAI(options).responses.stream(body)),
    await collect(await new OpenAI(options).responses.create({ ...body, stream: true }))
  );
});

test("request paths, JSON and application headers preserve SDK behavior", async () => {
  const requests = [];
  const options = {
    apiKey: "key",
    organization: "org",
    baseURL: "https://example.test/v1/",
    defaultHeaders: { "x-project": "own", authorization: "Bearer override" },
    maxRetries: 0,
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return response("data: [DONE]\n\n");
    }
  };
  const body = { model: "m", messages: [], stream: true };
  await collect(await new OwnOpenAI(options).chat.completions.create(body));
  await collect(await new OpenAI(options).chat.completions.create(body));
  const [own, sdk] = requests;
  assert.equal(own.url, sdk.url);
  assert.equal(own.init.body, sdk.init.body);
  for (const key of ["authorization", "openai-organization", "content-type", "x-project"])
    assert.equal(new Headers(own.init.headers).get(key), new Headers(sdk.init.headers).get(key));
});

test("HTTP and streamed API errors preserve SDK observable error fields", async () => {
  for (const status of [400, 401, 403, 404, 409, 422, 429, 500]) {
    const options = {
      apiKey: "test",
      maxRetries: 0,
      fetch: async () =>
        Response.json(
          {
            error: {
              message: "denied",
              code: "bad",
              type: "fixture",
              param: "model"
            }
          },
          { status, headers: { "x-request-id": "req1" } }
        )
    };
    const body = { model: "m", messages: [], stream: true };
    const get = async (Ctor) => {
      try {
        await collect(await new Ctor(options).chat.completions.create(body));
      } catch (error) {
        return [error.message, error.status, error.code, error.type, error.param, error.requestID];
      }
    };
    assert.deepEqual(await get(OwnOpenAI), await get(OpenAI));
  }
  const options = {
    apiKey: "test",
    maxRetries: 0,
    fetch: async () => response('data: {"error":{"message":"stream failed","code":"bad"}}\n\n')
  };
  await assert.rejects(
    collect(await new OwnOpenAI(options).chat.completions.create({ stream: true })),
    { message: "stream failed", code: "bad" }
  );
});

test("retry headers bound attempts and dispose rejected response bodies", async () => {
  for (const override of [undefined, "true", "false"]) {
    let calls = 0,
      canceled = 0;
    const client = new OwnOpenAI({
      apiKey: "test",
      maxRetries: 2,
      fetch: async () => {
        calls++;
        if (calls > 1) return response("data: [DONE]\n\n");
        if (override === "false")
          return Response.json(
            { error: { message: "stop" } },
            {
              status: 429,
              headers: { "x-should-retry": "false" }
            }
          );
        return new Response(
          new ReadableStream({
            cancel() {
              canceled++;
            }
          }),
          {
            status: override === "true" ? 400 : 429,
            headers: { "retry-after-ms": "1", ...(override ? { "x-should-retry": override } : {}) }
          }
        );
      }
    });
    const result = collect(
      await client.chat.completions.create({ stream: true }).catch(() => {
        assert.equal(override, "false");
        return [];
      })
    );
    if (override !== "false") {
      await result;
      assert.equal(calls, 2);
      assert.equal(canceled, 1);
    } else {
      await result;
      assert.equal(calls, 1);
    }
  }
});
