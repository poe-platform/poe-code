const nodeModulesSegment = "node_modules/";

function canonicalizeDependencyPath(value) {
  const nodeModulesIndex = value.indexOf(nodeModulesSegment);
  return nodeModulesIndex === -1 ? value : value.slice(nodeModulesIndex);
}

export function createToolcraftBundleOptions(entryPoint, outfile) {
  return {
    bundle: true,
    entryPoints: [entryPoint],
    format: "esm",
    outfile,
    platform: "node",
    sourcemap: "external",
    sourcesContent: true,
    splitting: false,
    target: "node18"
  };
}

export function canonicalizeToolcraftBundle({ bundle, sourceMap }) {
  const canonicalBundle = bundle
    .split("\n")
    .map((line) => {
      if (!line.startsWith("// ")) {
        return line;
      }
      return `// ${canonicalizeDependencyPath(line.slice(3))}`;
    })
    .join("\n");
  const parsedSourceMap = JSON.parse(sourceMap);

  if (Array.isArray(parsedSourceMap.sources)) {
    parsedSourceMap.sources = parsedSourceMap.sources.map((source) =>
      typeof source === "string" ? canonicalizeDependencyPath(source) : source
    );
  }

  return {
    bundle: canonicalBundle,
    sourceMap: JSON.stringify(parsedSourceMap)
  };
}
