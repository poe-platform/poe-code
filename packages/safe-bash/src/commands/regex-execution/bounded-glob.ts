import { PublicDiagnostic } from "../../public-diagnostic.js";
import type { BoundedRegexProviderOptions } from "./bounded-provider.js";
import type { GlobDescriptor, Reply, Row } from "./protocol.js";
import { EreLedger } from "./ere/limits.js";
import { compileEre } from "./ere/syntax.js";
import { prepareUtf8EreSubject } from "./ere/matcher.js";

import { globFragments } from "safe-bash-regex-engine/glob";

function invalid(message: string): never { throw new PublicDiagnostic(`invalid glob: ${message}`); }

/** Uses the same cooperative work/state/allocation ledger as content matching. */
export async function executeBoundedGlobs(input: {
  readonly id: number; readonly descriptor: GlobDescriptor; readonly rows: readonly Row[];
  readonly ledger: EreLedger; readonly limits: Required<BoundedRegexProviderOptions>;
}, signal: AbortSignal): Promise<Reply> {
  const { descriptor, ledger } = input;
  ledger.charge("allocationUnits", descriptor.patterns.length * 4 + 1, signal);
  const programs = [];
  for (let index = 0; index < descriptor.patterns.length; index++) {
    const source = descriptor.patterns[index]!;
    if (!source) invalid("empty or excessive glob");
    const option = descriptor.globOptions[index]!;
    programs.push(await compileEre(await globFragments(source, option.literalUnclosedClass, ledger, signal), ledger, signal, option.insensitive));
  }
  const results: Float64Array[] = [];
  let matches = 0;
  for (let index = 0; index < input.rows.length; index++) {
    const row = input.rows[index]!;
    ledger.charge("allocationUnits", row.bytes.length * 4 + 4, signal);
    ledger.charge("work", row.bytes.length, signal);
    await ledger.checkpoint(signal);
    // UTF16LE is the established glob transport. Reject malformed scalars rather
    // than normalizing distinct virtual paths into the same replacement text.
    let path: string;
    try { path = new TextDecoder("utf-16le", { fatal: true, ignoreBOM: true }).decode(row.bytes); }
    catch { throw new PublicDiagnostic("bounded regex protocol: glob paths require valid UTF16 scalars"); }
    if (descriptor.globOptions[index]!.insensitive) {
      for (let offset = 0; offset < path.length; offset++) {
        ledger.charge("work", 1, signal);
        await ledger.checkpoint(signal);
        if (path.charCodeAt(offset) >= 128) throw new PublicDiagnostic("bounded regex unsupported: glob case folding supports ASCII paths only");
      }
    }
    let matched = false;
    for (let end = path.length; end >= 0;) {
      await ledger.checkpoint(signal);
      if (end !== path.length || !descriptor.patterns[index]!.endsWith("/") || row.directory) {
        const subject = await prepareUtf8EreSubject(new TextEncoder().encode(path.slice(0, end)), ledger, signal);
        if (await subject(programs[index]!)(0)) { matched = true; break; }
      }
      if (row.ancestors === false || end === 0) break;
      end = path.lastIndexOf("/", end - 1);
    }
    if (matched && (++matches > input.limits.maxTotalMatches || matches > Math.floor(input.limits.maxResultBytes / 16))) {
      throw new PublicDiagnostic("bounded regex limit: total match or result byte limit exceeded");
    }
    ledger.charge("allocationUnits", matched ? 16 : 1, signal);
    results.push(matched ? new Float64Array([0, 0]) : new Float64Array());
  }
  return { id: input.id, results };
}
