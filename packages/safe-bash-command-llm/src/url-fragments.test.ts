import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import { createLlmCommand } from "./command.js";
import type { LlmSourceRequest } from "./types.js";

// Captured through llm 0.27.1's HTTPX response.text path.
const fixtures = [
  { header: "text/plain; charset=cp037", bytes: [193, 194, 195, 21, 255], text: "ABC\u0085\u009f" },
  { header: "text/plain; charset=iso8859-15", bytes: [164, 166, 188], text: "€ŠŒ" },
  { header: "text/plain; charset=mac_roman", bytes: [128, 219, 240], text: "Ä€\uf8ff" },
  { header: null, bytes: [65, 13, 10, 66, 13, 67], text: "A\r\nB\rC" },
  {
    header: 'text/plain; charset="utf-8"',
    bytes: [239, 187, 191, 240, 159, 153, 130, 255],
    text: "\ufeff🙂�"
  },
  { header: "text/plain; charset=latin-1", bytes: [128, 233, 255], text: "\u0080éÿ" },
  { header: "text/plain; charset=ascii", bytes: [65, 128, 255], text: "A��" },
  { header: "text/plain; charset=windows-1252", bytes: [128, 129, 233], text: "€�é" },
  { header: "text/plain; charset=unknown", bytes: [195, 169, 255], text: "é�" },
  { header: 'text/plain; other="x;charset=ascii"; charset=UTF-8', bytes: [195, 169], text: "é" }
];
for (const streamed of [false, true])
  for (const [index, fixture] of fixtures.entries())
    test(`URL fragment reference ${index}, source=${streamed}`, async () => {
      const fs = new MemoryFileSystem();
      let calls = 0,
        error = "",
        fetches = 0;
      const verify = (prompt: string) => {
        calls++;
        assert.equal(prompt, fixture.text + "\nquestion");
      };
      const command = createLlmCommand({
        defaultModel: "fixture",
        providers: [
          {
            name: "fixture",
            models: [{ id: "fixture" }],
            async *complete(request) {
              verify(request.prompt);
              yield "ok";
            },
            ...(streamed
              ? {
                  async *completeSources(request: LlmSourceRequest) {
                    const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
                    let prompt = "";
                    for await (const bytes of request.prompt.bytes)
                      prompt += decoder.decode(bytes, { stream: true });
                    verify(prompt + decoder.decode());
                    yield "ok";
                  }
                }
              : {})
          }
        ]
      });
      const result = await command.execute({
        command: "llm",
        args: ["-f", "https://example.test/context", "question"],
        fs,
        cwd: "/",
        env: {},
        signal: new AbortController().signal,
        stdin: toByteSource(""),
        stdout: { async write() {} },
        stderr: {
          async write(bytes) {
            error += new TextDecoder().decode(bytes);
          }
        },
        capabilities: {
          fetch: async (url, init) => {
            fetches++;
            assert.equal(String(url), "https://example.test/context");
            assert.equal(init?.redirect, "manual");
            let offset = 0;
            return new Response(
              new ReadableStream({
                pull(controller) {
                  if (offset === fixture.bytes.length) controller.close();
                  else controller.enqueue(Uint8Array.of(fixture.bytes[offset++]!));
                }
              }),
              { headers: fixture.header ? { "content-type": fixture.header } : {} }
            );
          }
        }
      });
      assert.equal(result.exitCode, 0, error);
      assert.equal(calls, 1);
      assert.equal(fetches, 1);
      assert.deepEqual(await fs.readdir("/"), []);
    });

for (const redirects of [3, 4])
  test(`URL fragments allow at most three redirects, requested=${redirects}`, async () => {
    const { createLlmUrlFragmentSource } = await import("./url-fragment-source.js");
    let calls = 0,
      cancelled = 0;
    const source = createLlmUrlFragmentSource({
      url: "https://example.test/context",
      signal: new AbortController().signal,
      fetch: async (url, init) => {
        assert.equal(
          String(url),
          calls === 0 ? "https://example.test/context" : `https://example.test/next${calls}`
        );
        assert.equal(init?.redirect, "manual");
        calls++;
        if (calls <= redirects)
          return new Response(
            new ReadableStream(
              {
                cancel() {
                  cancelled++;
                }
              },
              { highWaterMark: 0 }
            ),
            { status: 302, headers: { location: `/next${calls}` } }
          );
        return new Response("done");
      }
    });
    const read = async () => {
      let text = "";
      for await (const bytes of source.bytes) text += new TextDecoder().decode(bytes);
      return text;
    };
    if (redirects === 3) assert.equal(await read(), "done");
    else await assert.rejects(read, /Exceeded maximum allowed redirects/);
    assert.equal(calls, 4);
    assert.equal(cancelled, redirects);
    await source.dispose();
  });

for (const location of ["file:///private/context", "https://user:password@example.test/context"])
  test(`URL fragment rejects redirect capability escape ${location}`, async () => {
    const { createLlmUrlFragmentSource } = await import("./url-fragment-source.js");
    let calls = 0,
      cancelled = 0;
    const source = createLlmUrlFragmentSource({
      url: "https://example.test/context",
      signal: new AbortController().signal,
      fetch: async () => {
        calls++;
        return new Response(
          new ReadableStream(
            {
              cancel() {
                cancelled++;
              }
            },
            { highWaterMark: 0 }
          ),
          { status: 302, headers: { location } }
        );
      }
    });
    await assert.rejects(async () => {
      for await (const bytes of source.bytes) void bytes;
    }, /HTTP\(S\) without credentials/);
    assert.equal(calls, 1);
    assert.equal(cancelled, 1);
  });

test("URL fragment cancellation releases a late redirected response", async () => {
  const { createLlmUrlFragmentSource } = await import("./url-fragment-source.js");
  const controller = new AbortController();
  let started!: () => void,
    resolveResponse!: (response: Response) => void,
    cancelled = 0,
    calls = 0;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const source = createLlmUrlFragmentSource({
    url: "https://example.test/context",
    signal: controller.signal,
    fetch: async () => {
      if (++calls === 1)
        return new Response(null, { status: 302, headers: { location: "/later" } });
      started();
      return new Promise((resolve) => {
        resolveResponse = resolve;
      });
    }
  });
  const read = (async () => {
    for await (const bytes of source.bytes) void bytes;
  })();
  await ready;
  controller.abort(new Error("stop fragments"));
  await assert.rejects(read, /stop fragments/);
  resolveResponse(
    new Response(
      new ReadableStream(
        {
          cancel() {
            cancelled++;
          }
        },
        { highWaterMark: 0 }
      )
    )
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, 1);
  await source.dispose();
});

for (const budget of ["success", "shell", "buffered", "total"] as const)
  test(`URL fragment accounts raw and decoded bytes separately: ${budget}`, async () => {
    const fs = new MemoryFileSystem();
    let error = "",
      calls = 0,
      cancelled = 0,
      charged = 0;
    const command = createLlmCommand({
      defaultModel: "fixture",
      limits: {
        maxInputBytes: budget === "total" ? 40 : 10000,
        maxBufferedInputBytes: budget === "buffered" ? 40 : 10000
      },
      providers: [
        {
          name: "fixture",
          models: [{ id: "fixture" }],
          async *complete(request) {
            calls++;
            assert.equal(request.prompt, "€".repeat(10));
            yield "ok";
          }
        }
      ]
    });
    const result = await command.execute({
      command: "llm",
      args: ["-f", "https://example.test/context"],
      fs,
      cwd: "/",
      env: {},
      signal: new AbortController().signal,
      inputBudget: {
        maxBytes: budget === "shell" ? 5 : 10,
        check(size) {
          charged = size;
          if (size > (budget === "shell" ? 5 : 10)) throw new Error("shell input cap");
        }
      },
      stdin: toByteSource(""),
      stdout: { async write() {} },
      stderr: {
        async write(bytes) {
          error += new TextDecoder().decode(bytes);
        }
      },
      capabilities: {
        fetch: async () => {
          let sent = false;
          return new Response(
            new ReadableStream(
              {
                pull(controller) {
                  if (sent) controller.close();
                  else {
                    sent = true;
                    controller.enqueue(new Uint8Array(10).fill(128));
                  }
                },
                cancel() {
                  cancelled++;
                }
              },
              { highWaterMark: 0 }
            ),
            { headers: { "content-type": "text/plain; charset=windows-1252" } }
          );
        }
      }
    });
    assert.equal(result.exitCode, budget === "success" ? 0 : 1, error);
    assert.equal(calls, budget === "success" ? 1 : 0);
    assert.equal(charged, 10);
    if (budget !== "success") assert.equal(cancelled, 1);
    assert.deepEqual(await fs.readdir("/"), []);
  });

for (const bytes of [[], [239], [239, 187], [239, 187, 191], [239, 187, 191, 65], [239, 65]])
  test(`URL UTF8 signature matches Python incremental EOF: ${bytes}`, async () => {
    const { createLlmUrlFragmentSource } = await import("./url-fragment-source.js");
    const source = createLlmUrlFragmentSource({
      url: "https://example.test/context",
      signal: new AbortController().signal,
      fetch: async () => {
        let i = 0;
        return new Response(
          new ReadableStream({
            pull(controller) {
              if (i === bytes.length) controller.close();
              else controller.enqueue(Uint8Array.of(bytes[i++]!));
            }
          }),
          { headers: { "content-type": "text/plain; charset=utf-8-sig" } }
        );
      }
    });
    let text = "";
    for await (const part of source.bytes) text += new TextDecoder().decode(part);
    assert.equal(text, bytes.at(-1) === 65 ? (bytes.length === 2 ? "�A" : "A") : "");
  });

test("empty URL fragment does not decode an otherwise unsupported charset", async () => {
  const { createLlmUrlFragmentSource } = await import("./url-fragment-source.js");
  const source = createLlmUrlFragmentSource({
    url: "https://example.test/context",
    signal: new AbortController().signal,
    fetch: async () =>
      new Response(null, { headers: { "content-type": "text/plain; charset=iso2022_jp" } })
  });
  for await (const bytes of source.bytes) assert.fail(`unexpected ${bytes.length} bytes`);
});
