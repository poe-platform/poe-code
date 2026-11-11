// FFmpeg's AVDictionary fills a removed entry's slot with its last entry.
export function updateAudioMetadata(tags: Map<string, string>, key: string, value?: string): void {
  if (tags.has(key)) {
    const entries = Array.from(tags);
    const index = entries.findIndex(([name]) => name === key);
    const last = entries.pop()!;
    if (index < entries.length) entries[index] = last;
    tags.clear();
    for (const [name, text] of entries) tags.set(name, text);
  }
  if (value !== undefined) tags.set(key, value);
}
