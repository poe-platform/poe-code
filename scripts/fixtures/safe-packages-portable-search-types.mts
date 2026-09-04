import {
  portableSearchCommands, EreLedger, compileEre, matchEre, createBoundedRegexProvider,
  type BoundedRegexProvider, type PortableSearchOptions, type BoundedRegexProviderOptions,
} from "@poe-platform/safe-bash";
import {
  portableSearchCommands as browserSearchCommands,
  createBoundedRegexProvider as createBrowserProvider,
  type BoundedRegexProvider as BrowserProvider,
  type BoundedRegexProviderOptions as BrowserProviderOptions,
  type PortableSearchOptions as BrowserSearchOptions,
} from "@poe-platform/safe-bash/browser";

export function portablePlugins(provider: BoundedRegexProvider & BrowserProvider) {
  const options: PortableSearchOptions & BrowserSearchOptions = {
    provider, regex: { maxWorkers: 1 }, search: { defaultInput: "stdin" }, sed: { maxSteps: 10000 },
  };
  return [portableSearchCommands(options), browserSearchCommands(options)];
}

const providerOptions: BoundedRegexProviderOptions & BrowserProviderOptions = {
  maxWorkers: 1, maxPatterns: 8, maxPatternBytes: 1024, maxRows: 16,
  maxInputBytes: 8192, maxResultBytes: 256, maxWork: 100000,
  maxAllocationUnits: 100000, maxStates: 1024,
};
portablePlugins(createBoundedRegexProvider(providerOptions));
portablePlugins(createBrowserProvider(providerOptions));

const ledger = new EreLedger({ maxExpansionBytes: 4096, maxExpansionFields: 128 });
const signal = new AbortController().signal;
const expression = await compileEre("^x$", ledger, signal);
const result = await matchEre(expression, "x", ledger, signal);
if (!result.matched) throw new Error("Public portable ERE execution failed");
