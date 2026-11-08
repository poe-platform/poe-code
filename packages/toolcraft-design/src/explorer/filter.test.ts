import { afterEach, describe, expect, it, vi } from "vitest";
import { filterRows } from "./filter.js";
import type { Row } from "./state.js";

const rows: Row[] = [
  { id: "auth", title: "Auth Plan", subtitle: "token refresh", group: "Plans" },
  { id: "agent", title: "Agent Spawn", subtitle: "parallel workers", group: "Plans" },
  { id: "docs", title: "Docs", subtitle: "writing" }
];

describe("filterRows", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns every row in original order for an empty query", () => {
    expect(filterRows("", rows)).toEqual([
      { index: 0, score: 0, positions: [] },
      { index: 1, score: 0, positions: [] },
      { index: 2, score: 0, positions: [] }
    ]);
  });

  it("matches rows by subsequence across title and subtitle", () => {
    expect(filterRows("tfr", rows).map((match) => match.index)).toEqual([0]);
  });

  it("returns no matches for an impossible query or an empty row list", () => {
    expect(filterRows("missing", rows)).toEqual([]);
    expect(filterRows("anything", [])).toEqual([]);
  });

  it("is case-insensitive by default", () => {
    expect(filterRows("AUTH", rows).map((match) => match.index)).toEqual([0]);
  });

  it("can match case-sensitively", () => {
    expect(filterRows("AUTH", rows, { caseSensitive: true })).toEqual([]);
  });

  it("ranks consecutive runs above spread-out matches", () => {
    const matches = filterRows("abc", [
      { id: "spread", title: "a-b-c" },
      { id: "run", title: "abc" }
    ]);

    expect(matches.map((match) => match.index)).toEqual([1, 0]);
    expect(matches[0]?.score).toBeGreaterThan(matches[1]?.score ?? 0);
  });

  it("ranks start-of-word matches above middle-of-word matches", () => {
    const matches = filterRows("bc", [
      { id: "middle", title: "xbc" },
      { id: "word", title: "alpha beta charlie" }
    ]);

    expect(matches.map((match) => match.index)).toEqual([1, 0]);
  });

  it("reports matched character positions in the stripped comparison text", () => {
    expect(filterRows("ap", [{ id: "alpha", title: "Alpha" }])).toEqual([
      { index: 0, score: expect.any(Number), positions: [0, 2] }
    ]);
  });

  it("reports subtitle positions after the title separator", () => {
    expect(filterRows("token", [{ id: "auth", title: "Auth", subtitle: "token refresh" }])).toEqual(
      [{ index: 0, score: expect.any(Number), positions: [5, 6, 7, 8, 9] }]
    );
  });

  it("keeps original row order when scores tie", () => {
    expect(
      filterRows("ab", [
        { id: "first", title: "ab" },
        { id: "second", title: "ab" }
      ])
    ).toEqual([
      { index: 0, score: expect.any(Number), positions: [0, 1] },
      { index: 1, score: expect.any(Number), positions: [0, 1] }
    ]);
  });

  it("does not match group labels", () => {
    expect(
      filterRows("plans", [{ id: "auth", title: "Auth", subtitle: "token", group: "Plans" }])
    ).toEqual([]);
  });

  it("strips ANSI from titles and subtitles before matching", () => {
    const matches = filterRows("auth", [
      {
        id: "styled",
        title: "\u001b[31mAuth\u001b[0m",
        subtitle: "\u001b[2mPlan\u001b[0m"
      }
    ]);

    expect(matches).toEqual([{ index: 0, score: expect.any(Number), positions: [0, 1, 2, 3] }]);
  });

  it.each([
    ["😁🈀", undefined, false],
    ["😁🈀", undefined, true],
    ["😁", "🈀", false],
    ["😁", "🈀", true]
  ] as const)("does not assemble emoji from different characters in %s / %s (caseSensitive=%s)", (title, subtitle, caseSensitive) => {
    expect(filterRows("😀", [
      { id: "no", title, subtitle },
      { id: "yes", title: "😀" }
    ], { caseSensitive })).toEqual([
      { index: 1, score: expect.any(Number), positions: [0, 1] }
    ]);
  });

  it.each([
    ["😀", "😀", undefined, [0, 1]],
    ["😀🈀", "😀x🈀", undefined, [0, 1, 3, 4]],
    ["😀😀", "😀😀", undefined, [0, 1, 2, 3]],
    ["😀B", "😀", "B", [0, 1, 3]],
    ["B", "😀B", undefined, [2]],
    ["x", "😀", "x", [3]],
    ["👩💻", "👩‍💻", undefined, [0, 1, 3, 4]],
    ["\u0301", "e\u0301", undefined, [1]]
  ] as const)("reports UTF-16 spans for the code-point subsequence %s in %s / %s", (query, title, subtitle, positions) => {
    expect(filterRows(query, [{ id: "match", title, subtitle }])).toEqual([
      { index: 0, score: expect.any(Number), positions }
    ]);
  });

  it("scores adjacent code points once and keeps equal-score row order", () => {
    expect(filterRows("😀B", [
      { id: "spread", title: "😀xB" },
      { id: "adjacent", title: "😀B" },
      { id: "tied", title: "😀B" }
    ])).toEqual([
      { index: 1, score: 47, positions: [0, 1, 2] },
      { index: 2, score: 47, positions: [0, 1, 2] },
      { index: 0, score: 33, positions: [0, 1, 3] }
    ]);
  });

  it.each([
    ["abc", "abc", 71, [0, 1, 2]],
    ["abc", "a-b-c", 63, [0, 2, 4]],
    ["é文", "é文", 47, [0, 1]],
    ["B", "😀B", 11, [2]]
  ] as const)("preserves scoring for %s in %s", (query, title, score, positions) => {
    expect(filterRows(query, [{ id: "match", title }])).toEqual([{ index: 0, score, positions }]);
  });

  it("preserves case conversion, ANSI stripping, and cross-field offsets", () => {
    const styled = [{ id: "styled", title: "\u001b[31m𐐨\u001b[0m", subtitle: "\u001b[2mb\u001b[0m" }];

    expect(filterRows("𐐀B", styled)).toEqual([
      { index: 0, score: expect.any(Number), positions: [0, 1, 3] }
    ]);
    expect(filterRows("𐐀B", styled, { caseSensitive: true })).toEqual([]);
    expect(filterRows("𐐨b", styled, { caseSensitive: true })).toEqual([
      { index: 0, score: expect.any(Number), positions: [0, 1, 3] }
    ]);
  });

  it.each(["\ud83d", "\ude00"])("does not match a lone surrogate query %j inside an emoji", (query) => {
    expect(filterRows(query, [{ id: "emoji", title: "😀" }])).toEqual([]);
  });

  it("does not normalize combining sequences", () => {
    expect(filterRows("é", [{ id: "combining", title: "e\u0301" }])).toEqual([]);
  });

  it.each([
    ["a", "İab", undefined, [1]],
    ["x", "İ", "x", [2]],
    ["a", "İİab", undefined, [2]],
    ["B", "İ😀B", undefined, [3]],
    ["😀", "İ😀B", undefined, [1, 2]],
    ["ax", "\u001b[31mİa\u001b[0m", "\u001b[2mx\u001b[0m", [1, 3]],
    ["\u0301", "İE\u0301b", undefined, [2]],
    ["👩💻", "İ👩‍💻b", undefined, [1, 2, 4, 5]],
    ["İ", "İab", undefined, [0]],
    ["i", "İab", undefined, [0]],
    ["\u0307", "İab", undefined, [0]],
    ["İİ", "İİ", undefined, [0, 1]],
    ["\u0307\u0307", "İİ", undefined, [0, 1]]
  ] as const)("projects %s in %s / %s onto original stripped UTF-16 offsets", (query, title, subtitle, positions) => {
    expect(filterRows(query, [{ id: "match", title, subtitle }])).toEqual([
      { index: 0, score: expect.any(Number), positions }
    ]);
  });

  it("does not lowercase or broaden case-sensitive positions", () => {
    const lowerCase = vi.spyOn(String.prototype, "toLocaleLowerCase");
    const sensitiveRows = [{ id: "match", title: "İab" }];

    expect(filterRows("a", sensitiveRows, { caseSensitive: true })[0]?.positions).toEqual([1]);
    expect(filterRows("İ", sensitiveRows, { caseSensitive: true })[0]?.positions).toEqual([0]);
    expect(filterRows("i", sensitiveRows, { caseSensitive: true })).toEqual([]);
    expect(filterRows("\u0307", sensitiveRows, { caseSensitive: true })).toEqual([]);
    expect(lowerCase).not.toHaveBeenCalled();
  });

  it.each([
    ["ς", "İΟΣ", [2]],
    ["σ", "İΟΣ", undefined],
    ["σ", "İΟΣΑ", [2]],
    ["ς", "İΟΣΑ", undefined],
    ["ς", "ΟΣ", [1]],
    ["σ", "ΟΣΑ", [1]]
  ] as const)("retains whole-string Greek context for %s in %s", (query, title, positions) => {
    const matches = filterRows(query, [{ id: "match", title }]);

    expect(matches.map((match) => match.positions)).toEqual(positions === undefined ? [] : [positions]);
  });

  it.each(["a", "İ", "ς", "σ"])("preserves folded matching, scores, and order for %s", (query) => {
    const contextualRows = ["İab", "ab", "İa-b", "İΟΣ", "İΟΣΑ", "İab"].map((title, index) => ({
      id: String(index), title
    }));
    const folded = filterRows(query.toLocaleLowerCase(), contextualRows.map((row) => ({
      ...row, title: row.title.toLocaleLowerCase()
    })), { caseSensitive: true });

    expect(filterRows(query, contextualRows).map(({ index, score }) => ({ index, score }))).toEqual(
      folded.map(({ index, score }) => ({ index, score }))
    );
  });

  it.each([
    ["tr", "i", "I\u0307ab", undefined, [0, 1]],
    ["tr", "a", "I\u0307ab", undefined, [2]],
    ["tr", "x", "I\u0307", "x", [3]],
    ["tr", "\u0307", "I\u0307ab", undefined, undefined],
    ["tr", "ı", "Iab", undefined, [0]],
    ["lt", "i", "I\u0301ab", undefined, [0, 1]],
    ["lt", "\u0307", "I\u0301ab", undefined, [0, 1]],
    ["lt", "\u0301", "I\u0301ab", undefined, [0, 1]],
    ["lt", "a", "I\u0301ab", undefined, [2]],
    ["lt", "x", "I\u0301", "x", [3]],
    ["lt", "a", "Íab", undefined, [1]]
  ] as const)("projects %s casing for %s in %s / %s", (locale, query, title, subtitle, positions) => {
    const lowerCase = String.prototype.toLocaleLowerCase;
    vi.spyOn(String.prototype, "toLocaleLowerCase").mockImplementation(function (this: string) {
      return lowerCase.call(this, locale);
    });
    const matches = filterRows(query, [{ id: "match", title, subtitle }]);
    const folded = filterRows(lowerCase.call(query, locale), [{
      id: "match", title: lowerCase.call([title, subtitle].filter((value) => value !== undefined).join(" "), locale)
    }], { caseSensitive: true });

    expect(matches.map((match) => match.positions)).toEqual(positions === undefined ? [] : [positions]);
    expect(matches.map((match) => match.score)).toEqual(folded.map((match) => match.score));
  });

  it("projects repeated expansions without lowercasing growing prefixes", () => {
    const title = "İ".repeat(128) + "A";
    const lowerCase = vi.spyOn(String.prototype, "toLocaleLowerCase");

    expect(filterRows("a", [{ id: "match", title }])[0]?.positions).toEqual([128]);
    expect(lowerCase.mock.contexts.reduce<number>((total, value) => total + String(value).length, 0)).toBeLessThanOrEqual(
      title.length * 2 + 1
    );
  });

  it("preserves whitespace-only queries with Unicode rows", () => {
    expect(filterRows(" \t", [{ id: "first", title: "😁🈀" }, { id: "second", title: "😀" }])).toEqual([
      { index: 0, score: 0, positions: [] },
      { index: 1, score: 0, positions: [] }
    ]);
  });
});
