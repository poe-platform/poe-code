import { EreLedger } from "../limits.js";
import { compileEre } from "../syntax.js";
import { matchEre } from "../matcher.js";
import { EreProfileLimitError, EreSyntaxError, EreUnsupportedError } from "../errors.js";
import { add, workerReplyValidationWork } from "./accounting.js";
import { operation } from "./protocol.js";
import type { EreTransportReply } from "./protocol.js";
import { validateReply, validateRequest } from "./validation.js";

export async function executeWireRequest(value: unknown, entryWork = 0): Promise<EreTransportReply> {
  const prepaidWork = add(entryWork, workerReplyValidationWork);
  let requestWork = 0;
  const request = validateRequest(value, prepaidWork, units => { requestWork = add(requestWork, units); });
  const ledger = new EreLedger(request.bounds, request.allowance);
  ledger.charge("work", add(prepaidWork, requestWork));
  let reply: EreTransportReply;
  try {
    const program = await compileEre(request.pattern, ledger);
    const result = await matchEre(program, request.subject, ledger);
    const usage = ledger.usage;
    const spans = result.matched ? result.captures : Object.freeze(new Array<null>(program.groups + 1).fill(null));
    reply = {
      version: 1, operation, id: request.id, grantId: request.grantId, kind: "result",
      result: { matched: result.matched, groupCount: program.groups, spans, steps: usage.work, allocatedUnits: usage.allocationUnits }, usage,
    };
  } catch (error) {
    if (!(error instanceof EreSyntaxError) && !(error instanceof EreUnsupportedError) && !(error instanceof EreProfileLimitError)) throw error;
    reply = {
      version: 1, operation, id: request.id, grantId: request.grantId, kind: "failure",
      category: error instanceof EreProfileLimitError ? "profile-limit" : error instanceof EreSyntaxError ? "syntax" : "unsupported",
      resource: error instanceof EreProfileLimitError ? error.resource : null,
      offset: error instanceof EreProfileLimitError ? null : error.offset,
      usage: ledger.usage,
    };
  }
  let replyWork = 0;
  validateReply(reply, request, units => {
    replyWork = add(replyWork, units);
    if (replyWork > workerReplyValidationWork) throw new EreProfileLimitError("work", workerReplyValidationWork);
  });
  replyWork = add(replyWork, add(7, reply.kind === "result" ? reply.result.spans.length : 0));
  if (replyWork > workerReplyValidationWork) throw new EreProfileLimitError("work", workerReplyValidationWork);
  return reply;
}
