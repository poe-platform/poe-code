import path from "node:path";
import * as fileSystem from "node:fs/promises";
import { findUnreachableBundleOutputs } from "./bundle-graph.mjs";
import { assertSafeOutputDirectory } from "./guard-package-dist.mjs";

export async function publishBundleOutputs(
  result,
  { outdir, entryPoints, workingDirectory },
  files = fileSystem
) {
  const outputDirectory = path.resolve(workingDirectory, outdir);
  const packageDirectory = path.dirname(outputDirectory);
  const unreachable = new Set(
    findUnreachableBundleOutputs(result.metafile, entryPoints, workingDirectory).map((filename) =>
      path.resolve(workingDirectory, filename)
    )
  );
  const metadata = new Map(
    Object.entries(result.metafile.outputs).map(([filename, output]) => [
      path.resolve(workingDirectory, filename),
      output
    ])
  );
  const outputs = new Map();
  for (const output of result.outputFiles) {
    const filename = path.resolve(workingDirectory, output.path);
    const relative = path.relative(outputDirectory, filename);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(`Bundle output must remain inside its output directory: ${filename}`);
    }
    if (!metadata.has(filename) || outputs.has(filename)) {
      throw new Error(`Unexpected or duplicate bundle output file: ${filename}`);
    }
    outputs.set(filename, output);
  }
  if (outputs.size !== metadata.size) throw new Error("Missing bundle output files.");

  await assertSafeOutputDirectory(packageDirectory, outputDirectory, files);
  const chunkDirectory = path.join(outputDirectory, "chunks");
  await assertSafeOutputDirectory(packageDirectory, chunkDirectory, files);
  const previousChunks = await files
    .readdir(chunkDirectory, { withFileTypes: true })
    .catch((error) => {
      if (error?.code !== "ENOENT") throw error;
      return [];
    });
  const stale = new Set(unreachable);
  for (const entry of previousChunks) {
    if (!entry.isDirectory() && (entry.name.endsWith(".js") || entry.name.endsWith(".js.map"))) {
      const filename = path.join(chunkDirectory, entry.name);
      if (!outputs.has(filename)) stale.add(filename);
    }
  }
  for (const filename of new Set([...outputs.keys(), ...stale])) {
    await assertSafeOutputDirectory(packageDirectory, filename, files);
  }
  const reachable = [...outputs.keys()].filter((filename) => !unreachable.has(filename));
  const entries = new Set(entryPoints.map((entry) => path.resolve(workingDirectory, entry)));
  const isEntry = (filename) => {
    const entry = metadata.get(filename).entryPoint;
    return entry !== undefined && entries.has(path.resolve(workingDirectory, entry));
  };
  reachable.sort((left, right) => Number(isEntry(left)) - Number(isEntry(right)));

  await files.mkdir(outputDirectory, { recursive: true });
  const staging = await files.mkdtemp(path.join(outputDirectory, ".bundle-"));
  try {
    for (const filename of reachable) {
      const temporary = path.join(staging, path.relative(outputDirectory, filename));
      await files.mkdir(path.dirname(temporary), { recursive: true });
      await files.writeFile(temporary, outputs.get(filename).contents);
    }
    for (const filename of reachable) {
      await files.mkdir(path.dirname(filename), { recursive: true });
      await files.rename(path.join(staging, path.relative(outputDirectory, filename)), filename);
    }
    for (const filename of stale) await files.rm(filename, { force: true });
  } finally {
    await files.rm(staging, { recursive: true, force: true });
  }
}
