import { EreLedger } from "../limits.js";
import { compileEre } from "../syntax.js";
import { matchEre } from "../matcher.js";
import { EreProfileLimitError, EreSyntaxError, EreUnsupportedError } from "../errors.js";
import { operation } from "./protocol.js";
import { validateReply, validateRequest } from "./validation.js";
export async function executeWireRequest(value) {
    const request = validateRequest(value);
    const ledger = new EreLedger(request.bounds, request.allowance);
    let reply;
    try {
        const program = await compileEre(request.pattern, ledger);
        const result = await matchEre(program, request.subject, ledger);
        const usage = ledger.usage;
        const spans = result.matched ? result.captures : Object.freeze(new Array(program.groups + 1).fill(null));
        reply = {
            version: 1, operation, id: request.id, grantId: request.grantId, kind: "result",
            result: { matched: result.matched, groupCount: program.groups, spans, steps: usage.work, allocatedUnits: usage.allocationUnits }, usage,
        };
    }
    catch (error) {
        if (!(error instanceof EreSyntaxError) && !(error instanceof EreUnsupportedError) && !(error instanceof EreProfileLimitError))
            throw error;
        reply = {
            version: 1, operation, id: request.id, grantId: request.grantId, kind: "failure",
            category: error instanceof EreProfileLimitError ? "profile-limit" : error instanceof EreSyntaxError ? "syntax" : "unsupported",
            resource: error instanceof EreProfileLimitError ? error.resource : null,
            offset: error instanceof EreProfileLimitError ? null : error.offset,
            usage: ledger.usage,
        };
    }
    validateReply(reply, request, () => { });
    return reply;
}
