import { describe, expect, it, vi } from "vitest";
import { redactHttpBody } from "./redaction.js";

describe("HTTP body redaction", () => {
  it("redacts the actual JSON representation without preserving callable serializers", () => {
    const toJSON = vi.fn(() => ({ password: "serialized-secret", label: "visible" }));

    const redacted = redactHttpBody({ toJSON });

    expect(redacted).toEqual({ password: "<redacted>", label: "visible" });
    expect(JSON.stringify(redacted)).not.toContain("serialized-secret");
    expect(toJSON).toHaveBeenCalledTimes(1);
    expect(toJSON).toHaveBeenCalledWith("");
  });

  it("preserves Date JSON representations", () => {
    const timestamp = new Date("2026-09-05T00:00:00.000Z");

    expect(redactHttpBody({ timestamp })).toEqual({ timestamp: timestamp.toISOString() });
  });

  it("does not invoke a serializer returned by another serializer", () => {
    const nestedSerializer = vi.fn(() => ({ password: "unexpected-secret" }));
    const body = { toJSON: () => ({ label: "visible", toJSON: nestedSerializer }) };

    const redacted = redactHttpBody(body);

    expect(JSON.stringify(redacted)).toBe('{"label":"visible"}');
    expect(nestedSerializer).not.toHaveBeenCalled();
  });

  it("handles serializers returning themselves without retaining a callable hook", () => {
    const body = {
      password: "self-secret",
      toJSON: vi.fn(function () { return body; })
    };

    const redacted = redactHttpBody(body);

    expect(JSON.stringify(redacted)).toBe('{"password":"<redacted>"}');
    expect(body.toJSON).toHaveBeenCalledTimes(1);
  });

  it("terminates a cycle through a serializer result", () => {
    const body = { toJSON: () => ({ parent: body, label: "visible" }) };

    expect(redactHttpBody(body)).toEqual({ parent: "[Circular]", label: "visible" });
  });

  it.each([
    ["array", Object.assign([1], { toJSON: () => ({ password: "array-secret" }) })],
    ["function", Object.assign(() => undefined, { toJSON: () => ({ password: "function-secret" }) })]
  ])("redacts %s serialization hooks", (_name, body) => {
    const redacted = redactHttpBody(body);

    expect(redacted).toEqual({ password: "<redacted>" });
    expect(JSON.stringify(redacted)).toBe('{"password":"<redacted>"}');
  });

  it("redacts repeated object references without labelling them circular", () => {
    const shared = { label: "visible", password: "secret" };

    expect(redactHttpBody({ first: shared, second: shared })).toEqual({
      first: { label: "visible", password: "<redacted>" },
      second: { label: "visible", password: "<redacted>" }
    });
    expect(shared.password).toBe("secret");
  });

  it("redacts repeated array references without labelling them circular", () => {
    const shared = [{ label: "visible", access_token: "secret" }];

    expect(redactHttpBody({ first: shared, second: shared })).toEqual({
      first: [{ label: "visible", access_token: "<redacted>" }],
      second: [{ label: "visible", access_token: "<redacted>" }]
    });
    expect(shared[0]?.access_token).toBe("secret");
  });

  it("still terminates actual object cycles", () => {
    const body: Record<string, unknown> = { password: "secret" };
    body.self = body;

    expect(redactHttpBody(body)).toEqual({ password: "<redacted>", self: "[Circular]" });
  });

  it("still terminates actual array cycles", () => {
    const body: unknown[] = [{ password: "secret" }];
    body.push(body);

    expect(redactHttpBody(body)).toEqual([{ password: "<redacted>" }, "[Circular]"]);
  });
});
