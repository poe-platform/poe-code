/** Shared MP4 item names; document metadata includes fields omitted by ffprobe. */
export const mp4TextMetadataKeys: Readonly<Record<string, 'title' | 'artist' | 'albumArtist' | 'album' | 'date' | 'comment' | 'genre' | 'encoder' | 'description' | 'copyright'>> = {
  '©nam': 'title', '©ART': 'artist', aART: 'albumArtist', '©alb': 'album', '©day': 'date', '©cmt': 'comment', '©gen': 'genre', '©too': 'encoder', desc: 'description', cprt: 'copyright'
};
export const mp4ProbeMetadataKeys = ['title', 'artist', 'album', 'date', 'comment', 'genre', 'encoder'] as const;
