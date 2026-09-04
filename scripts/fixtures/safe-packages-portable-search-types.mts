import {
  portableSearchCommands, EreLedger, compileEre, matchEre,
  type BoundedRegexProvider, type PortableSearchOptions,
} from "@poe-platform/safe-bash";
import {
  portableSearchCommands as browserSearchCommands,
  type BoundedRegexProvider as BrowserProvider,
  type PortableSearchOptions as BrowserSearchOptions,
} from "@poe-platform/safe-bash/browser";

export function portablePlugins(provider: BoundedRegexProvider & BrowserProvider) {
  const options: PortableSearchOptions & BrowserSearchOptions = {
    provider, regex: { maxWorkers: 1 }, search: { defaultInput: "stdin" }, sed: { maxSteps: 10000 },
  };
  return [portableSearchCommands(options), browserSearchCommands(options)];
}

const ledger = new EreLedger({ maxExpansionBytes: 4096, maxExpansionFields: 128 });
const signal = new AbortController().signal;
const expression = await compileEre("^x$", ledger, signal);
const result = await matchEre(expression, "x", ledger, signal);
if (!result.matched) throw new Error("Public portable ERE execution failed");
