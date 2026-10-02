/** Local opt-in protocol oracle. No remote/provider qualification is implied. */
import { beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createSocket } from 'node:dgram';
import { createServer as createTcpServer, connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createCipheriv, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { nativeReference } from '../src/index.js';
import { runNative } from './runner.js';
const b = (s: string) => new TextEncoder().encode(s);
const env = { PATH: '/usr/bin:/bin', HOME: '/nonexistent', LC_ALL: 'C', LANG: 'C', TZ: 'UTC' };
const invoke = (tool: 'ffmpeg' | 'ffprobe', args: string[]) => runNative(nativeReference.executables[tool].path, args.map(b), { cwd: '/tmp', env, stdin: new Uint8Array() });
async function server(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const instance = createServer(handler);
  await new Promise<void>(resolve => instance.listen(0, '127.0.0.1', resolve));
  const address = instance.address();
  if (!address || typeof address === 'string') throw new Error('Missing local address');
  return { url: `http://127.0.0.1:${address.port}`, close: async () => {
    instance.closeAllConnections();
    await new Promise<void>((resolve, reject) => instance.close(error => error ? reject(error) : resolve()));
  } };
}
function wav(): Buffer {
  const data = Buffer.alloc(160044);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(data.length - 44, 40);
  return data;
}
function serveBytes(req: IncomingMessage, res: ServerResponse, data: Buffer) {
  const range = req.headers.range?.slice(6).split('-');
  const start = range ? Number(range[0]) : 0;
  const end = range?.[1] ? Number(range[1]) : data.length - 1;
  res.writeHead(range ? 206 : 200, { 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}) });
  res.end(data.subarray(start, end + 1));
}
describe.skipIf(process.env.MEDIA_NETWORK_ORACLE !== '1')('selected native network oracle', () => {
  let segment: Buffer;
  beforeAll(async () => {
    for (const entry of Object.values(nativeReference.executables)) expect(createHash('sha256').update(await readFile(entry.path)).digest('hex')).toBe(entry.sha256);
    const result = await invoke('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=16x16:rate=10', '-t', '1', '-c:v', 'mpeg2video', '-f', 'mpegts', 'pipe:1']);
    expect(result.exitCode, Buffer.from(result.stderr, 'base64').toString()).toBe(0);
    segment = Buffer.from(result.stdout, 'base64');
  });
  it('rejects empty protocol spelling at native AVIO rather than opening a local filename', async () => {
    const result = await invoke('ffprobe', ['-v', 'error', ':opaque?sig=%2f+synthetic']);
    expect(result.exitCode).not.toBe(0);
    expect(Buffer.from(result.stderr, 'base64').toString()).toContain('Protocol not found');
  });
  it('resolves the redirected HLS playlist and retains its same-origin custom header', async () => {
    const requests: { path?: string; header?: string | string[] }[] = [];
    const local = await server((req, res) => {
      requests.push({ path: req.url, header: req.headers['x-oracle'] });
      if (req.url === '/entry.m3u8?original=synthetic') { res.writeHead(302, { Location: '/nested/index.m3u8?token=synthetic' }); res.end(); }
      else if (req.url === '/nested/index.m3u8?token=synthetic') res.end('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST\n');
      else if (req.url === '/nested/segment.ts') serveBytes(req, res, segment);
      else { res.writeHead(404); res.end(); }
    });
    try {
      const result = await invoke('ffprobe', ['-v', 'error', '-headers', 'X-Oracle: synthetic\r\n', '-show_entries', 'stream=codec_name', local.url + '/entry.m3u8?original=synthetic']);
      expect(result.exitCode, Buffer.from(result.stderr, 'base64').toString()).toBe(0);
      expect(requests).toEqual(['/entry.m3u8?original=synthetic', '/nested/index.m3u8?token=synthetic', '/nested/segment.ts'].map(path => ({ path, header: 'synthetic' })));
    } finally { await local.close(); }
  });
  it('keeps native reference syntax separate from AVIO protocol selection', async () => {
    const requests: string[] = [];
    const local = await server((req, res) => {
      requests.push(req.url!);
      if (req.url === '/index.m3u8') res.end('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\ncustom_scheme:segment.ts\n#EXT-X-ENDLIST\n');
      else serveBytes(req, res, segment);
    });
    try {
      const result = await invoke('ffprobe', ['-v', 'error', '-protocol_whitelist', 'http,tcp', local.url + '/index.m3u8']);
      expect(result.exitCode).not.toBe(0);
      expect(Buffer.from(result.stderr, 'base64').toString()).toContain("Protocol 'file' not on whitelist");
      expect(requests).toEqual(['/index.m3u8']);
    } finally { await local.close(); }
  });
  it('resolves DASH segments against the redirected manifest without inheriting its query', async ({ skip }) => {
    const demuxers = await invoke('ffprobe', ['-v', 'error', '-demuxers']);
    expect(demuxers.exitCode).toBe(0);
    const hasDash = Buffer.from(demuxers.stdout, 'base64').toString().split('\n')
      .some(line => line.trim().split(' ').filter(Boolean)[1] === 'dash');
    if (!hasDash) skip('Selected executable has no DASH demuxer; native DASH redirect compatibility remains a gap');
    const requests: { path?: string; header?: string | string[] }[] = [];
    const local = await server((req, res) => {
      requests.push({ path: req.url, header: req.headers['x-oracle'] });
      if (req.url === '/entry.mpd?original=synthetic') {
        res.writeHead(302, { Location: '/nested/index.mpd?token=synthetic' }); res.end();
      } else if (req.url === '/nested/index.mpd?token=synthetic') {
        res.end('<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:mp2t-simple:2011" type="static" mediaPresentationDuration="PT1S" minBufferTime="PT1S"><Period><AdaptationSet mimeType="video/mp2t"><Representation id="video" bandwidth="100000"><SegmentList duration="1"><SegmentURL media="segment.ts?sig=%2f+synthetic"/></SegmentList></Representation></AdaptationSet></Period></MPD>');
      } else if (req.url === '/nested/segment.ts?sig=%2f+synthetic') serveBytes(req, res, segment);
      else { res.writeHead(404); res.end(); }
    });
    try {
      const result = await invoke('ffprobe', ['-v', 'error', '-headers', 'X-Oracle: synthetic\r\n', '-show_entries', 'stream=codec_name', local.url + '/entry.mpd?original=synthetic']);
      expect(result.exitCode, Buffer.from(result.stderr, 'base64').toString()).toBe(0);
      expect(requests).toEqual(['/entry.mpd?original=synthetic', '/nested/index.mpd?token=synthetic', '/nested/segment.ts?sig=%2f+synthetic'].map(path => ({ path, header: 'synthetic' })));
      expect(Buffer.from(result.stdout, 'base64').toString()).toContain('mpeg2video');
    } finally { await local.close(); }
  });
  it('observes cross-origin header and cookie behavior independently', async () => {
    const received: IncomingMessage['headers'][] = [];
    const destination = await server((req, res) => { received.push(req.headers); serveBytes(req, res, wav()); });
    const origin = await server((_req, res) => { res.writeHead(302, { Location: destination.url + '/audio.wav' }); res.end(); });
    try {
      const result = await invoke('ffprobe', ['-v', 'error', '-headers', 'X-Oracle: synthetic\r\n', '-cookies', 'secret=synthetic; domain=unrelated.invalid; path=/\n', origin.url + '/entry']);
      expect(result.exitCode, Buffer.from(result.stderr, 'base64').toString()).toBe(0);
      // Native custom headers are forwarded across this port-origin redirect;
      // cookie domain matching independently excludes the unrelated credential.
      expect(received.length).toBeGreaterThan(0);
      expect(received.every(h => h['x-oracle'] === 'synthetic' && h.cookie === undefined)).toBe(true);
    } finally { await origin.close(); await destination.close(); }
  });
  it('reports the selected build DASH demuxer gap without opening a manifest', async () => {
    const paths: string[] = [];
    const local = await server((req, res) => { paths.push(req.url!); res.end('<MPD/>'); });
    try {
      const result = await invoke('ffprobe', ['-v', 'error', '-f', 'dash', local.url + '/entry.mpd?sig=synthetic']);
      expect(result.exitCode).not.toBe(0);
      expect(Buffer.from(result.stderr, 'base64').toString()).toContain("Unknown input format: dash");
      expect(paths).toEqual([]);
    } finally { await local.close(); }
  });
  it('preserves signed query octets and consumes the entry only once', async () => {
    const paths: string[] = [];
    const local = await server((req, res) => {
      paths.push(req.url!);
      if (paths.length > 1) { res.writeHead(410); res.end('Synthetic single-use URL consumed'); }
      else serveBytes(req, res, wav());
    });
    try {
      expect((await invoke('ffprobe', ['-v', 'error', '-seekable', '0', local.url + '/a.wav?sig=%2f+%FF&x=1&x=2'])).exitCode).toBe(0);
      expect(paths).toEqual(['/a.wav?sig=%2f+%FF&x=1&x=2']);
    } finally { await local.close(); }
  });
  it('matches cookies at each redirect authority rather than copying origin credentials', async () => {
    const received: IncomingMessage['headers'][] = [];
    const destination = await server((req, res) => { received.push(req.headers); serveBytes(req, res, wav()); });
    const originCookies: (string | undefined)[] = [];
    const origin = await server((req, res) => {
      originCookies.push(req.headers.cookie);
      res.writeHead(302, { Location: destination.url.replace('127.0.0.1', 'localhost') + '/audio.wav' }); res.end();
    });
    try {
      // Selected http.c passes hoststr (including this non-default port) to
      // get_cookies. Qualify native behavior rather than browser cookie rules.
      const result = await invoke('ffprobe', ['-v', 'error', '-seekable', '0', '-cookies', `secret=synthetic; domain=${new URL(origin.url).host}; path=/\n`, origin.url + '/entry']);
      expect(result.exitCode, Buffer.from(result.stderr, 'base64').toString()).toBe(0);
      expect(originCookies).toEqual(['secret=synthetic']);
      expect(received.length).toBeGreaterThan(0);
      expect(received.every(h => h.cookie === undefined)).toBe(true);
    } finally { await origin.close(); await destination.close(); }
  });
  it('qualifies cross-host HLS headers and cookies at playlist and segment opens', async () => {
    const received: { path: string; header: string | string[] | undefined; cookie: string | undefined }[] = [];
    const destination = await server((req, res) => {
      received.push({ path: req.url!, header: req.headers['x-oracle'], cookie: req.headers.cookie });
      if (req.url === '/nested/index.m3u8?token=synthetic') {
        res.end('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nsegment.ts?sig=%2f+%FF&x=1&x=2\n#EXT-X-ENDLIST\n');
      } else if (req.url === '/nested/segment.ts?sig=%2f+%FF&x=1&x=2') {
        serveBytes(req, res, segment);
      } else { res.writeHead(404); res.end(); }
    });
    const originCookies: (string | undefined)[] = [];
    const origin = await server((req, res) => {
      originCookies.push(req.headers.cookie);
      res.writeHead(302, { Location: destination.url.replace('127.0.0.1', 'localhost') + '/nested/index.m3u8?token=synthetic' });
      res.end();
    });
    try {
      const result = await invoke('ffprobe', ['-v', 'error', '-headers', 'X-Oracle: synthetic\r\n',
        '-cookies', `secret=synthetic; domain=${new URL(origin.url).host}; path=/\n`,
        '-show_entries', 'stream=codec_name', origin.url + '/entry.m3u8?original=synthetic']);
      expect(result.exitCode, Buffer.from(result.stderr, 'base64').toString()).toBe(0);
      expect(originCookies).toEqual(['secret=synthetic']);
      // These are observations of selected native behavior, not an instruction
      // for the discovery layer or a transport relay to copy credentials.
      expect(received).toEqual([
        '/nested/index.m3u8?token=synthetic', '/nested/segment.ts?sig=%2f+%FF&x=1&x=2',
      ].map(path => ({ path, header: 'synthetic', cookie: undefined })));
    } finally { await origin.close(); await destination.close(); }
  });
  it('reloads a changing live playlist at native execution time', async () => {
    let playlists = 0;
    const paths: string[] = [];
    const local = await server((req, res) => {
      paths.push(req.url!);
      if (req.url === '/live.m3u8?sig=%2f+synthetic') {
        playlists++;
        res.end('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:1,\nfirst.ts\n'
          + (playlists > 1 ? '#EXTINF:1,\nsecond.ts\n#EXT-X-ENDLIST\n' : ''));
      } else if (req.url === '/first.ts' || req.url === '/second.ts') {
        serveBytes(req, res, segment);
      } else { res.writeHead(404); res.end(); }
    });
    try {
      const result = await invoke('ffmpeg', ['-v', 'error', '-http_persistent', '0', '-i', local.url + '/live.m3u8?sig=%2f+synthetic', '-f', 'null', '-']);
      expect(result.exitCode, Buffer.from(result.stderr, 'base64').toString()).toBe(0);
      expect(playlists).toBeGreaterThanOrEqual(2);
      expect(paths.filter(path => path.endsWith('.ts'))).toEqual(['/first.ts', '/second.ts']);
      expect(paths.indexOf('/second.ts')).toBeGreaterThan(paths.lastIndexOf('/live.m3u8?sig=%2f+synthetic'));
    } finally { await local.close(); }
  });
  it('issues native byte ranges for input seek', async () => {
    const ranges: (string | undefined)[] = [];
    const local = await server((req, res) => { ranges.push(req.headers.range); serveBytes(req, res, wav()); });
    try {
      const result = await invoke('ffmpeg', ['-v', 'error', '-ss', '8', '-i', local.url + '/a.wav', '-t', '0.1', '-f', 'null', '-']);
      expect(result.exitCode, Buffer.from(result.stderr, 'base64').toString()).toBe(0);
      expect(ranges[0]).toBe('bytes=0-');
      expect(ranges.some(r => r !== 'bytes=0-' && r?.startsWith('bytes='))).toBe(true);
    } finally { await local.close(); }
  });
  it.each([0, 188])('opens bounded HLS byte ranges with %i bytes between segments', async gap => {
    const ranges: (string | undefined)[] = [];
    const prefix = 188;
    const media = Buffer.concat([Buffer.alloc(prefix), segment, Buffer.alloc(gap), segment]);
    const local = await server((req, res) => {
      if (req.url === '/index.m3u8?parent=synthetic') {
        res.end(`#EXTM3U\n#EXT-X-VERSION:4\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n#EXT-X-BYTERANGE:${segment.length}@${prefix}\nshared.ts?sig=%2f+%FF\n#EXTINF:1,\n#EXT-X-BYTERANGE:${segment.length}${gap ? '@' + (prefix + segment.length + gap) : ''}\nshared.ts?sig=%2f+%FF\n#EXT-X-ENDLIST\n`);
      } else if (req.url === '/shared.ts?sig=%2f+%FF') {
        ranges.push(req.headers.range);
        serveBytes(req, res, media);
      } else { res.writeHead(404); res.end(); }
    });
    try {
      const result = await invoke('ffmpeg', ['-v', 'error', '-i', local.url + '/index.m3u8?parent=synthetic', '-f', 'null', '-']);
      expect(result.exitCode, Buffer.from(result.stderr, 'base64').toString()).toBe(0);
      // Selected hls.c coalesces adjacent ranges of the same URL. Preserve
      // that native policy rather than requiring a request per playlist entry.
      expect(ranges).toEqual(gap ? [
        `bytes=${prefix}-${prefix + segment.length - 1}`,
        `bytes=${prefix + segment.length + gap}-${prefix + 2 * segment.length + gap - 1}`,
      ] : [`bytes=${prefix}-${prefix + 2 * segment.length - 1}`]);
    } finally { await local.close(); }
  });
  it('lets native retry an explicitly retryable response', async () => {
    let attempts = 0;
    const local = await server((req, res) => {
      if (++attempts === 1) { res.writeHead(503, { 'Retry-After': '0' }); res.end(); }
      else serveBytes(req, res, wav());
    });
    try {
      const result = await invoke('ffprobe', ['-v', 'error', '-seekable', '0', '-reconnect_on_http_error', '503', '-reconnect_max_retries', '1', local.url + '/retry.wav']);
      expect(result.exitCode, Buffer.from(result.stderr, 'base64').toString()).toBe(0);
      expect(attempts).toBe(2);
    } finally { await local.close(); }
  });
  it('reports a network reset without an invented retry', async () => {
    let attempts = 0;
    const local = await server((req) => { attempts++; req.socket.destroy(); });
    try {
      expect((await invoke('ffprobe', ['-v', 'error', local.url + '/reset.wav'])).exitCode).not.toBe(0);
      expect(attempts).toBe(1);
    } finally { await local.close(); }
  });
  it('loads an encryption key at the native HLS stage', async () => {
    const key = Buffer.alloc(16, 7), iv = Buffer.alloc(16);
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(segment), cipher.final()]);
    const paths: string[] = [];
    const local = await server((req, res) => {
      paths.push(req.url!);
      if (req.url === '/index.m3u8') res.end('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-KEY:METHOD=AES-128,URI="key?sig=synthetic",IV=0x00000000000000000000000000000000\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST\n');
      else if (req.url === '/key?sig=synthetic') res.end(key);
      else if (req.url === '/segment.ts') serveBytes(req, res, encrypted);
      else { res.writeHead(404); res.end(); }
    });
    try {
      const result = await invoke('ffprobe', ['-v', 'error', local.url + '/index.m3u8']);
      expect(result.exitCode, Buffer.from(result.stderr, 'base64').toString()).toBe(0);
      expect(paths).toEqual(['/index.m3u8', '/key?sig=synthetic', '/segment.ts']);
    } finally { await local.close(); }
  });
  it('reloads a changing live playlist through native requests', async () => {
    let reloads = 0;
    const paths: string[] = [];
    const local = await server((req, res) => {
      paths.push(req.url!);
      if (req.url === '/live.m3u8') {
        const next = reloads++ > 0;
        res.end(`#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:${next ? 1 : 0}\n#EXTINF:1,\n${next ? 'next' : 'first'}.ts\n${next ? '#EXT-X-ENDLIST\n' : ''}`);
      } else serveBytes(req, res, segment);
    });
    try {
      const result = await invoke('ffmpeg', ['-v', 'error', '-i', local.url + '/live.m3u8', '-f', 'null', '-']);
      expect(result.exitCode, Buffer.from(result.stderr, 'base64').toString()).toBe(0);
      expect(reloads).toBeGreaterThan(1);
      expect(paths).toContain('/first.ts');
      expect(paths).toContain('/next.ts');
    } finally { await local.close(); }
  });
  it('opens an HLS init segment separately from media', async () => {
    const generated = await invoke('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=16x16:rate=10', '-t', '1', '-c:v', 'libx264', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1']);
    expect(generated.exitCode).toBe(0);
    const mp4 = Buffer.from(generated.stdout, 'base64');
    let offset = 0;
    while (offset + 8 <= mp4.length && mp4.toString('ascii', offset + 4, offset + 8) !== 'moof') {
      const size = mp4.readUInt32BE(offset);
      if (size < 8) throw new Error('Invalid fixture MP4 box');
      offset += size;
    }
    expect(offset).toBeLessThan(mp4.length);
    const paths: string[] = [];
    const local = await server((req, res) => {
      paths.push(req.url!);
      if (req.url === '/index.m3u8') res.end('#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:1\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\nmedia.m4s\n#EXT-X-ENDLIST\n');
      else serveBytes(req, res, req.url === '/init.mp4' ? mp4.subarray(0, offset) : mp4.subarray(offset));
    });
    try {
      const result = await invoke('ffprobe', ['-v', 'error', local.url + '/index.m3u8']);
      expect(result.exitCode, Buffer.from(result.stderr, 'base64').toString()).toBe(0);
      expect(paths).toEqual(['/index.m3u8', '/init.mp4', '/media.m4s']);
    } finally { await local.close(); }
  });
  it('supports native TCP listen rather than connecting to a rewritten URL', async () => {
    const reservation = createTcpServer();
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const address = reservation.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    const native = invoke('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '0.02', '-f', 's16le', `tcp://127.0.0.1:${address.port}?listen=1&listen_timeout=2000`]);
    let received: Buffer | undefined;
    for (let attempt = 0; attempt < 100 && !received; attempt++) {
      received = await new Promise<Buffer | undefined>((resolve, reject) => {
        const client = connect(address.port, '127.0.0.1');
        const chunks: Buffer[] = [];
        client.on('data', chunk => chunks.push(chunk));
        client.on('end', () => resolve(Buffer.concat(chunks)));
        client.on('error', (error: NodeJS.ErrnoException) => error.code === 'ECONNREFUSED' ? resolve(undefined) : reject(error));
      });
      if (!received) await delay(20);
    }
    const result = await native;
    expect(result.exitCode, Buffer.from(result.stderr, 'base64').toString()).toBe(0);
    expect(received?.length).toBe(320);
  });
  it('preserves native UDP packet sizing', async () => {
    const socket = createSocket('udp4');
    const lengths: number[] = [];
    socket.on('message', packet => lengths.push(packet.length));
    await new Promise<void>(resolve => socket.bind(0, '127.0.0.1', resolve));
    try {
      const result = await invoke('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '0.02', '-f', 's16le', `udp://127.0.0.1:${socket.address().port}?pkt_size=128`]);
      expect(result.exitCode, Buffer.from(result.stderr, 'base64').toString()).toBe(0);
      expect(lengths).toEqual([128, 128, 64]);
    } finally { await new Promise<void>(resolve => socket.close(resolve)); }
  });
});
