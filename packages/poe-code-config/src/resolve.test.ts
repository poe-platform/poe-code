import { describe, expect, it } from "vitest";
import { resolveScope } from "./resolve.js";

const schema = {
  apiKey: {
    type: "string" as const,
    default: "",
    env: "POE_API_KEY",
    doc: "Poe API key"
  },
  timeout: {
    type: "number" as const,
    default: 30,
    env: "POE_TIMEOUT",
    doc: "Timeout in seconds"
  },
  enabled: {
    type: "boolean" as const,
    default: false,
    env: "POE_ENABLED",
    doc: "Whether feature is enabled"
  }
};

describe("resolveScope", () => {
  it("returns defaults when file and env are empty", () => {
    expect(resolveScope(schema)).toEqual({
      apiKey: "",
      timeout: 30,
      enabled: false
    });
  });

  it("prefers file values over defaults", () => {
    expect(
      resolveScope(schema, {
        apiKey: "file-key",
        timeout: 45,
        enabled: true
      })
    ).toEqual({
      apiKey: "file-key",
      timeout: 45,
      enabled: true
    });
  });

  it("prefers env values over file values", () => {
    expect(
      resolveScope(
        schema,
        {
          apiKey: "file-key",
          timeout: 45,
          enabled: false
        },
        {
          POE_API_KEY: "env-key",
          POE_TIMEOUT: "90",
          POE_ENABLED: "true"
        }
      )
    ).toEqual({
      apiKey: "env-key",
      timeout: 90,
      enabled: true
    });
  });

  it("coerces number and boolean env values", () => {
    expect(
      resolveScope(schema, undefined, {
        POE_TIMEOUT: "5",
        POE_ENABLED: "1"
      })
    ).toEqual({
      apiKey: "",
      timeout: 5,
      enabled: true
    });

    expect(
      resolveScope(schema, undefined, {
        POE_ENABLED: "0"
      })
    ).toEqual({
      apiKey: "",
      timeout: 30,
      enabled: false
    });
  });

  it("falls back to file values when env coercion fails", () => {
    expect(
      resolveScope(
        schema,
        {
          apiKey: "file-key",
          timeout: 45,
          enabled: true
        },
        {
          POE_TIMEOUT: "not-a-number",
          POE_ENABLED: "maybe"
        }
      )
    ).toEqual({
      apiKey: "file-key",
      timeout: 45,
      enabled: true
    });
  });
});
