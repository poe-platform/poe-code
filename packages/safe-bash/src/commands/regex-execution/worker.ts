import { PublicDiagnostic } from "../../diagnostics.js";
import { parentPort } from "node:worker_threads";
import { compile } from "./matching.js";
import { matchExpr, searchBre } from "../expr/bre-worker.js";
import { ExprMatchError, matchRangeLimits, validateExprRequest, validateBreSearchRequest, type BreSearchRequest, type BreSearchReply, type ExprMatchRequest, type ExprMatchReply, type Request, type Reply } from "./protocol.js";

if (!parentPort) throw new Error("regex worker requires a parent port");
const port = parentPort;
let previous = "";
let matcher: ReturnType<typeof compile> | undefined;
port.on("message", (request: Request | ExprMatchRequest | BreSearchRequest) => {
  if (request?.descriptor?.kind === "bre-search") {
    let reply: BreSearchReply;
    try {
      validateBreSearchRequest(request);
      reply = { id: request.id, operation: "bre-search", result: searchBre(request.descriptor, request.rows[0]!.bytes) };
    } catch (error) {
      if (!(error instanceof ExprMatchError)) throw error;
      reply = { id: request.id, operation: "bre-search", category: error.category, error: error.message };
    }
    port.postMessage(reply);
    return;
  }
  if (request?.descriptor?.kind === "expr-match") {
    let reply: ExprMatchReply;
    try {
      validateExprRequest(request);
      reply = { id: request.id, operation: "expr-match", result: matchExpr(request.descriptor, request.rows[0]!.bytes) };
    } catch (error) {
      if (!(error instanceof ExprMatchError)) throw error;
      reply = { id: request.id, operation: "expr-match", category: error.category, error: error.message };
    }
    port.postMessage(reply);
    return;
  }
  const legacy = request as Request;
  let reply: Reply;
  try {
    const identity = JSON.stringify(request.descriptor);
    if (identity !== previous || !matcher) {
      matcher = undefined;
      matcher = compile(legacy.descriptor);
      previous = identity;
    }
    let retainedRanges = 0;
    const results = request.rows.map((row, index) => {
      const matches = matcher!(row, index);
      if (matches.length > matchRangeLimits.perRow) throw new PublicDiagnostic("matches per row limit exceeded");
      if (matches.length > matchRangeLimits.perReply - retainedRanges) throw new PublicDiagnostic("matches per reply limit exceeded");
      retainedRanges += matches.length;
      const ranges = new Float64Array(matches.length * 2);
      for (let index = 0; index < matches.length; index++) {
        ranges[index * 2] = matches[index]!.start;
        ranges[index * 2 + 1] = matches[index]!.end;
      }
      return ranges;
    });
    reply = { id: request.id, results };
    port.postMessage(reply, results.map(result => result.buffer));
  } catch (error) {
    if (!(error instanceof PublicDiagnostic)) throw error;
    reply = { id: request.id, error: error.message };
    port.postMessage(reply);
  }
});
port.postMessage({ ready: true });
