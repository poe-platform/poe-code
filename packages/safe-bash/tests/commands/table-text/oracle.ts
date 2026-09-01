
import { createHash } from "node:crypto";
import { type TableCase } from "./cases.js";

export interface Observation { readonly name: string; readonly caseSha256: string; readonly exitCode: number; readonly stdoutHex: string; readonly stderrHex: string }
export const caseHash = (fixture: TableCase): string => createHash("sha256").update(JSON.stringify(fixture)).digest("hex");
