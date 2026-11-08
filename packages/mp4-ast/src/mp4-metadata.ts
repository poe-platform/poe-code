/** Shared MP4 item names; document metadata includes fields omitted by ffprobe. */
export const mp4TextMetadataKeys: Readonly<Record<string, 'title' | 'artist' | 'albumArtist' | 'composer' | 'album' | 'date' | 'comment' | 'genre' | 'encoder' | 'description' | 'copyright'>> = {
  '©nam': 'title', '©ART': 'artist', aART: 'albumArtist', '©wrt': 'composer', '©alb': 'album', '©day': 'date', '©cmt': 'comment', '©gen': 'genre', '©too': 'encoder', desc: 'description', cprt: 'copyright'
};
export const mp4ProbeMetadataKeys = ['title', 'artist', 'composer', 'album', 'date', 'comment', 'genre', 'encoder', 'compilation'] as const;
