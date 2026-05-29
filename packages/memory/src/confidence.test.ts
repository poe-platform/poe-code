import { describe, expect, it } from "vitest";
import { TAG_RE, parseClaims, serializeTag } from "./confidence.js";
import type { ConfidenceTag } from "./types.js";

describe("TAG_RE", () => {
  it("matches memory tag comments and captures the verb", () => {
    const match = TAG_RE.exec(
      '<!-- memory:inferred confidence=0.7 source=pages/foo.md#L1-L2 note="derived from review" -->'
    );

    expect(match?.groups?.verb).toBe("inferred");
    expect(match?.groups?.rest).toContain("confidence=0.7");
  });

  it("does not match non-tag comments", () => {
    expect(TAG_RE.test("<!-- regular comment -->")).toBe(false);
  });
});

describe("parseClaims unsupported attributes", () => {
  it("reports constructor as unsupported rather than duplicated", () => {
    expect(() =>
      parseClaims("<!-- memory:ambiguous reason=uncertain constructor=visible -->\nClaim body")
    ).toThrow('ambiguous confidence tags do not support: "constructor"');
  });
});

describe("parseClaims", () => {
  it("returns an empty list when there are no confidence tags", () => {
    expect(parseClaims("# Memory\n\nNo tagged claims here.")).toEqual([]);
  });

  it("parses extracted, inferred, and ambiguous claims with line numbers and scope", () => {
    const body = [
      "# Superintendent",
      "",
      "<!-- memory:extracted source=packages/superintendent/src/phases.ts#L42-L58 note=primary -->",
      "The loop has four phases:",
      "build, inspect, review, checkpoint.",
      "",
      "<!-- memory:inferred confidence=0.7 note=derived -->",
      "Checkpoint frequency scales with phase duration.",
      "<!-- memory:ambiguous reason=conflict -->",
      "The inspect phase may retry up to 3 times on ENOENT."
    ].join("\n");

    expect(parseClaims(body)).toEqual([
      {
        tag: {
          verb: "extracted",
          source: {
            path: "packages/superintendent/src/phases.ts",
            startLine: 42,
            endLine: 58
          },
          note: "primary"
        },
        body: "The loop has four phases:\nbuild, inspect, review, checkpoint.",
        lineNumber: 3
      },
      {
        tag: {
          verb: "inferred",
          confidence: 0.7,
          note: "derived"
        },
        body: "Checkpoint frequency scales with phase duration.",
        lineNumber: 7
      },
      {
        tag: {
          verb: "ambiguous",
          reason: "conflict"
        },
        body: "The inspect phase may retry up to 3 times on ENOENT.",
        lineNumber: 9
      }
    ]);
  });

  it("supports CRLF input and quoted values", () => {
    const body = [
      "<!-- memory:inferred confidence=1 source=pages/incidents/foo.md#L3 note=\"quoted note\" -->",
      "First line of a claim.",
      "Second line of the same claim."
    ].join("\r\n");

    expect(parseClaims(body)).toEqual([
      {
        tag: {
          verb: "inferred",
          confidence: 1,
          source: {
            path: "pages/incidents/foo.md",
            startLine: 3
          },
          note: "quoted note"
        },
        body: "First line of a claim.\nSecond line of the same claim.",
        lineNumber: 1
      }
    ]);
  });

  it("throws when a required key is missing", () => {
    expect(() => parseClaims("<!-- memory:extracted note=missing-source -->\nClaim")).toThrow(
      /source/i
    );
    expect(() => parseClaims("<!-- memory:inferred source=pages/foo.md -->\nClaim")).toThrow(
      /confidence/i
    );
    expect(() => parseClaims("<!-- memory:ambiguous -->\nClaim")).toThrow(/reason/i);
  });

  it("throws when inferred confidence is outside the allowed range", () => {
    expect(() => parseClaims("<!-- memory:inferred confidence=0 -->\nClaim")).toThrow(
      /confidence/i
    );
    expect(() => parseClaims("<!-- memory:inferred confidence=1.2 -->\nClaim")).toThrow(
      /confidence/i
    );
  });

  it("throws when a tag is not followed by a claim paragraph", () => {
    expect(() =>
      parseClaims(["<!-- memory:ambiguous reason=missing -->", "", "# later"].join("\n"))
    ).toThrow(/claim/i);
  });
});

describe("serializeTag", () => {
  it("round-trips every verb through parseClaims", () => {
    const tags: ConfidenceTag[] = [
      {
        verb: "extracted",
        source: {
          path: "packages/superintendent/src/phases.ts",
          startLine: 42,
          endLine: 58
        },
        note: 'quoted "note"'
      },
      {
        verb: "inferred",
        confidence: 0.7,
        source: {
          path: "pages/incidents/2026-03-migration.md"
        },
        note: "derived from neighboring claims"
      },
      {
        verb: "ambiguous",
        reason: "conflicting notes in incidents log"
      }
    ];

    expect(
      tags.map((tag) => parseClaims(`${serializeTag(tag)}\nClaim body`)[0]?.tag)
    ).toEqual(tags);
  });
});
