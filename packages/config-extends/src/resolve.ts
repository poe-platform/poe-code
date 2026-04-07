import path from "node:path";
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
        name: getBaseName(documentLayer.filePath),
        baseLayers,
        options,
        optional: !parsedDocument.extends,
        visited: new Set([documentLayer.filePath]),
        depth: 1
      })
    : undefined;
  const merged = mergeLayers([
    ...collectDataLayers(chain.slice(0, documentIndex)),
    {
      source: documentLayer.source,
      data: parsedDocument.data
    },
    ...(resolvedBase?.layers ?? []),
    ...collectDataLayers(chain.slice(documentIndex + 1))
  ]);

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
    throw new Error(
      `Circular extends detected.\nVisited files:\n- ${[...visited, discoveredBase.filePath].join("\n- ")}`
    );
  }

  const matchedBaseIndex = baseLayers.findIndex(
    (layer) => layer.path === path.dirname(discoveredBase.filePath)
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
