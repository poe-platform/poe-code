import {createHash} from "node:crypto";
import {expect, it} from "vitest";
import reference from "./__snapshots__/idna-composition-audit-3.14.7.json";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget} from "./execution-budget.js";
import {encodeIdnaAsciiLabel} from "./idna-ascii-label.js";
import {encodeIdnaBuffer} from "./idna-buffer-encode.js";
import {encodeIdnaDomain} from "./idna-domain.js";
import {prepareIdnaName} from "./idna-nameprep.js";
import {decodeIdnaUnicodeLabel} from "./idna-unicode-label.js";

let state = reference.seed;
function random(): number {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}
const cases = Array.from({length: reference.inputs}, () => {
  const input: number[] = [];
  const count = random() % 8;
  for (let index = 0; index < count; index++) input.push(...reference.fragments[random() % reference.fragments.length]);
  return reference.operations.map(operation => ({operation, input}));
}).flat();

function fault(error: PythonRuntimeError): unknown {
  return {name: error.name, message: error.message, suppressContext: error.chaining?.suppressContext ?? false,
    ...(error instanceof PythonEncodeError || error instanceof PythonDecodeError ? {
      encoding: error.encoding, object: [...error.object], start: String(error.start), end: String(error.end), reason: error.reason
    } : {}), ...(error.chaining === undefined ? {} : {context: fault(error.chaining.context)})};
}

it("retains the complete compositional corpus and pinned external oracle", () => {
  expect(reference.oracle.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.oracle).toMatchObject({unicode: "16.0.0", platform: "darwin", byteorder: "little", status: 0, stderr: "", signal: null});
  expect(cases).toHaveLength(6000);
  expect(reference.blocks.map(({offset, count}) => [offset, count])).toEqual(
    Array.from({length: 120}, (_, index) => [index * 50, 50])
  );
  expect(createHash("sha256").update(JSON.stringify(cases)).digest("hex")).toBe(reference.inputSha256);
});

it.each(reference.blocks)("matches IDNA compositions and complete fault chains $offset + $count", ({offset, count, sha256}) => {
  const actual = cases.slice(offset, offset + count).map(row => {
    const meter = new ExecutionBudget({maxSteps: 1000000, maxAllocatedBytes: 8000000});
    const input = new CodePointString(Uint32Array.from(row.input));
    try {
      switch (row.operation) {
        case "prepare": return {...row, result: [...prepareIdnaName(input, meter)]};
        case "label": return {...row, result: [...encodeIdnaAsciiLabel(input, meter)]};
        case "unicode": return {...row, result: [...decodeIdnaUnicodeLabel(input, meter)]};
        case "domain": {
          const result = encodeIdnaDomain(input, "strict", meter);
          return {...row, result: [...result.output], consumed: result.consumed};
        }
        case "buffer_false": case "buffer_true": {
          const result = encodeIdnaBuffer(input, "strict", row.operation === "buffer_true", meter);
          return {...row, result: [...result.output], consumed: result.consumed};
        }
        default: throw Error(`Unknown oracle operation: ${row.operation}`);
      }
    } catch (error) {
      if (!(error instanceof PythonRuntimeError)) throw error;
      return {...row, error: fault(error)};
    }
  });
  expect(createHash("sha256").update(JSON.stringify(actual)).digest("hex")).toBe(sha256);
});
