import { FsError, type CommandDefinition } from "../../contracts/index.js";
import { options, value } from "../internal.js";
import { command, type StreamInspectionLimits } from "./shared.js";
import { reverseEmacsSteps } from "../expr/bre-engine.js";
import { ExprMatchError, exprMatchCeilings } from "../regex-execution/protocol.js";

export function createTacCommand(limits: StreamInspectionLimits): CommandDefinition {
  return command("tac", limits, async session => {
    const parsed = options(session.context.args, "brs:", { before: "b", regex: "r", separator: "s" });
    const text = value(parsed, "s") ?? "\n";
    const separator = Buffer.from(text || "\0");
    const reversed = Uint8Array.from(separator).reverse();
    const prefix = new Uint32Array(reversed.length);
    for (let index = 1, matched = 0; index < reversed.length; index++) {
      await session.step();
      while (matched && reversed[index] !== reversed[matched]) { matched = prefix[matched - 1]!; await session.step(); }
      if (reversed[index] === reversed[matched]) matched++;
      prefix[index] = matched;
    }
    await session.files(session.names(parsed.operands), async source => {
      let bytes = new Uint8Array(Math.min(65536, limits.maxInputBytes));
      let size = 0;
      for await (const chunk of source) {
        if (size + chunk.length > bytes.length) {
          const grown = new Uint8Array(Math.min(limits.maxInputBytes, Math.max(size + chunk.length, bytes.length * 2)));
          grown.set(bytes.subarray(0, size)); bytes = grown;
        }
        bytes.set(chunk, size); size += chunk.length;
      }
      let end = size, matched = 0;
      if (parsed.flags.has("r")) {
        const matches = reverseEmacsSteps({ kind: "bre-search", pattern: separator, profile: "byte", limits: {
          ...exprMatchCeilings, maxSubjectBytes: limits.maxInputBytes, maxSteps: Math.min(limits.maxSteps, exprMatchCeilings.maxSteps),
        } }, bytes.subarray(0, size));
        try {
          for (const match of matches) {
            await session.step();
            if (!match) continue;
            const boundary = parsed.flags.has("b") ? match.start : match.end;
            session.check(end - boundary, limits.maxRecordBytes, "record");
            await session.output(bytes.subarray(boundary, end));
            end = boundary;
          }
        } catch (error) {
          if (error instanceof ExprMatchError) throw new FsError(error.category === "limit" ? "EFBIG" : "EINVAL", { message: error.message });
          throw error;
        }
        session.check(end, limits.maxRecordBytes, "record");
        await session.output(bytes.subarray(0, end));
        return;
      }
      for (let index = size - 1; index >= 0; index--) {
        await session.step();
        while (matched && bytes[index] !== reversed[matched]) { matched = prefix[matched - 1]!; await session.step(); }
        if (bytes[index] === reversed[matched]) matched++;
        if (matched !== reversed.length) continue;
        const boundary = parsed.flags.has("b") ? index : index + separator.length;
        session.check(end - boundary, limits.maxRecordBytes, "record");
        await session.output(bytes.subarray(boundary, end));
        end = boundary;
        matched = 0;
      }
      session.check(end, limits.maxRecordBytes, "record");
      await session.output(bytes.subarray(0, end));
    });
  });
}
