import { describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";

describe("Union", () => {
  it("accepts distinct required keys containing separator characters", () => {
    expect(() =>
      S.Union([
        S.Object({
          "a+b": S.String()
        }),
        S.Object({
          a: S.String(),
          b: S.String()
        })
      ])
    ).not.toThrow();
  });

  it("reports offending branch indices for duplicate required-key fingerprints", () => {
    expect(() =>
      S.Union([
        S.Object({
          email: S.String(),
          verified: S.Optional(S.Boolean())
        }),
        S.Object({
          email: S.Number()
        }),
        S.Object({
          phone: S.String()
        })
      ])
    ).toThrow(
      'Union branches [0, 1] share required-key fingerprint "email". Each branch must require a distinct set of keys.'
    );
  });
});
