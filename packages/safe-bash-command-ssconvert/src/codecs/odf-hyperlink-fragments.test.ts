import { expect, it } from "vitest";
import { translateOdfHyperlink } from "./odf-hyperlinks.js";

it.each([
  ["#Total%20(50% off)", "50% off", "#Total%20(50%25%20off)"],
  ["#Total%20(Issue #1?)", "Issue #1?", "#Total%20(Issue%20%231%3F)"],
  ["#'Rate 50%'.Total", "Rate 50%", "#Total%20(Rate%2050%25)"],
  ["#'50% off'.Total", "50% off", "#Total%20(50%25%20off)"],
  ["#'Snow%20%E9%9B%AA%'.Total", "Snow 雪%", "#Total%20(Snow%20%E9%9B%AA%25)"],
  ["#'%ff%20off'.Total", "%FF off", "#Total%20(%25FF%20off)"]
])("normalizes valid local names around literal or invalid escapes: %s", (source, sheet, expected) => {
  expect(translateOdfHyperlink(source, "normalize", () => {}, [sheet])).toBe(expected);
});

it.each([
  ["#Total%20(50% off)", "50% off", "'50% off'!Total"],
  ["#Total%20(%ff%20off)", "%FF off", "'%FF off'!Total"],
  ["#Total%20(%E9%9B%AA%20%f0%9f%98%80%)", "雪 😀%", "'雪 😀%'!Total"],
  ["#Total%20(%e2%28%a1)", "%E2(%A1", "'%E2(%A1'!Total"],
  ["#Total%20(%ed%a0%80)", "%ED%A0%80", "'%ED%A0%80'!Total"],
  ["#Total%20(%c0%af)", "%C0%AF", "'%C0%AF'!Total"],
  ["#Total%20(%25%32%30)", "%20", "'%20'!Total"]
])("decodes each valid UTF-8 escape without aborting neighboring text: %s", (source, sheet, expected) => {
  expect(translateOdfHyperlink(source, "import", () => {}, [sheet])).toBe(expected);
});

it.each([
  ["'Issue #1?'!Total", "#Total%20(Issue%20%231%3F)"],
  ["'Issue #1?'!$A$1:$B$2", "#'Issue%20%231%3F'.$A$1:$B$2"]
])("escapes fragment separators without changing the target: %s", (target, expected) => {
  const sheets = ["Issue #1?"];
  const exported = translateOdfHyperlink(target, "export", () => {}, sheets);
  expect(exported).toBe(expected);
  expect(translateOdfHyperlink(exported, "import", () => {}, sheets)).toBe(target);
});

it("retains passive URLs and stops decoding when its work budget aborts", () => {
  const url = "https://example.invalid/50%?x=%FF#part";
  expect(translateOdfHyperlink(url, "normalize", () => {})).toBe(url);
  let work = 0;
  expect(() => translateOdfHyperlink("#Total%20(50% off)", "import", (n = 1) => {
    if ((work += n) > 22) throw new Error("work exhausted");
  }, ["50% off"])).toThrow("work exhausted");
});
