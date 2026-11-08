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
  const tags: AudioTags = {};
  for (const node of nodes) {
    if (node.type !== "VORBIS_COMMENT") continue;
    const block: AudioTags = {};
    for (const comment of node.fields?.comments as string[] ?? []) {
      const split = comment.indexOf("=");
      if (split <= 0) continue;
      const key = flacFormatTagName(comment.slice(0, split)), value = comment.slice(split + 1);
      Object.defineProperty(block, key, { value: Object.hasOwn(block, key) && block[key] ? `${block[key]};${value}` : value, enumerable: true, configurable: true });
    }
    for (const [key, value] of Object.entries(block)) Object.defineProperty(tags, key, { value, enumerable: true, configurable: true });
  }
  return tags;
}
