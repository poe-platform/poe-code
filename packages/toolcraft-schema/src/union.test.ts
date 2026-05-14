import { describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";

describe("Union", () => {
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
