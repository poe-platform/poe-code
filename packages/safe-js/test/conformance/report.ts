export type AccountedEntry = { filename: string; sourceHash?: string; kind: string;
  results?: Array<{ mode: string; status: string; reason?: string }> };
export function countEntries(entries: readonly AccountedEntry[]) {
  const counts = { files: entries.length, fixtures: 0, metadataErrors: 0, executionErrors: 0,
    variants: 0, passed: 0, failed: 0, unsupported: 0 };
  for (const entry of entries) {
    if (entry.kind === "fixture") counts.fixtures++;
    else if (entry.kind === "metadata-error") counts.metadataErrors++;
    else if (entry.kind === "execution-error") counts.executionErrors++;
    else if (entry.kind === "test" && entry.results) {
      counts.variants += entry.results.length;
      for (const result of entry.results) {
        if (result.status !== "passed" && result.status !== "failed" && result.status !== "unsupported") throw new Error("Invalid result status");
        counts[result.status]++;
      }
    } else throw new Error("Invalid result entry");
  }
  return counts;
}
export type SelectionReport = { manifestId: string; selected: string[]; entries: AccountedEntry[];
  counts: ReturnType<typeof countEntries>; complete: boolean };
export type CoverageManifest = { id: string; files: Array<{ filename: string; sourceHash: string; kind: string; variants: Array<{ mode: string }> }> };

export function aggregateReports(manifest: CoverageManifest, reports: readonly SelectionReport[]) {
  const expected = new Map(manifest.files.map(file => [file.filename, file]));
  if (expected.size !== manifest.files.length) throw new Error("Duplicate manifest file");
  const seen = new Set<string>();
  const entries: AccountedEntry[] = [];
  for (const report of reports) {
    if (!report.complete || report.manifestId !== manifest.id) throw new Error("Incomplete or mixed-provenance report");
    const selected = new Set(report.selected);
    if (selected.size !== report.selected.length || selected.size !== report.entries.length) throw new Error("Selection coverage mismatch");
    const counts = countEntries(report.entries);
    for (const key of Object.keys(counts) as Array<keyof typeof counts>) {
      if (counts[key] !== report.counts[key]) throw new Error("Summary counts mismatch");
    }
    for (const entry of report.entries) {
      const file = expected.get(entry.filename);
      if (!file || !selected.delete(entry.filename) || seen.has(entry.filename)) throw new Error("Unexpected or duplicate file result");
      if (entry.sourceHash !== file.sourceHash) throw new Error("Stale source hash");
      if (entry.kind !== file.kind && entry.kind !== "execution-error") throw new Error("File classification mismatch");
      if (entry.kind === "test") {
        const modes = entry.results?.map(result => result.mode).sort();
        if (JSON.stringify(modes) !== JSON.stringify(file.variants.map(variant => variant.mode).sort())) throw new Error("Missing or duplicate variant");
      }
      seen.add(entry.filename);
      entries.push(entry);
    }
    if (selected.size) throw new Error("Missing selected file");
  }
  if (seen.size !== expected.size) throw new Error(`Incomplete corpus coverage: ${seen.size}/${expected.size} files`);
  const counts = countEntries(entries);
  const enumeratedVariants = manifest.files.reduce((total, file) => total + file.variants.length, 0);
  const success = counts.variants > 0 && counts.variants === enumeratedVariants && counts.passed === counts.variants && counts.metadataErrors === 0 && counts.executionErrors === 0;
  return { complete: true, success, manifestId: manifest.id, enumeratedVariants, counts,
    mismatches: entries.filter(entry => entry.kind.endsWith("error") || entry.results?.some(result => result.status !== "passed")) };
}
