import path from "node:path";
import {
  getTemplatePartialNames,
  renderTemplate,
  resolveTemplatePartials
} from "toolcraft-design";
import { findBase } from "./discover.js";
import { hasOwnErrorCode } from "./error-codes.js";
import { mergeLayers } from "./merge.js";
import { parseDocument } from "./parse.js";
import type {
  BaseLayer,
  ChainLayer,
  DataLayer,
  DocumentLayer,
  ResolveOptions,
  ResolvedDocument
} from "./types.js";

const MAX_EXTENDS_DEPTH = 5;
const YIELD_TOKEN = "{{yield}}";

interface ClassifiedChain {
  baseLayers: BaseLayer[];
  documentIndex: number;
  documentLayer: DocumentLayer;
}

interface ResolvedBaseChain {
  chain: string[];
  layers: DataLayer[];
}

interface ResolvedBase {
  content: string;
  filePath: string;
  source: string;
  matchedBaseIndex?: number;
}

export async function resolve(
  chain: ChainLayer[],
  options: ResolveOptions
): Promise<ResolvedDocument> {
  const { baseLayers, documentIndex, documentLayer } = classifyChain(chain);
  const parsedDocument = parseDocument(documentLayer.content, documentLayer.filePath);
  const resolvedBase = shouldResolveBase(parsedDocument, options.autoExtend)
    ? await resolveBaseChain({
        name: documentLayer.baseName ?? getBaseName(documentLayer.filePath),
        baseLayers,
        extendsValue: parsedDocument.extends,
        fromFilePath: documentLayer.filePath,
        options,
        optional: !parsedDocument.extends,
        visited: new Set([path.resolve(documentLayer.filePath)]),
        depth: 1
      })
    : undefined;
  const promptFiles = [documentLayer.filePath, ...(resolvedBase?.chain ?? [])];
  const expandedPrompts = await expandPromptPartials(
    {
      source: documentLayer.source,
      data: parsedDocument.data
    },
    resolvedBase?.layers ?? [],
    promptFiles,
    options
  );
  const composedPrompt = composePromptChain(
    expandedPrompts.documentLayer,
    expandedPrompts.baseLayers
  );
  const renderedPrompt =
    composedPrompt === undefined ? undefined : renderPrompt(composedPrompt.prompt, options);
  const merged = mergeLayers([
    ...collectDataLayers(chain.slice(0, documentIndex)),
    {
      source: documentLayer.source,
      data: withResolvedPrompt(parsedDocument.data, renderedPrompt)
    },
    ...stripResolvedBasePrompts(
      resolvedBase?.layers ?? [],
      composedPrompt?.consumedBaseIndexes ?? new Set<number>()
    ),
    ...collectDataLayers(chain.slice(documentIndex + 1))
  ]);

  if (
    composedPrompt !== undefined &&
    getOwnEntry(merged.sources, "prompt") === documentLayer.source &&
    composedPrompt.source !== undefined
  ) {
    merged.sources.prompt = composedPrompt.source;
  }

  return {
    data: merged.data,
    sources: merged.sources,
    chain: [...promptFiles, ...expandedPrompts.partialFiles]
  };
}

function classifyChain(chain: ChainLayer[]): ClassifiedChain {
  const baseLayers: BaseLayer[] = [];
  const documentLayers: Array<{ index: number; layer: DocumentLayer }> = [];

  for (const [index, layer] of chain.entries()) {
    if (isDataLayer(layer)) {
      continue;
    }

    if (isDocumentLayer(layer)) {
      documentLayers.push({ index, layer });
      continue;
    }

    if (isBaseLayer(layer)) {
      baseLayers.push(layer);
    }
  }

  if (documentLayers.length !== 1) {
    throw new Error(`Exactly one document layer is required, received ${documentLayers.length}.`);
  }

  return {
    baseLayers,
    documentIndex: documentLayers[0].index,
    documentLayer: documentLayers[0].layer
  };
}

async function resolveBaseChain({
  name,
  baseLayers,
  extendsValue,
  fromFilePath,
  options,
  optional,
  visited,
  depth
}: {
  name: string;
  baseLayers: BaseLayer[];
  extendsValue: boolean | string;
  fromFilePath: string;
  options: ResolveOptions;
  optional: boolean;
  visited: Set<string>;
  depth: number;
}): Promise<ResolvedBaseChain | undefined> {
  if (depth > MAX_EXTENDS_DEPTH) {
    throw new Error(`Maximum extends depth exceeded (${MAX_EXTENDS_DEPTH}).`);
  }

  const discoveredBase = await resolveBase({
    name,
    baseLayers,
    extendsValue,
    fromFilePath,
    options,
    optional
  });

  if (discoveredBase === undefined) {
    return undefined;
  }

  const resolvedBasePath = path.resolve(discoveredBase.filePath);

  if (visited.has(resolvedBasePath)) {
    if (optional) {
      return undefined;
    }

    throw new Error(
      `Circular extends detected.\nVisited files:\n- ${[...visited, resolvedBasePath].join("\n- ")}`
    );
  }

  const parsedBase = parseDocument(discoveredBase.content, discoveredBase.filePath);
  const nextVisited = new Set(visited);
  nextVisited.add(resolvedBasePath);
  const nestedBase = parsedBase.extends
    ? await resolveBaseChain({
        name: getBaseName(discoveredBase.filePath),
        baseLayers:
          discoveredBase.matchedBaseIndex === undefined
            ? baseLayers
            : baseLayers.slice(discoveredBase.matchedBaseIndex + 1),
        extendsValue: parsedBase.extends,
        fromFilePath: discoveredBase.filePath,
        options,
        optional: false,
        visited: nextVisited,
        depth: depth + 1
      })
    : undefined;

  return {
    layers: [
      {
        source: discoveredBase.source,
        data: parsedBase.data
      },
      ...(nestedBase?.layers ?? [])
    ],
    chain: [discoveredBase.filePath, ...(nestedBase?.chain ?? [])]
  };
}

async function resolveBase({
  name,
  baseLayers,
  extendsValue,
  fromFilePath,
  options,
  optional
}: {
  name: string;
  baseLayers: BaseLayer[];
  extendsValue: boolean | string;
  fromFilePath: string;
  options: ResolveOptions;
  optional: boolean;
}): Promise<ResolvedBase | undefined> {
  if (typeof extendsValue === "string") {
    return readPathValuedBase(extendsValue, fromFilePath, options);
  }

  let discoveredBase;

  try {
    discoveredBase = await findBase(
      name,
      baseLayers.map((layer) => layer.path),
      options.fs
    );
  } catch (error) {
    if (optional && isBaseNotFoundError(error)) {
      return undefined;
    }

    throw error;
  }

  const discoveredBaseDirectory = path.resolve(path.dirname(discoveredBase.filePath));
  const matchedBaseIndex = baseLayers.findIndex(
    (layer) => path.resolve(layer.path) === discoveredBaseDirectory
  );

  if (matchedBaseIndex === -1) {
    throw new Error(`Resolved base is outside configured base paths: ${discoveredBase.filePath}`);
  }

  return {
    content: discoveredBase.content,
    filePath: discoveredBase.filePath,
    matchedBaseIndex,
    source: baseLayers[matchedBaseIndex].source
  };
}

async function readPathValuedBase(
  extendsPath: string,
  fromFilePath: string,
  options: ResolveOptions
): Promise<ResolvedBase> {
  const filePath = path.resolve(path.dirname(fromFilePath), extendsPath);

  try {
    return {
      content: await options.fs.readFile(filePath, "utf8"),
      filePath,
      source: filePath
    };
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR")) {
      throw new Error(`base file not found at ${filePath}`);
    }

    throw error;
  }
}

function collectDataLayers(chain: ChainLayer[]): DataLayer[] {
  return chain.filter(isDataLayer);
}

interface ComposedPromptResult {
  consumedBaseIndexes: Set<number>;
  prompt: string;
  source?: string;
}

function composePromptChain(
  documentLayer: DataLayer,
  baseLayers: DataLayer[]
): ComposedPromptResult | undefined {
  const documentPrompt = getOwnEntry(documentLayer.data, "prompt");

  if (documentPrompt !== undefined && typeof documentPrompt !== "string") {
    return undefined;
  }

  if (documentPrompt !== undefined) {
    assertValidYieldCount(documentPrompt);
  }

  let prompt = documentPrompt;
  let source = prompt === undefined || prompt === "" ? undefined : documentLayer.source;
  const consumedBaseIndexes = new Set<number>();

  for (const [index, layer] of baseLayers.entries()) {
    const candidate = getOwnEntry(layer.data, "prompt");

    if (candidate === undefined) {
      continue;
    }

    if (typeof candidate !== "string") {
      break;
    }

    assertValidYieldCount(candidate);
    consumedBaseIndexes.add(index);
    prompt = composeAdjacentPrompts(prompt, candidate);

    if (source === undefined && candidate !== "") {
      source = layer.source;
    }
  }

  if (prompt !== undefined && prompt.includes(YIELD_TOKEN)) {
    throw new Error('Final resolved prompt contains an unresolved "{{yield}}" token.');
  }

  if (prompt === undefined) {
    return undefined;
  }

  return {
    consumedBaseIndexes,
    prompt,
    source
  };
}

function composeAdjacentPrompts(high: string | undefined, low: string): string {
  if (high === undefined || high === "") {
    return low.includes(YIELD_TOKEN) ? replaceYield(low, "") : low;
  }

  if (high.includes(YIELD_TOKEN)) {
    return replaceYield(high, low);
  }

  if (low.includes(YIELD_TOKEN)) {
    return replaceYield(low, high);
  }

  return high;
}

function replaceYield(prompt: string, replacement: string): string {
  return prompt.split(YIELD_TOKEN).join(replacement);
}

async function expandPromptPartials(
  documentLayer: DataLayer,
  baseLayers: DataLayer[],
  promptFiles: string[],
  options: ResolveOptions
): Promise<{ baseLayers: DataLayer[]; documentLayer: DataLayer; partialFiles: string[] }> {
  const directories = unique(promptFiles.map((filePath) => path.dirname(filePath)));
  const partials: Record<string, string> = Object.create(null) as Record<string, string>;
  const partialFiles: string[] = [];

  const loadPartial = async (name: string): Promise<void> => {
    if (name.trim().length === 0) {
      throw new Error("Partial name must be non-empty.");
    }

    if (Object.hasOwn(partials, name)) {
      return;
    }

    const partial = await findPartial(name, directories, options.fs);
    partials[name] = partial.content;
    partialFiles.push(partial.filePath);
    for (const nestedName of getTemplatePartialNames(partial.content)) {
      await loadPartial(nestedName);
    }
  };

  const promptLayers = [documentLayer, ...baseLayers];
  for (const layer of promptLayers) {
    const prompt = getOwnEntry(layer.data, "prompt");
    if (typeof prompt !== "string") {
      continue;
    }
    for (const name of getTemplatePartialNames(prompt)) {
      await loadPartial(name);
    }
  }

  const expandedLayers = promptLayers.map((layer) => withExpandedPrompt(layer, partials));

  return {
    documentLayer: expandedLayers[0],
    baseLayers: expandedLayers.slice(1),
    partialFiles
  };
}

function withExpandedPrompt(layer: DataLayer, partials: Record<string, string>): DataLayer {
  const prompt = getOwnEntry(layer.data, "prompt");
  if (typeof prompt !== "string") {
    return layer;
  }

  return {
    source: layer.source,
    data: {
      ...layer.data,
      prompt: resolveTemplatePartials(prompt, partials)
    }
  };
}

function renderPrompt(prompt: string, options: ResolveOptions): string {
  if (options.view === undefined && options.validate !== true) {
    return prompt;
  }

  return renderTemplate(prompt, options.view ?? {}, { escape: "none", validate: options.validate });
}

async function findPartial(
  name: string,
  directories: string[],
  fs: ResolveOptions["fs"]
): Promise<{ content: string; filePath: string }> {
  const checkedPaths: string[] = [];

  for (const directory of directories) {
    const filePath = path.join(directory, `${name}.md`);
    assertInsideDirectory(name, directory, filePath);
    checkedPaths.push(filePath);

    try {
      return { content: await fs.readFile(filePath, "utf8"), filePath };
    } catch (error) {
      if (hasOwnErrorCode(error, "ENOENT")) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Partial "${name}" not found.\nChecked paths:\n- ${checkedPaths.join("\n- ")}`);
}

function assertInsideDirectory(name: string, directory: string, filePath: string): void {
  const relativePath = path.relative(path.resolve(directory), path.resolve(filePath));
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Partial name must remain inside prompt directories: "${name}".`);
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function assertValidYieldCount(prompt: string): void {
  if (countYieldTokens(prompt) > 1) {
    throw new Error('Prompt composition supports exactly one "{{yield}}" token per prompt.');
  }
}

function countYieldTokens(prompt: string): number {
  return prompt.split(YIELD_TOKEN).length - 1;
}

function withResolvedPrompt(
  data: Record<string, unknown>,
  prompt: string | undefined
): Record<string, unknown> {
  if (prompt === undefined) {
    return data;
  }

  return {
    ...data,
    prompt
  };
}

function stripResolvedBasePrompts(
  layers: DataLayer[],
  consumedBaseIndexes: Set<number>
): DataLayer[] {
  return layers.map((layer, index) => {
    if (!consumedBaseIndexes.has(index) || typeof getOwnEntry(layer.data, "prompt") !== "string") {
      return layer;
    }

    const { prompt: ignoredPrompt, ...data } = layer.data;

    void ignoredPrompt;

    return {
      source: layer.source,
      data
    };
  });
}

function getBaseName(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

function shouldResolveBase(
  parsedDocument: ReturnType<typeof parseDocument>,
  autoExtend: boolean | undefined
): boolean {
  return parsedDocument.extends !== false || (autoExtend === true && !parsedDocument.hasExtendsField);
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function isBaseNotFoundError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    error.message.startsWith('Base "') &&
    error.message.includes('" not found.\nChecked paths:')
  );
}

function isDataLayer(layer: ChainLayer): layer is DataLayer {
  return "data" in layer;
}

function isDocumentLayer(layer: ChainLayer): layer is DocumentLayer {
  return "filePath" in layer && "content" in layer;
}

function isBaseLayer(layer: ChainLayer): layer is BaseLayer {
  return "path" in layer;
}
