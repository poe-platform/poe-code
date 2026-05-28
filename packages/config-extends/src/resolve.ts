import path from "node:path";
import { renderTemplate } from "@poe-code/design-system";
import { findBase } from "./discover.js";
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
        options,
        optional: !parsedDocument.extends,
        visited: new Set([documentLayer.filePath]),
        depth: 1
      })
    : undefined;
  const composedPrompt = composePromptChain(
    {
      source: documentLayer.source,
      data: parsedDocument.data
    },
    resolvedBase?.layers ?? []
  );
  const merged = mergeLayers([
    ...collectDataLayers(chain.slice(0, documentIndex)),
    {
      source: documentLayer.source,
      data: withResolvedPrompt(parsedDocument.data, composedPrompt?.prompt)
    },
    ...stripResolvedBasePrompts(resolvedBase?.layers ?? [], composedPrompt?.consumedBaseIndexes ?? new Set<number>()),
    ...collectDataLayers(chain.slice(documentIndex + 1))
  ]);

  if (composedPrompt !== undefined && merged.sources.prompt === documentLayer.source && composedPrompt.source !== undefined) {
    merged.sources.prompt = composedPrompt.source;
  }

  return {
    data: merged.data,
    sources: merged.sources,
    chain: [documentLayer.filePath, ...(resolvedBase?.chain ?? [])]
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
  options,
  optional,
  visited,
  depth
}: {
  name: string;
  baseLayers: BaseLayer[];
  options: ResolveOptions;
  optional: boolean;
  visited: Set<string>;
  depth: number;
}): Promise<ResolvedBaseChain | undefined> {
  if (depth > MAX_EXTENDS_DEPTH) {
    throw new Error(`Maximum extends depth exceeded (${MAX_EXTENDS_DEPTH}).`);
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

  if (visited.has(discoveredBase.filePath)) {
    if (optional) {
      return undefined;
    }

    throw new Error(
      `Circular extends detected.\nVisited files:\n- ${[...visited, discoveredBase.filePath].join("\n- ")}`
    );
  }

  const discoveredBaseDirectory = path.resolve(path.dirname(discoveredBase.filePath));
  const matchedBaseIndex = baseLayers.findIndex(
    (layer) => path.resolve(layer.path) === discoveredBaseDirectory
  );

  if (matchedBaseIndex === -1) {
    throw new Error(`Resolved base is outside configured base paths: ${discoveredBase.filePath}`);
  }

  const parsedBase = parseDocument(discoveredBase.content, discoveredBase.filePath);
  const nextVisited = new Set(visited);
  nextVisited.add(discoveredBase.filePath);
  const nestedBase = parsedBase.extends
    ? await resolveBaseChain({
        name: getBaseName(discoveredBase.filePath),
        baseLayers: baseLayers.slice(matchedBaseIndex + 1),
        options,
        optional: false,
        visited: nextVisited,
        depth: depth + 1
      })
    : undefined;

  return {
    layers: [
      {
        source: baseLayers[matchedBaseIndex].source,
        data: parsedBase.data
      },
      ...(nestedBase?.layers ?? [])
    ],
    chain: [discoveredBase.filePath, ...(nestedBase?.chain ?? [])]
  };
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
  const documentPrompt = documentLayer.data.prompt;

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
    const candidate = layer.data.prompt;

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

function composeAdjacentPrompts(
  high: string | undefined,
  low: string
): string {
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

function replaceYield(
  prompt: string,
  replacement: string
): string {
  return renderTemplate(prompt, {}, { yield: replacement, escape: "none" });
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
    if (!consumedBaseIndexes.has(index) || typeof layer.data.prompt !== "string") {
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
  return parsedDocument.extends || (autoExtend === true && !parsedDocument.hasExtendsField);
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
