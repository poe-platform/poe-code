import type { AudioNode, AudioTags } from "./types.js";

const names: Readonly<Record<string, string>> = {
  ALBUMARTIST: "album_artist", TRACKNUMBER: "track", DISCNUMBER: "disc", DESCRIPTION: "comment"
};

/** FFmpeg's Vorbis-to-container names; other comment names retain their spelling. */
export function flacFormatTagName(name: string): string {
  return names[name.toUpperCase()] ?? name;
}

/** Container-facing tags, separate from the audio editor's normalized tags. */
export function flacFormatTags(nodes: readonly AudioNode[]): AudioTags {
  const tags = new Map<string, [string, string]>();
  for (const node of nodes) {
    if (node.type !== "VORBIS_COMMENT") continue;
    const block = new Map<string, [string, string]>();
    for (const comment of node.fields?.comments as string[] ?? []) {
      const split = comment.indexOf("=");
      if (split <= 0) continue;
      const key = flacFormatTagName(comment.slice(0, split)), value = comment.slice(split + 1);
      const folded = key.toUpperCase(), previous = block.get(folded)?.[1];
      block.set(folded, [key, previous ? `${previous};${value}` : value]);
    }
    for (const [key, entry] of block) tags.set(key, entry);
  }
  return Object.fromEntries(tags.values());
}
