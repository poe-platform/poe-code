import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {encodeIdnaBuffer} from "./idna-buffer-encode.js";
import {decodeIdnaBuffer} from "./idna-buffer-decode.js";
import {encodeIdnaDomain, decodeIdnaDomain} from "./idna-domain.js";

const emptyText = new CodePointString(new Uint32Array());
const emptyBytes = new Uint8Array();
const pendingLabel = new CodePointString(Uint32Array.of(97));
const operations = [
  {name: "domain encoder", run: (meter: ExecutionBudget) => encodeIdnaDomain(emptyText, "strict", meter)},
  {name: "domain decoder", run: (meter: ExecutionBudget) => decodeIdnaDomain(emptyBytes, "strict", meter)},
  {name: "buffer encoder", run: (meter: ExecutionBudget) => encodeIdnaBuffer(emptyText, "strict", false, meter)},
  {name: "buffer decoder", run: (meter: ExecutionBudget) => decodeIdnaBuffer(emptyBytes, "strict", false, meter)},
  {name: "pending encoder", run: (meter: ExecutionBudget) => encodeIdnaBuffer(pendingLabel, "strict", false, meter)},
  {name: "pending decoder", run: (meter: ExecutionBudget) => decodeIdnaBuffer(pendingLabel, "strict", false, meter)}
];

it.each(operations)("admits retained empty IDNA $name output storage", ({run}) => {
  const meter = new ExecutionBudget({maxSteps: 10000, maxAllocatedBytes: 320});
  const retained: unknown[] = [];
  let failure: unknown;
  try {
    for (let index = 0; index < 5; index++) retained.push(run(meter));
  } catch (error) {failure = error;}
  expect(failure).toBeInstanceOf(ExecutionLimitError);
  expect(retained.length).toBeLessThanOrEqual(2);
  expect(new Set(retained).size).toBe(retained.length);
  expect(() => run(meter)).toThrow(failure as Error);
});
