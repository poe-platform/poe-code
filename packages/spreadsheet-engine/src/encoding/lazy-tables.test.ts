import { describe, expect, it } from "vitest";
import { biffDbcsTables } from "./biff-dbcs-tables.js";
import { cTargetTransliterations, utf8TargetTransliterations } from "./target-transliteration-tables.js";
import { cTransliterations, utf8Transliterations } from "./transliteration-tables.js";
import { utf8Ucs2Transliterations } from "./ucs2-transliteration-tables.js";

describe("lazy encoding tables", () => {
  it("resolves BIFF DBCS tables on demand", () => {
    expect(932 in biffDbcsTables).toBe(true);
    expect(biffDbcsTables[932]?.single.charAt(0x41)).toBe("A");
    expect(Object.keys(biffDbcsTables)).toContain("932");
  });

  it("resolves transliteration tables on demand", () => {
    expect(Object.keys(cTransliterations).length).toBeGreaterThan(0);
    expect(Object.keys(utf8Transliterations).length).toBeGreaterThan(0);
    expect("macintosh" in cTargetTransliterations).toBe(true);
    expect("macintosh" in utf8TargetTransliterations).toBe(true);
    expect(utf8Ucs2Transliterations["𝚨"]).toBe("Α");
  });
});
