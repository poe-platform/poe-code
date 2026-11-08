import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readText } from "./text.js";

const context: CapabilityContext = {
  signal: new AbortController().signal,
  inputFilename: "/accounting.csv",
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 2, operations: 1000 },
  own() {}
};

// Stable number-match.c: parentheses establish the sign; percentage cannot
// coexist with accounting parentheses. These are original source-derived cases.
it.each(["(+12)", "(-12)", "(12+)", "(12-)", "(12%)"])(
  "preserves invalid accounting input %s as text", async text => {
    const book = await readText(new TextEncoder().encode("heading\n" + text + "\n"), context);
    expect(book.sheets[0]!.cells[1]!.value).toEqual({ kind: "string", value: text });
  }
);

it.each([["(12)", -12], ["($12)", -12], ["12-", -12], ["12%", 0.12]] as const)(
  "still infers valid accounting/sign/percent input %s", async (text, value) => {
    const book = await readText(new TextEncoder().encode("heading\n" + text + "\n"), context);
    expect(book.sheets[0]!.cells[1]!.value).toEqual({ kind: "number", value });
  }
);

it.each([["C", 1.234], ["de_DE.UTF-8", 1234]] as const)(
  "uses locale %s after a mixed text column prevents number format guessing", async (locale, value) => {
    const book = await readText(new TextEncoder().encode("heading\n1.234\nnot-number\n"), {
      ...context, environment: { ...context.environment, locale }
    });
    expect(book.sheets[0]!.cells[1]!.value).toEqual({ kind: "number", value });
  }
);
