/** Shared MP4 item names and ffprobe tag names. */
export const mp4TextMetadataKeys: Readonly<Record<string, 'title' | 'artist' | 'albumArtist' | 'composer' | 'album' | 'date' | 'comment' | 'genre' | 'encoder' | 'description' | 'copyright'>> = {
  '©nam': 'title', '©ART': 'artist', aART: 'albumArtist', '©wrt': 'composer', '©alb': 'album', '©day': 'date', '©cmt': 'comment', '©gen': 'genre', '©too': 'encoder', desc: 'description', cprt: 'copyright'
};
export const mp4ProbeMetadataKeys = {
  title: 'title', artist: 'artist', albumArtist: 'album_artist', composer: 'composer',
  album: 'album', date: 'date', comment: 'comment', genre: 'genre', encoder: 'encoder',
  compilation: 'compilation', copyright: 'copyright', description: 'description',
  trackNumber: 'track', discNumber: 'disc'
} as const;
