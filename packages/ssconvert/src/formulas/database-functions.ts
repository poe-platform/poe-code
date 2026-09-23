import { DEFAULT_SHEET_SIZE, type CellValue } from "../workbook.js";
import type { FunctionHost, Matrix } from "./functions/types.js";
import { textArg } from "./functions/common.js";
import { snapshotRuntimeFunctions, type RuntimeFunctions } from "./runtime-functions.js";

export interface DatabaseQueryRequest {
  readonly dsn: string;
  readonly username: string;
  readonly password: string;
  readonly sql: string;
  readonly readOnly: true;
}
export type DatabaseQueryResult =
  | { readonly kind: "recordset"; readonly rows: Matrix["rows"] }
  | { readonly kind: "empty" }
  | { readonly kind: "connection-error" }
  | { readonly kind: "query-error"; readonly message: string };
/** Cooperative host port owns connection selection, single-statement SQL parsing,
 * read-only execution and database-type conversion to spreadsheet scalar values. */
export type DatabaseQuery = (request: DatabaseQueryRequest, host: FunctionHost) => DatabaseQueryResult;

/** Source-supported GDA formula ports. No ambient DSN registry, SQL engine or GUI. */
export function createDatabaseFunctions(query: DatabaseQuery): RuntimeFunctions {
  if (typeof query !== "function") throw new TypeError("Invalid ssconvert database query capability");
  return snapshotRuntimeFunctions(Object.fromEntries(["EXECSQL", "READDBTABLE"].map(name => [name, {
    signature: "ssss",
    implementation(args: Parameters<RuntimeFunctions[string]["implementation"]>[0], host: FunctionHost): CellValue | Matrix {
      const strings = Array.from({ length: 4 }, (_entry, index) => {
        host.tick();
        const text = textArg(args, index, host), nul = text.indexOf("\0");
        return nul < 0 ? text : text.slice(0, nul);
      });
      const dsn = strings[0]!, sql = name === "READDBTABLE" ? `SELECT * FROM ${strings[3]!}` : strings[3]!;
      const result = query(Object.freeze({ dsn, username: strings[1]!, password: strings[2]!, sql, readOnly: true }), host);
      host.tick();
      switch (result.kind) {
        case "empty": return { kind: "blank" };
        case "connection-error": return { kind: "error", value: `Error: could not open connection to ${dsn}` };
        case "query-error": return { kind: "error", value: result.message };
        case "recordset": {
          if (!result.rows.length) return { kind: "blank" };
          const size = host.book.sheets.find(sheet => sheet.id === host.position.sheet)?.size ?? DEFAULT_SHEET_SIZE;
          if (result.rows.length >= size.rows) return { kind: "error", value: "Too much data returned" };
          // Generic runtime admission owns/freeze-checks rectangular scalar members
          // and admits total area before traversing the supplied recordset.
          return { kind: "matrix", rows: result.rows };
        }
      }
    }
  }])));
}
