import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { type Trace } from "./lab.js";
import { type Row } from "./rows.js";

export const owned = fileURLToPath(new URL(".", import.meta.url));

export interface Observation {
  id: string;
  argv: string[];
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  traces: Trace[];
  wireTraces: Trace[];
  files: Record<string, string>;
  consumerCode: number | null;
  elapsedMs: number;
  consumerElapsedMs: number | null;
}

export function assertNative(row: Row, actual: Observation): void {
  if (row.mode === "sigint") {
    assert.equal(actual.code, null);
    assert.equal(actual.signal, "SIGINT");
    assert.equal(actual.traces.length, 1);
  } else if (row.mode === "head") {
    assert.equal(actual.consumerCode, 0);
    assert.equal(actual.stdout, Buffer.from("p").toString("base64"));
    assert([0, 23, 28].includes(actual.code!), "Native pipe outcome outside bounded documented observations");
    assert.equal(actual.signal, null);
  } else {
    assert.equal(actual.code, row.code ?? 0, `${row.id}: independent expected native exit`);
    assert.equal(actual.signal, null);
  }
  if (row.diagnostic) assert.match(actual.stderr, new RegExp(row.diagnostic, "i"), `${row.id}: meaningful diagnostic`);
  if (actual.code === 0) assert.equal(actual.stderr, "");
}

export function stable(observation: Observation): unknown {
  return {
    id: observation.id,
    code: observation.id.startsWith("early-head-") ? "native-pipe-observation-only" : observation.code,
    signal: observation.signal,
    stdout: observation.stdout,
    traces: observation.traces,
    files: observation.files,
    consumerCode: observation.consumerCode,
  };
}
