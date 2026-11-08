import { expect, it } from "vitest";
import { defineCommand, defineGroup, S } from "toolcraft";
import { createSDK } from "toolcraft/sdk";
import { codeMode, type ExecuteResult } from "./index.js";

const messages = [
  "one",
  "one\ntwo",
  "one\n\nthree",
  "one\n",
  "one\r\ntwo",
  "one\n    at typed frame (line 9, column 9)"
];

const cases = (["Error", "TypeError"] as const).flatMap((errorName) =>
  [false, true].flatMap((rethrow) =>
    messages.map((message) => ({ errorName, rethrow, message }))
  )
);

it.each(cases)(
  "returns $errorName message $message once in its stack, rethrow: $rethrow",
  async ({ errorName, rethrow, message }) => {
    let currentMessage = "one";
    let calls = 0;
    const root = defineGroup({
      name: "audit",
      children: [defineCommand({
        name: "fail",
        scope: ["sdk"],
        params: S.Object({}),
        handler() {
          calls++;
          throw errorName === "TypeError"
            ? new TypeError(currentMessage)
            : new Error(currentMessage);
        }
      })]
    });
    const sdk = createSDK(codeMode(root, { approvals: false, errorReports: false }), {
      approvals: false,
      errorReports: false
    }) as { execute(params: { source: string }): Promise<ExecuteResult> };
    const source = 'import { fail } from "audit"; ' + (rethrow
      ? "try { await fail({}); } catch (error) { throw error; }"
      : "return await fail({});");
    const baseline = await sdk.execute({ source });
    currentMessage = message;
    const actual = await sdk.execute({ source });

    expect(calls).toBe(2);
    expect(baseline).toMatchObject({ ok: false, kind: "runtime", error: { message: "one" } });
    expect(actual).toMatchObject({ ok: false, kind: "runtime", error: { message } });
    if (baseline.ok || baseline.kind !== "runtime" || actual.ok || actual.kind !== "runtime") {
      throw new Error("Expected runtime errors from both calls.");
    }
    expect(actual.error.stack).toBe(
      baseline.error.stack!.replace(`${errorName}: one`, `${errorName}: ${message}`)
    );
  }
);
