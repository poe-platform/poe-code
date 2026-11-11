import { expect, it } from "vitest";
import { flacFormatTags } from "./flac-tags.js";
import { encodeComments, parseComments } from "./vorbis.js";
import type { AudioNode } from "./types.js";

function block(comments: string[]): AudioNode {
  return { type: "VORBIS_COMMENT", offset: 0, size: 0, data: new Uint8Array(), fields: { comments } };
}

it("joins case-insensitive FLAC keys in value order with the last spelling", () => {
  expect(flacFormatTags([block(["Artist=Alice", "ROLE=Voice", "artist=Bob", "role=Music", "Artist=Chloé"])]))
    .toEqual({ Artist: "Alice;Bob;Chloé", role: "Voice;Music" });
});

it("replaces prior FLAC comment blocks case-insensitively", () => {
  expect(flacFormatTags([block(["ARTIST=Alice", "ROLE=Voice"]), block(["artist=Bob", "Artist=Chloé"])]))
    .toEqual({ Artist: "Bob;Chloé", ROLE: "Voice" });
});

it("retains Vorbis key spelling while encoding normalized audio aliases", () => {
  expect(parseComments(encodeComments({ title: "Song", artist: "Alice;Bob", role: "Voice;Music", Artist: "Chloé", track: "2", disc: "1", albumArtist: "Band" })).comments)
    .toEqual(["title=Song", "artist=Alice;Bob", "role=Voice;Music", "Artist=Chloé", "TRACKNUMBER=2", "DISCNUMBER=1", "ALBUMARTIST=Band"]);
});
