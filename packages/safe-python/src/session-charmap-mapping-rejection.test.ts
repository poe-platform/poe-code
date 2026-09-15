import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {charmapMappingRejectionCases} from "./charmap-mapping-rejection-cases.js";

it.each(charmapMappingRejectionCases.flatMap(row =>
  (["normal", "cancel-return", "cancel-throw"] as const).map(mode => ({...row, mode}))))(
  "charmap $operation mapping $value: $mode", ({source, mode}) => {
    const controller = new AbortController();
    let reads = 0, output = "";
    const session = new PythonSession({
      limits: {maxSteps: 500000, maxAllocatedBytes: 8000000, maxDepth: 100},
      hashSeed: [1n, 2n], signal: controller.signal,
      input: {readLine() {
        reads++;
        if (mode !== "normal") controller.abort();
        if (mode === "cancel-throw") throw Error("input failed after cancellation");
        return "ready\n";
      }},
      output: {write(value) {output += value;}, flush() {}}
    });
    const result = session.exec(source);
    expect(reads).toBe(1);
    if (mode === "normal") {
      expect(result.status).toBe("ok");
      expect(output).toBe("verified\n");
    } else {
      expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
      expect(output).toBe("");
      expect(session.exec("input()")).toMatchObject({status: "terminated", reason: "cancelled"});
      expect(reads).toBe(1);
    }
  }
);
