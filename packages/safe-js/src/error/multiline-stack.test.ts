import { expect, it } from "vitest";
import { run } from "../run.js";

const messages = [
  "one",
  "one\ntwo",
  "one\n\nthree",
  "one\n",
  "one\r\ntwo",
  "one\n    at typed frame (line 9, column 9)"
];

const scripts = [
  { name: "direct", body: "return await fail({});" },
  {
    name: "function",
    body: "async function inner(){ return await fail({}); } return await inner();"
  },
  { name: "rethrow", body: "try { await fail({}); } catch (error) { throw error; }" },
  {
    name: "nested rethrow",
    body: "async function inner(){ try { await fail({}); } catch (error) { throw error; } } try { await inner(); } catch (error) { throw error; }"
  }
];

const cases = (["Error", "TypeError"] as const).flatMap((errorName) =>
  [false, true].flatMap((asynchronous) =>
    scripts.flatMap((script) =>
      messages.map((message) => ({ errorName, asynchronous, script, message }))
    )
  )
);

it.each(cases)(
  "preserves $errorName message $message once through $script.name, asynchronous: $asynchronous",
  async ({ errorName, asynchronous, script, message }) => {
    async function captureError(text: string): Promise<Error> {
      const error = errorName === "TypeError" ? new TypeError(text) : new Error(text);
      const fail = asynchronous
        ? () => Promise.reject(error)
        : () => { throw error; };

      try {
        await run(`import { fail } from "audit"; ${script.body}`, {
          modules: { audit: { fail } }
        });
      } catch (caught) {
        expect(caught).toMatchObject({ name: errorName, message: text });
        return caught as Error;
      }
      throw new Error("Expected the host call to fail.");
    }

    const baseline = await captureError("one");
    const actual = await captureError(message);
    const baselineStack = baseline.stack!;

    expect(baselineStack.startsWith(`${errorName}: one\n`)).toBe(true);
    expect(baselineStack.split("\n").slice(1).every((line) => line.startsWith("    at ")))
      .toBe(true);
    expect(actual.stack).toBe(baselineStack.replace(`${errorName}: one`, `${errorName}: ${message}`));
  }
);
