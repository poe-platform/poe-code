import { describe, expect, it } from "vitest";

import { redact } from "./redact.js";

describe("redact", () => {
  it("truncates strings whose UTF-8 byte length exceeds 65536", () => {
    expect(redact("a".repeat(65_537))).toBe("[truncated:65537]");
  });

  it("redacts buffers with a null byte in the first 1024 bytes", () => {
    const value = Buffer.from([1, 2, 0, 3]);

    expect(redact(value)).toBe("[binary:4]");
  });

  it("redacts Uint8Arrays with a null byte in the first 1024 bytes", () => {
    const value = new Uint8Array([1, 2, 0, 3]);

    expect(redact(value)).toBe("[binary:4]");
  });

  it("does not redact binary values with a null byte after the first 1024 bytes", () => {
    const value = Buffer.alloc(1_026, 1);
    value[1_025] = 0;

    expect(redact(value)).toBe(value);
  });

  it("truncates the whole value when its JSON-serialized size exceeds 262144 bytes", () => {
    const value = { payload: "a".repeat(262_145) };
    const originalBytes = Buffer.byteLength(JSON.stringify(value), "utf8");

    expect(redact(value)).toBe(`[truncated:${originalBytes}]`);
  });

  it("recurses into nested structures and preserves unaffected leaves", () => {
    const input = {
      id: 123,
      name: "run",
      events: [
        { output: "ok", data: Buffer.from([1, 0, 2]) },
        { output: "é".repeat(32_769), data: new Uint8Array([1, 2, 3]) }
      ],
      enabled: true,
      missing: null
    };

    expect(redact(input)).toEqual({
      id: 123,
      name: "run",
      events: [
        { output: "ok", data: "[binary:3]" },
        { output: "[truncated:65538]", data: input.events[1].data }
      ],
      enabled: true,
      missing: null
    });
    expect(redact(input)).not.toBe(input);
  });

  it("redacts sensitive keys in nested env and header objects", () => {
    expect(
      redact({
        env: {
          PATH: "/usr/bin",
          OPENAI_API_KEY: "sk-env",
          sessionToken: "session-token"
        },
        headers: {
          Accept: "application/json",
          Authorization: "Bearer header-token",
          "x-api-key": "header-key"
        },
        apiKey: "direct-key",
        token: "direct-token",
        secret: "direct-secret",
        prompt_tokens: 12,
        toolCallId: "tc-1"
      })
    ).toEqual({
      env: {
        PATH: "/usr/bin",
        OPENAI_API_KEY: "[redacted]",
        sessionToken: "[redacted]"
      },
      headers: {
        Accept: "application/json",
        Authorization: "[redacted]",
        "x-api-key": "[redacted]"
      },
      apiKey: "[redacted]",
      token: "[redacted]",
      secret: "[redacted]",
      prompt_tokens: 12,
      toolCallId: "tc-1"
    });
  });

  it("redacts bearer tokens and assigned API-key strings without dropping surrounding text", () => {
    expect(
      redact("curl -H 'Authorization: Bearer abc.def' https://x.test api_key=sk-test token: tok123")
    ).toBe(
      "curl -H 'Authorization: Bearer [redacted]' https://x.test api_key=[redacted] token: [redacted]"
    );
  });

  it("redacts Basic and token authorization header credentials in strings", () => {
    expect(
      redact(
        [
          "Authorization: Basic dXNlcjpwYXNz",
          "Proxy-Authorization: Token secret-token",
          'curl -H "Authorization: token ghp_1234567890abcdef" https://api.github.com'
        ].join("\n")
      )
    ).toBe(
      [
        "Authorization: Basic [redacted]",
        "Proxy-Authorization: Token [redacted]",
        'curl -H "Authorization: token [redacted]" https://api.github.com'
      ].join("\n")
    );
  });

  it("redacts flattened cookie header values in strings", () => {
    expect(
      redact(
        [
          "Cookie: sessionid=sess-123; theme=light",
          "Set-Cookie: sid=sess-456; HttpOnly; Secure",
          'curl -H "Cookie: sid=sess-789" https://example.test'
        ].join("\n")
      )
    ).toBe(
      [
        "Cookie: [redacted]",
        "Set-Cookie: [redacted]",
        'curl -H "Cookie: [redacted]" https://example.test'
      ].join("\n")
    );
  });

  it("redacts URL userinfo credentials in strings", () => {
    expect(
      redact(
        "fetch https://alice:secret-password@example.com/private and postgres://bob:db-password@db.example/app"
      )
    ).toBe("fetch https://[redacted]@example.com/private and postgres://[redacted]@db.example/app");
  });

  it("redacts env-style and quoted assigned secret strings", () => {
    const input = [
      "OPENAI_API_KEY=sk-live",
      'OPENAI_API_KEY="sk-quoted"',
      'token: "tok123"',
      'password="pw123"',
      "prompt_tokens=12"
    ].join(" ");

    expect(redact(input)).toBe(
      [
        "OPENAI_API_KEY=[redacted]",
        'OPENAI_API_KEY="[redacted]"',
        'token: "[redacted]"',
        'password="[redacted]"',
        "prompt_tokens=12"
      ].join(" ")
    );
  });

  it("replaces cyclic references without throwing", () => {
    const value: Record<string, unknown> = { output: "ok" };
    value.self = value;

    expect(redact(value)).toEqual({
      output: "ok",
      self: "[circular]"
    });
  });
});
