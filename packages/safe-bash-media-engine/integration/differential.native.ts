/** Opt-in local same-build oracle. This does NOT qualify a remote filesystem bridge. */
import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFFmpegShims, grammarRevision, nativeReference, type Tool } from "../src/index.js";
import { runNative } from "./runner.js";
import { comparableDiagnostics } from "./diagnostics.js";
import { discover } from '../src/discover.js';
import { discoverContent } from '../src/content.js';
import { createDependencyResolver, resolveDependencies } from '../src/resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
let directory: string;
const env = { LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: "/nonexistent", PATH: "/usr/bin:/bin", AV_LOG_FORCE_NOCOLOR: "1" };
function wav(): Uint8Array {
  const bytes = new Uint8Array(1644);
  const view = new DataView(bytes.buffer);
  bytes.set(b("RIFF")); view.setUint32(4, bytes.length - 8, true); bytes.set(b("WAVEfmt "), 8);
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  bytes.set(b("data"), 36); view.setUint32(40, bytes.length - 44, true);
  for (let i = 44; i < bytes.length; i += 2) view.setInt16(i, (i * 97) % 30000, true);
  return bytes;
}
/** Original synthetic zero-weight model, not a copied trained asset. Network
 * dimensions follow the registered model format and compute_rnn feature layout. */
function noiseModel(): string {
  const zeros = (count: number) => Array(count).fill('0').join(' ') + '\n';
  const dense = (inputs: number, neurons: number) => `${inputs} ${neurons} 0\n` + zeros(inputs * neurons) + zeros(neurons);
  const gru = (inputs: number) => `${inputs} 1 0\n` + zeros(inputs * 3) + zeros(3) + zeros(3);
  return 'rnnoise-nu model file version 1\n' + dense(42, 1) + gru(1) + gru(44) + gru(44) + dense(1, 22) + dense(1, 1);
}
async function reset(rawFilename = false, literalFilename?: string, modelDescriptor = false): Promise<void> {
  for (const entry of await readdir(directory, { encoding: "buffer" })) await rm(Buffer.concat([Buffer.from(directory + "/"), entry]), { recursive: true, force: true });
  await writeFile(join(directory, "in.wav"), wav());
  await writeFile(join(directory, 'voice.rnnn'), noiseModel());
  if (modelDescriptor) await writeFile(join(directory, 'pipe:3'), noiseModel());
  await writeFile(join(directory, 'model-name.txt'), 'voice.rnnn\0ignored');
  if (rawFilename) await writeFile(Buffer.concat([Buffer.from(directory + '/'), Buffer.from([255, 46, 119, 97, 118])]), wav());
  await writeFile(join(directory, 'size.txt'), '32');
  await writeFile(join(directory, 'private.ffpreset'), '/probesize=size.txt\n');
  await writeFile(join(directory, 'delimiters.ffpreset'), '/attach=probe-input-option.txt\rignored\nattach=in.wav\0ignored\n');
  await writeFile(join(directory, 'leading-delimiters.ffpreset'), '==/attach=probe-input-option.txt\n');
  await writeFile(join(directory, 'empty.ffpreset'), 'attach=in.wav\nattach=\nattach=unreachable\n');
  await writeFile(join(directory, 'long.ffpreset'), '#' + 'x'.repeat(998) + 'attach=in.wav\n');
  await writeFile(join(directory, "-leading.wav"), wav());
  await writeFile(join(directory, "filter.txt"), "volume=0.5");
  await writeFile(join(directory, 'attachment-option.txt'), '-leading.wav\n\0missing-late');
  await writeFile(join(directory, '-leading.wav\n'), wav());
  await writeFile(join(directory, 'probe-input-option.txt'), 'in.wav\0missing-late');
  await writeFile(join(directory, 'probe-output-option.txt'), 'out.json');
  await writeFile(join(directory, 'first.json'), 'first output sentinel');
  await writeFile(join(directory, 'second.json'), 'second output sentinel');
  await writeFile(join(directory, 'missing-attachment-option.txt'), 'missing-attachment.txt');
  await writeFile(join(directory, '-'), 'volume=0.5');
  await writeFile(join(directory, 'title.srt'), '1\n00:00:00,000 --> 00:00:01,000\nCaption\n');
  await writeFile(join(directory, 'title.ass'), '[Script Info]\nScriptType: v4.00+\nPlayResX: 16\nPlayResY: 16\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,8,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,0,0,0,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,Caption\n');
  await writeFile(join(directory, 'stats-option.txt'), 'stats.txt');
  await writeFile(join(directory, 'pipe:0'), 'acodec=pcm_s16le\n');
  await writeFile(join(directory, "lavfi"), "wav");
  await writeFile(join(directory, "preset.ffpreset"), "acodec=pcm_s16le\n");
  for (const key of ['version', 'noversion', 'no/version', 'version:0']) {
    await writeFile(join(directory, `exit-${key.replaceAll('/', '-')}.ffpreset`), `${key}=ignored\nattach=unreachable.wav\n/af=unreachable.graph\n`);
  }
  await writeFile(join(directory, 'no-prefixed.ffpreset'), 'noss=0.02\nnoattach=in.wav\n');
  await writeFile(join(directory, 'no-slash.ffpreset'), 'no/attach=in.wav\n');
  for (const name of ['i', 'dec', 'version']) await writeFile(join(directory, `separator-${name}.ffpreset`), `${name}=opaque\n`);
  await writeFile(join(directory, 'no-prefixed-search.ffpreset'), 'nofpre=preset.ffpreset\n');
  await writeFile(join(directory, 'stream.ffpreset'), 'filter:a:0=ametadata=mode=add:key=foo:value=bar,ametadata=mode=print:file=stats.txt\n');
  await writeFile(join(directory, 'indirect.ffpreset'), '/filter:a:0=filter.txt\n');
  await writeFile(join(directory, 'missing-indirect.ffpreset'), '/filter:a:0=missing-graph.txt\n');
  await writeFile(join(directory, "seq01.ppm"), Buffer.concat([Buffer.from("P6\n1 1\n255\n"), Buffer.from([255, 0, 0])]));
  await writeFile(join(directory, "seq02.ppm"), Buffer.concat([Buffer.from("P6\n1 1\n255\n"), Buffer.from([0, 255, 0])]));
  const mask = Buffer.alloc(16 * 16);
  for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) mask[y * 16 + x] = 255;
  await writeFile(join(directory, 'mask.pgm'), Buffer.concat([Buffer.from('P5\n16 16\n255\n'), mask]));
  await writeFile(join(directory, 'mask-name.txt'), 'mask.pgm\0ignored-mask');
  // Original ACV master curve: map black to white and white to black.
  await writeFile(join(directory, 'look.acv'), Uint8Array.from([0, 1, 0, 1, 0, 2, 0, 255, 0, 0, 0, 0, 0, 255]));
  await writeFile(join(directory, 'curve-name.txt'), 'look.acv\0ignored-late.acv');
  await writeFile(join(directory, 'literal%02d.ppm'), Buffer.concat([Buffer.from('P6\n1 1\n255\n'), Buffer.from([0, 0, 255])]));
  await writeFile(join(directory, "concat.txt"), "ffconcat version 1.0\nfile in.wav\nfile missing-late.wav\n");
  await writeFile(join(directory, "concat-extra.txt"), "ffconcat version 1.0\nfile in.wav ignored\n");
  await writeFile(join(directory, 'concat-boundaries.txt'), 'file in.wav\rfile in.wav\r\nfile in.wav\0file in.wav\n');
  await writeFile(join(directory, 'concat-quoted-keyword.txt'), "file in.wav\n'file' unreachable.wav\nfile in.wav\n");
  if (literalFilename) await writeFile(join(directory, literalFilename), wav());
}
async function effects(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of await readdir(directory, { encoding: "buffer" })) {
    const data = await readFile(Buffer.concat([Buffer.from(directory + "/"), name]));
    result[name.toString("base64")] = data.toString("base64");
  }
  return result;
}
beforeAll(async () => {
  for (const entry of Object.values(nativeReference.executables)) {
    expect(createHash("sha256").update(await readFile(entry.path)).digest("hex")).toBe(entry.sha256);
  }
  const lock = JSON.parse(await readFile(new URL("../metadata/baselines/build-lock.json", import.meta.url), "utf8"));
  for (const [path, entry] of Object.entries(lock.binaries_and_dylibs) as [string, { sha256: string }][]) {
    // The recorded lock covers the reference runtime closure, not just version text.
    expect(createHash("sha256").update(await readFile(path)).digest("hex"), path).toBe(entry.sha256);
  }
  directory = await mkdtemp(join(tmpdir(), "media-cli-native-"));
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
const cases: [string, Tool, (string | Uint8Array)[]][] = [
  ['image2 AVIO numbered input', 'ffmpeg', ['-f', 'image2', '-i', 'file:seq%02d.ppm', '-frames:v', '2', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']],
  ['image2 AVIO probe input', 'ffprobe', ['-f', 'image2', '-i', 'file:seq%02d.ppm', '-show_entries', 'stream=width,height', '-of', 'json']],
  ['image2 AVIO numbered output', 'ffmpeg', ['-f', 'lavfi', '-i', 'testsrc2=size=16x16:duration=0.08', '-frames:v', '2', '-f', 'image2', 'file:avio%03d.ppm']],
  ['image2 AVIO update output', 'ffmpeg', ['-f', 'lavfi', '-i', 'testsrc2=size=16x16:duration=0.08', '-frames:v', '2', '-f', 'image2', '-update', '1', 'file:avio%03d.ppm']],
  ...['voice.rnnn', 'model=voice.rnnn', 'm=voice.rnnn', '/m=model-name.txt', "m='pipe\\:3'"].map(value => [
    `arnndn model ${value}`, 'ffmpeg', ['-y', '-i', 'in.wav', '-af', `arnndn=${value}`, '-flags:a', '+bitexact', '-fflags', '+bitexact', 'out.wav'],
  ] as [string, Tool, string[]]),
  ['arnndn missing late model', 'ffmpeg', ['-y', '-i', 'in.wav', 'early.wav', '-af', 'arnndn=m=missing.rnnn', 'later.wav']],
  ['arnndn literal dash invalid model', 'ffmpeg', ['-i', 'in.wav', '-af', 'arnndn=m=-', 'out.wav']],
  ['arnndn invalid option timing', 'ffmpeg', ['-af', 'arnndn=m=missing.rnnn', '-unknown_model_fixture', '-i', 'missing.wav', 'out.wav']],
  ['arnndn ffprobe runtime model', 'ffprobe', ['-f', 'lavfi', '-i', 'amovie=in.wav,arnndn=m=voice.rnnn', '-show_entries', 'stream=codec_type', '-of', 'json']],
  ['Photoshop curves original pixels', 'ffmpeg', ['-i', 'seq01.ppm', '-vf', 'curves=psfile=look.acv', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']],
  ['Photoshop curves selected option file', 'ffmpeg', ['-i', 'seq01.ppm', '-vf', 'curves=/psfile=curve-name.txt', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']],
  ['Photoshop curves literal plot dash', 'ffmpeg', ['-i', 'seq01.ppm', '-vf', 'curves=psfile=look.acv:plot=-', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']],
  ['Photoshop curves missing late file', 'ffmpeg', ['-y', '-i', 'seq01.ppm', '-f', 'rawvideo', 'early.rgb', '-vf', 'curves=psfile=missing.acv', '-f', 'rawvideo', 'later.rgb']],
  ['Photoshop curves ffprobe runtime read', 'ffprobe', ['-f', 'lavfi', '-i', 'movie=seq01.ppm,curves=psfile=look.acv', '-show_frames', '-of', 'json']],
  ...(['ffmpeg', 'ffprobe'] as const).map(tool => [
    'zero-flag AVOption native timing', tool,
    ['-pkt_timebase', '1/8000', '-i', 'missing.wav', 'out.wav'],
  ] as [string, Tool, string[]]),
  ...['version', 'noversion', 'no/version', 'version:0'].map(key => [
    `preset exit ignores later missing resources ${key}`, 'ffmpeg',
    ['-y', '-i', 'in.wav', 'first.wav', '-fpre', `exit-${key.replaceAll('/', '-')}.ffpreset`, 'second.wav'],
  ] as [string, Tool, string[]]),
  ...['pipe:0', 'fd:3', 'https:clip.wav', 'file:clip.wav', '-leading.wav'].flatMap(filename => ([
    [`file protocol literal ffmpeg ${filename}`, 'ffmpeg', ['-y', '-i', `file:${filename}`, '-c:a', 'pcm_s16le', '-f', 'wav', 'file:pipe:1']],
    [`file protocol literal ffprobe ${filename}`, 'ffprobe', ['-i', `file:${filename}`, '-show_entries', 'stream=index', '-of', 'json', '-o', 'file:pipe:1']],
  ] as [string, Tool, string[]][])),
  ['probe AVIO output dash', 'ffprobe', ['-i', 'in.wav', '-show_entries', 'stream=index', '-of', 'json', '-o', '-']],
  ...[
    ['duplicate flag input valid', ['-i', 'in.wav', '-i', '-leading.wav']],
    ['duplicate flag input missing', ['-i', 'in.wav', '-i', 'missing.wav']],
    ['duplicate positional input', ['in.wav', 'missing.wav']],
    ['duplicate flag then positional input', ['-i', 'in.wav', 'missing.wav']],
    ['duplicate positional then flag input', ['in.wav', '-i', 'missing.wav']],
    ['duplicate first input missing', ['-i', 'missing.wav', '-i', 'in.wav']],
    ['duplicate indirect input', ['-/i', 'probe-input-option.txt', '-i', 'missing.wav']],
    ['duplicate output', ['-o', 'first.json', '-o', 'second.json', '-i', 'in.wav']],
    ['duplicate indirect output', ['-o', 'first.json', '-/o', 'probe-output-option.txt', '-i', 'in.wav']],
    ['duplicate end marker input', ['--', 'in.wav', '-i', 'missing.wav']],
  ].map(([name, args]) => [
    `probe ${name}`, 'ffprobe', ['-show_entries', 'stream=index', '-of', 'json', ...(args as string[])],
  ] as [string, Tool, string[]]),
  ['file protocol raw bytes missing input', 'ffmpeg', ['-y', '-i', new Uint8Array([...b('file:'), 253, ...b('.wav')]), new Uint8Array([...b('file:'), 254, ...b('.wav')])]],
  ['file protocol missing late output', 'ffmpeg', ['-y', '-i', 'in.wav', 'file:first.wav', '-f', 'wav', 'file:missing/pipe:1']],
  ['signature literal percent filename', 'ffmpeg', ['-f', 'lavfi', '-i', 'testsrc2=size=32x32:duration=0.08', '-vf', 'signature=filename=signature%02d.bin', '-f', 'null', '-']],
  ['signature literal dash filename', 'ffmpeg', ['-f', 'lavfi', '-i', 'testsrc2=size=32x32:duration=0.08', '-vf', 'signature=filename=-', '-f', 'null', '-']],
  ['signature literal descriptor spelling', 'ffmpeg', ['-f', 'lavfi', '-i', 'testsrc2=size=32x32:duration=0.08', '-vf', "signature=filename='pipe\\:3'", '-f', 'null', '-']],
  ['signature raw byte filename', 'ffmpeg', ['-f', 'lavfi', '-i', 'testsrc2=size=32x32:duration=0.08', '-vf', new Uint8Array([...b('signature=filename='), 255, ...b('.bin')]), '-f', 'null', '-']],
  ['signature multiple input expansion', 'ffmpeg', ['-f', 'lavfi', '-i', 'testsrc2=size=32x32:duration=0.08', '-filter_complex', 'split[a][b];[a][b]signature=nb_inputs=2:filename=signature%02d.bin', '-f', 'null', '-']],
  ['signature missing late output retains frames', 'ffmpeg', ['-f', 'lavfi', '-i', 'testsrc2=size=32x32:duration=0.08', '-vf', 'signature=filename=missing/signature.bin', '-f', 'rawvideo', 'out.raw']],
  ['removed filter script native timing', 'ffmpeg', ['-filter_script:a:0', 'missing.graph', '-i', 'missing.wav', 'out.wav']],
  ...['mask.pgm', 'filename=mask.pgm', 'f=mask.pgm', '/f=mask-name.txt', 'f=missing-mask.pgm'].map(value => [
    `removelogo bitmap ${value}`, 'ffmpeg',
    ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=16x16:duration=0.08', '-vf', `removelogo=${value}`, '-pix_fmt', 'rgb24', '-frames:v', '1', '-f', 'rawvideo', 'out.raw'],
  ] as [string, Tool, string[]]),
  ['removelogo invalid option timing', 'ffmpeg', ['-vf', 'removelogo=f=missing-mask.pgm', '-unknown_bitmap_fixture', '-i', 'missing.wav', 'out.raw']],
  ['amovie AVIO dash filename', 'ffmpeg', ['-y', '-f', 'lavfi', '-i', 'amovie=filename=-', '-c:a', 'pcm_s16le', '-frames:a', '1', '-flags:a', '+bitexact', '-fflags', '+bitexact', 'out.wav']],
  ...(['i', 'dec', 'version'] as const).map(name => [
    `preset sequential handler ${name}`, 'ffmpeg',
    ['-y', '-i', 'in.wav', 'one.wav', '-fpre', `separator-${name}.ffpreset`, 'two.wav'],
  ] as [string, Tool, string[]]),
  ['probe no/slash handlers', 'ffprobe', ['-no/f', 'wav', '-no/i', 'in.wav', '-no/o', 'out.json', '-show_entries', 'stream=index', '-of', 'json']],
  ['preset no/slash attachment', 'ffmpeg', ['-y', '-i', 'in.wav', '-c:a', 'pcm_s16le', '-fpre', 'no-slash.ffpreset', '-metadata:s:t', 'mimetype=audio/wav', '-flags:a', '+bitexact', '-fflags', '+bitexact', 'out.mkv']],
  ['image2 update literal percent', 'ffmpeg', ['-y', '-i', 'seq01.ppm', '-f', 'image2', '-update', '1', '-strftime', '1', '-frame_pts', '1', 'still%03d.ppm']],
  ['image2 update native boolean alias', 'ffmpeg', ['-y', '-i', 'seq01.ppm', '-f', 'image2', '-update', 'true', 'still%03d.ppm']],
  ['image2 strftime escaped percent', 'ffmpeg', ['-y', '-i', 'seq01.ppm', '-f', 'image2', '-strftime', '1', 'clock-%%03d.ppm']],
  ['image2 invalid switch native timing', 'ffmpeg', ['-y', '-i', 'seq01.ppm', 'one.ppm', '-f', 'image2', '-strftime', 'invalid', 'clock-%03d.ppm']],
  ['preset sequential non-boolean no forms', 'ffmpeg', ['-y', '-i', 'in.wav', '-c:a', 'pcm_s16le', '-fpre', 'no-prefixed.ffpreset', '-metadata:s:t', 'mimetype=audio/wav', '-flags:a', '+bitexact', '-fflags', '+bitexact', 'out.mkv']],
  ['preset nofpre search retains partial output', 'ffmpeg', ['-y', '-i', 'in.wav', 'one.wav', '-fpre', 'no-prefixed-search.ffpreset', 'two.wav']],
  ['command non-boolean no form refusal', 'ffmpeg', ['-noattach', 'in.wav', '-i', 'missing.wav', 'out.mkv']],
  ['concat native read boundaries', 'ffmpeg', ['-y', '-f', 'concat', '-i', 'concat-boundaries.txt', '-c:a', 'copy', 'out.wav']],
  ['concat native quoted keyword refusal', 'ffmpeg', ['-y', '-f', 'concat', '-i', 'concat-quoted-keyword.txt', 'out.wav']],
  ['inherited demuxer grammar', 'ffmpeg', ['-f', 'constructor', '-i', 'missing.wav', 'out.wav']],
  ['grouped no slash boolean', 'ffmpeg', ['-no/y', '-no/autorotate:v:0', '-i', 'in.wav', '-c:a', 'pcm_s16le', 'out.wav']],
  ['grouped no slash nonboolean native refusal', 'ffmpeg', ['-no/ss', '0.02', '-i', 'missing.wav', 'out.wav']],
  ['probe no-prefixed handlers', 'ffprobe', ['-nof', 'wav', '-noi', 'in.wav', '-noo', 'out.json', '-show_entries', 'stream=index', '-of', 'json']],
  ['preset native delimiters', 'ffmpeg', ['-y', '-i', 'in.wav', '-c:a', 'pcm_s16le', '-fpre', 'delimiters.ffpreset', '-metadata:s:t', 'mimetype=audio/wav', '-flags:a', '+bitexact', '-fflags', '+bitexact', 'out.mkv']],
  ['preset native read limit', 'ffmpeg', ['-y', '-i', 'in.wav', '-c:a', 'pcm_s16le', '-fpre', 'long.ffpreset', '-metadata:s:t', 'mimetype=audio/wav', '-flags:a', '+bitexact', '-fflags', '+bitexact', 'out.mkv']],
  ['preset empty assignment retains partial output', 'ffmpeg', ['-y', '-i', 'in.wav', 'one.wav', '-fpre', 'empty.ffpreset', 'out.mkv']],
  ['preset leading delimiters retain partial output', 'ffmpeg', ['-y', '-i', 'in.wav', 'one.wav', '-fpre', 'leading-delimiters.ffpreset', 'out.mkv']],
  ['inherited option name', 'ffmpeg', ['-constructor', 'missing.wav', 'out.wav']],
  ['inherited filter name', 'ffmpeg', ['-y', '-i', 'in.wav', '-af', 'constructor=file=missing.cube', 'out.wav']],
  ['inherited tee option', 'ffmpeg', ['-y', '-i', 'in.wav', '-map', '0:a', '-c:a', 'pcm_s16le', '-f', 'tee', '[f=wav:constructor=missing]out.wav']],
  ['probe image2 global glob', 'ffprobe', ['-f', 'image2', '-i', 'seq*.ppm', '-pattern_type', 'glob', '-show_entries', 'stream=width,height', '-of', 'json']],
  ['probe image2 global none', 'ffprobe', ['-f', 'image2', '-i', 'literal%02d.ppm', '-pattern_type', 'none', '-show_entries', 'stream=width,height', '-of', 'json']],
  ['image2 literal statistics', 'ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=16x16:duration=0.08', '-f', 'image2', '-stats_enc_pre:v', 'stats%02d.txt', '-frames:v', '2', 'out%02d.ppm']],
  ['split slash private refusal', 'ffmpeg', ['-/probesize', 'size.txt', '-i', 'missing.wav', 'out.wav']],
  ['sequential slash private', 'ffprobe', ['-/probesize', 'size.txt', '-show_entries', 'stream=index', '-of', 'json', 'in.wav']],
  ['sequential slash unknown missing file', 'ffprobe', ['-/future_private_option', 'missing-option.txt', 'missing.wav']],
  ['sequential slash boolean refusal', 'ffprobe', ['-/show_streams', 'missing-option.txt', 'missing.wav']],
  ['preset slash private', 'ffmpeg', ['-y', '-i', 'in.wav', '-fpre', 'private.ffpreset', 'out.wav']],
  ['format stream suffix refusal', 'ffmpeg', ['-probesize:a', '32', '-i', 'missing.wav', 'out.wav']],
  ['scaler stream suffix refusal', 'ffmpeg', ['-sws_flags:v', 'bicubic', '-i', 'missing.wav', 'out.wav']],
  ['resampler stream suffix refusal', 'ffmpeg', ['-resampler:a', 'swr', '-i', 'missing.wav', 'out.wav']],
  ['raw filename success', 'ffmpeg', ['-y', '-i', new Uint8Array([255, 46, 119, 97, 118]), new Uint8Array([254, 46, 119, 97, 118])]],
  ['loaded attachment whitespace and NUL', 'ffmpeg', ['-y', '-i', 'in.wav', '-/attach', 'attachment-option.txt', '-metadata:s:t', 'mimetype=audio/wav', '-c:a', 'pcm_s16le', '-flags:a', '+bitexact', '-fflags', '+bitexact', 'out.mkv']],
  ['loaded missing late attachment', 'ffmpeg', ['-y', '-i', 'in.wav', 'one.wav', '-/attach', 'missing-attachment-option.txt', '-metadata:s:t', 'mimetype=text/plain', 'two.mkv']],
  ['probe loaded input and output', 'ffprobe', ['-/i', 'probe-input-option.txt', '-show_entries', 'stream=index', '-of', 'json', '-/o', 'probe-output-option.txt']],
  ['AVIO argument file dash', 'ffmpeg', ['-y', '-i', 'in.wav', '-/af', '-', 'out.wav']],
  ['AVIO statistics filename dash', 'ffmpeg', ['-y', '-i', 'in.wav', '-stats_enc_pre:a', '-', 'out.wav']],
  ['AVIO attachment filename dash', 'ffmpeg', ['-y', '-i', 'in.wav', '-attach', '-', '-metadata:s:t', 'mimetype=text/plain', '-c:a', 'pcm_s16le', '-flags:a', '+bitexact', '-fflags', '+bitexact', 'out.mkv']],
  ['literal video statistics descriptor spelling', 'ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=16x16:duration=0.08', '-vstats_file', 'pipe:3', '-c:v', 'mpeg4', 'out.avi']],
  ['generated passlog descriptor spelling', 'ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=16x16:duration=0.08', '-c:v', 'mpeg4', '-pass', '1', '-passlogfile', 'pipe:3', 'out.avi']],
  ['subtitle macro alias', 'ffmpeg', ['-f', 'lavfi', '-i', 'color=size=16x16:duration=0.04', '-vf', 'subtitles=f=title.srt', '-f', 'null', '-']],
  ['ass macro alias', 'ffmpeg', ['-f', 'lavfi', '-i', 'color=size=16x16:duration=0.04', '-vf', 'ass=f=title.ass', '-f', 'null', '-']],
  ['subtitle positional font directory', 'ffmpeg', ['-f', 'lavfi', '-i', 'color=size=16x16:duration=0.04', '-vf', 'subtitles=title.srt:16x16:.', '-f', 'null', '-']],
  ['unavailable subtitle before missing resource', 'ffmpeg', ['-f', 'lavfi', '-i', 'color=size=16x16:duration=0.04', '-vf', 'subtitles=f=missing.srt', '-f', 'null', '-']],
  ['preset stream resource', 'ffmpeg', ['-y', '-i', 'in.wav', '-fpre', 'stream.ffpreset', 'out.wav']],
  ['preset argument file', 'ffmpeg', ['-y', '-i', 'in.wav', '-fpre', 'indirect.ffpreset', 'out.wav']],
  ['preset missing argument file', 'ffmpeg', ['-y', '-i', 'in.wav', 'one.wav', '-fpre', 'missing-indirect.ffpreset', 'two.wav']],
  ["input seek", "ffmpeg", ["-y", "-ss", "0.02", "-i", "in.wav", "-c:a", "pcm_s16le", "out.wav"]],
  ['filter metadata output', 'ffmpeg', ['-y', '-i', 'in.wav', '-af', 'ametadata=mode=add:key=foo:value=bar,ametadata=mode=print:file=stats.txt', 'out.wav']],
  ['filter missing output directory', 'ffmpeg', ['-y', '-i', 'in.wav', '-af', 'ametadata=mode=print:file=missing/stats.txt', 'out.wav']],
  ['filter output option indirection', 'ffmpeg', ['-y', '-i', 'in.wav', '-af', 'ametadata=mode=add:key=foo:value=bar,ametadata=mode=print:/file=stats-option.txt', 'out.wav']],
  ['filter literal statistics filename', 'ffmpeg', ['-f', 'lavfi', '-i', 'testsrc2=size=16x16:duration=0.08', '-filter_complex', "split[a][b];[a][b]psnr=f='pipe\\:0'", '-f', 'null', '-']],
  ['filter statistics stdout', 'ffmpeg', ['-f', 'lavfi', '-i', 'testsrc2=size=16x16:duration=0.08', '-filter_complex', 'split[a][b];[a][b]ssim=stats_file=-', '-f', 'null', '-']],
  ["output seek", "ffmpeg", ["-y", "-i", "in.wav", "-ss", "0.02", "-c:a", "pcm_s16le", "out.wav"]],
  ["multiple codecs and maps", "ffmpeg", ["-y", "-i", "in.wav", "-map", "0:a?", "-map", "-0:v", "-c:a", "pcm_s16le", "one.wav", "-c:a:0", "flac", "two.flac"]],
  ["contradictory overwrite", "ffmpeg", ["-y", "-n", "-y", "-i", "in.wav", "out.wav"]],
  ["empty output", "ffmpeg", ["-i", "in.wav", ""]],
  ["empty metadata", "ffmpeg", ["-y", "-i", "in.wav", "-metadata", "title=", "out.wav"]],
  ["raw filename missing", "ffmpeg", ["-y", "-i", new Uint8Array([253, 46, 119, 97, 118]), new Uint8Array([254, 46, 119, 97, 118])]],
  ["raw metadata", "ffmpeg", ["-y", "-i", "in.wav", "-metadata", new Uint8Array([...b("title="), 255]), "out.wav"]],
  ["legacy codec option", "ffmpeg", ["-y", "-athreads", "1", "-i", "in.wav", "-vthreads", "1", "out.wav"]],
  ["legacy private option refusal", "ffmpeg", ["-vcrf", "18", "-i", "missing.wav", "out.wav"]],
  ["legacy format option refusal", "ffmpeg", ["-aprobesize", "32", "-i", "missing.wav", "out.wav"]],
  ["legacy stream suffix refusal", "ffmpeg", ["-vthreads:0", "1", "-i", "missing.wav", "out.wav"]],
  ["legacy unflagged option refusal", "ffmpeg", ["-vpixel_format", "yuv420p", "-i", "missing.wav", "out.wav"]],
  ["leading dash", "ffmpeg", ["-y", "-i", "-leading.wav", "--", "-output.wav"]],
  ["missing late filter file", "ffmpeg", ["-y", "-i", "in.wav", "-af", "amovie=missing.wav", "out.wav"]],
  ["option indirection", "ffmpeg", ["-y", "-i", "in.wav", "-/af", "filter.txt", "out.wav"]],
  ["AVIO option-file stdin", "ffmpeg", ["-y", "-nostdin", "-i", "in.wav", "-/af", "pipe:0", "out.wav"]],
  ["literal preset descriptor spelling", "ffmpeg", ["-y", "-i", "in.wav", "-fpre", "pipe:0", "out.wav"]],
  ["format option indirection", "ffmpeg", ["-y", "-/f", "lavfi", "-i", "in.wav", "out.wav"]],
  ["concat filename token", "ffmpeg", ["-y", "-f", "concat", "-i", "concat-extra.txt", "out.wav"]],
  ["explicit key ends filter shorthand", "ffmpeg", ["-y", "-i", "in.wav", "-af", "amovie=in.wav:loop=1:invented.wav", "out.wav"]],
  ["missing option file", "ffmpeg", ["-y", "-i", "in.wav", "-/af", "missing.txt", "out.wav"]],
  ["preset file", "ffmpeg", ["-y", "-i", "in.wav", "-fpre", "preset.ffpreset", "out.wav"]],
  ["unknown before missing input", "ffmpeg", ["-unknown", "1", "-i", "missing.wav", "out.wav"]],
  ["partial output before failure", "ffmpeg", ["-y", "-i", "in.wav", "one.wav", "missing/two.wav"]],
  ["pipe bytes", "ffmpeg", ["-i", "pipe:0", "-f", "s16le", "pipe:1"]],
  ["input sequence", "ffmpeg", ["-framerate", "25", "-i", "seq%02d.ppm", "-frames:v", "2", "-f", "rawvideo", "pipe:1"]],
  ["output pattern", "ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=2x2:rate=25:duration=0.08", "-frames:v", "2", "out%02d.ppm"]],
  ["late missing concat member", "ffmpeg", ["-y", "-f", "concat", "-i", "concat.txt", "out.wav"]],
  ["missing descriptor", "ffmpeg", ["-progress", "pipe:3", "-i", "in.wav", "out.wav"]],
  ["fd protocol on borrowed stdin", "ffmpeg", ["-fd", "0", "-i", "fd:", "-f", "s16le", "pipe:1"]],
  ["probe metadata", "ffprobe", ["-show_streams", "-show_format", "-of", "json", "in.wav"]],
  ["probe legacy codec option", "ffprobe", ["-athreads", "1", "-show_streams", "in.wav"]],
  ["probe output", "ffprobe", ["-show_entries", "stream=index", "-of", "json", "-o", "out.json", "in.wav"]],
  ["probe invalid option", "ffprobe", ["-unknown", "x", "missing.wav"]],
  ["tee escaped destination", "ffmpeg", ["-y", "-i", "in.wav", "-map", "0:a?", "-c:a", "pcm_s16le", "-f", "tee", "[f=wav:select=\\'a:0\\']'one|two.wav'|[f=wav]last.wav"]],
  ["tee partial output before failure", "ffmpeg", ["-y", "-i", "in.wav", "-map", "0:a", "-c:a", "pcm_s16le", "-f", "tee", "[f=wav]first.wav|[f=wav]missing/last.wav"]],
  ["tee ignores missing destination", "ffmpeg", ["-y", "-i", "in.wav", "-map", "0:a", "-c:a", "pcm_s16le", "-f", "tee", "[f=wav]first.wav|[f=wav:onfail=ignore]missing/last.wav"]],
  ["tee malformed slave after file open", "ffmpeg", ["-y", "-i", "in.wav", "-map", "0:a", "-c:a", "pcm_s16le", "-f", "tee", "[f=wav]first.wav|[broken]last.wav"]],
];
// Darwin's filesystem refuses these filename bytes with EILSEQ. Keep the
// successful byte-namespace case explicit and unqualified on that reference.
for (const [name, tool, args] of cases) it.skipIf(name === 'raw filename success' && process.platform === 'darwin')('native differential: ' + name, async () => {
  const argv = ["-hide_banner", "-loglevel", "error"].map(b).concat(args.map(arg => typeof arg === "string" ? b(arg) : arg));
  const literalFilename = name === 'amovie AVIO dash filename' ? '-' : name.startsWith('file protocol literal ') ? name.slice(`file protocol literal ${tool} `.length) : undefined;
  await reset(name === 'raw filename success', literalFilename, name === "arnndn model m='pipe\\:3'");
  const context = { cwd: directory, env, stdin: name === 'amovie AVIO dash filename' ? new Uint8Array() : name === 'AVIO option-file stdin' ? b('volume=0.5') : wav() };
  if (name.startsWith('image2 AVIO ')) {
    const graph = await resolveDependencies(discover(tool, argv), { cwd: b(directory), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } });
    const input = name.endsWith('input');
    const sequence = graph.nodes.find(node => input ? node.original[0] === 102 : node.access === 'write')!;
    expect(sequence.original).toEqual(b(input ? 'file:seq%02d.ppm' : 'file:avio%03d.ppm'));
    expect(sequence.expression?.dialect).toBe(name === 'image2 AVIO update output' ? undefined : 'sequence');
  }
  if (name.startsWith('arnndn model ')) {
    const model = name.endsWith('/m=model-name.txt') ? 'model-name.txt' : name.endsWith("m='pipe\\:3'") ? 'pipe:3' : 'voice.rnnn';
    // Independently specified filename expectations precede native execution.
    expect(discover(tool, argv).dependencies.filter(dependency => dependency.role === 'filter-resource').map(dependency => dependency.value)).toEqual([b(model)]);
  }
  if (name === 'amovie AVIO dash filename') {
    const graph = await resolveDependencies(discover(tool, argv), { cwd: b(directory), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } });
    expect(graph.nodes.find(node => node.original.length === 1 && node.original[0] === 45)).toMatchObject({ kind: 'path', literal: true, location: b(directory + '/-') });
  }
  if (name.startsWith('removelogo bitmap ')) {
    const indirect = name.endsWith('/f=mask-name.txt');
    const value = indirect ? 'mask-name.txt' : name.endsWith('f=missing-mask.pgm') ? 'missing-mask.pgm' : 'mask.pgm';
    const prediction = discover(tool, argv);
    expect(prediction.dependencies.filter(dependency => ['filter-resource', 'option-file'].includes(dependency.role)).map(dependency => [dependency.value, dependency.access])).toEqual([[b(value), 'read']]);
    if (indirect) {
      const resolver = await createDependencyResolver(prediction, { cwd: b(directory), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } });
      const loaded = resolver.graph().nodes.find(node => node.filterReader?.filter === 'removelogo')!;
      expect((await resolver.content(loaded.id, { content: b('mask.pgm\0ignored-mask') })).map(node => node.original)).toEqual([b('mask.pgm')]);
    }
  }
  if (name.startsWith('preset exit ignores later missing resources ')) {
    const key = name.slice('preset exit ignores later missing resources '.length);
    const prediction = discoverContent({ kind: 'preset', location: b('preset'),
      content: b(`${key}=ignored\nattach=unreachable.wav\n/af=unreachable.graph\n`) });
    expect(prediction).toEqual({ dependencies: [], deferred: true });
  }
  if (name === 'grouped no slash boolean') {
    const prediction = discover(tool, argv);
    expect(prediction.dependencies.map(dependency => [dependency.role, dependency.value])).toEqual([
      ['input', b('in.wav')], ['output', b('out.wav')],
    ]);
    expect(prediction.dependencies.some(dependency => dependency.role === 'option-file')).toBe(false);
  }
  if (name === 'grouped no slash nonboolean native refusal') {
    expect(discover(tool, argv).dependencies).toEqual([]);
  }
  if (name.startsWith('file protocol literal ')) {
    const graph = await resolveDependencies(discover(tool, argv), {
      cwd: b(directory), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 },
    });
    const filename = name.slice(`file protocol literal ${tool} `.length);
    const input = [b(`file:${filename}`), b(`file:${directory}/${filename}`), 'file-protocol', 'read'];
    const output = [b('file:pipe:1'), b(`file:${directory}/pipe:1`), 'file-protocol', 'write'];
    // ffprobe creates its writer before probing; FFmpeg opens inputs first.
    expect(graph.nodes.map(node => [node.original, node.location, node.kind, node.access]))
      .toEqual(tool === 'ffprobe' ? [output, input] : [input, output]);
  }
  if (name === 'probe AVIO output dash') {
    expect(discover(tool, argv).dependencies).toEqual([
      expect.objectContaining({ value: b('in.wav'), role: 'input', kind: 'path', access: 'read' }),
      expect.objectContaining({ value: b('-'), role: 'output', kind: 'descriptor', access: 'write' }),
    ]);
  }
  if (name === 'file protocol raw bytes missing input' || name === 'file protocol missing late output') {
    const graph = await resolveDependencies(discover(tool, argv), {
      cwd: b(directory), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 },
    });
    expect(graph.nodes.map(node => node.location)).toEqual(name === 'file protocol raw bytes missing input' ? [
      new Uint8Array([...b(`file:${directory}/`), 253, ...b('.wav')]),
      new Uint8Array([...b(`file:${directory}/`), 254, ...b('.wav')]),
    ] : [b(`${directory}/in.wav`), b(`file:${directory}/first.wav`), b(`file:${directory}/missing/pipe:1`)]);
  }
  if (name.startsWith('preset sequential handler ')) {
    const key = name.slice('preset sequential handler '.length);
    // Independently assert the preset parser's scope rather than inferring
    // dependencies from the forwarded argv or native output.
    const prediction = discover('ffmpeg', [`-${key}`, 'opaque', 'unreachable.wav'].map(b), 'preset');
    expect(prediction.groups).toEqual([]);
    expect(prediction.dependencies).toEqual([]);
    if (key !== 'version') expect(prediction.deferred).toContainEqual({ index: 0, reason: 'unknown-option' });
  }
  if (name.startsWith('image2 update') || name.startsWith('image2 strftime') || name === 'image2 invalid switch native timing') {
    const graph = await resolveDependencies(discover(tool, argv), {
      cwd: b(directory), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 },
    });
    const output = graph.nodes.filter(node => node.access === 'write').at(-1)!;
    expect(output.kind).toBe(name === 'image2 update literal percent' ? 'path' : 'resource-lookup');
    expect(output.expression).toBeUndefined();
  }
  if (name.startsWith('concat native ')) {
    const filename = name === 'concat native read boundaries' ? 'concat-boundaries.txt' : 'concat-quoted-keyword.txt';
    const content = await readFile(join(directory, filename));
    // These expected dependencies do not come from command forwarding or output.
    const expected = Array.from({ length: name === 'concat native read boundaries' ? 4 : 1 }, () => b('in.wav'));
    expect(discoverContent({ kind: 'concat-list', location: b(filename), content }).dependencies.map(dependency => dependency.value)).toEqual(expected);
    const resolver = await createDependencyResolver(discover(tool, argv), {
      cwd: b(directory), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 },
    });
    const input = resolver.graph().nodes.find(node => node.grammar === 'concat')!;
    expect((await resolver.content(input.id, { content })).map(node => node.original)).toEqual(expected);
  }
  if (name === 'inherited demuxer grammar') {
    const graph = await resolveDependencies(discover(tool, argv), { cwd: b(directory), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 } });
    expect(graph.nodes.map(node => node.grammar)).toEqual([undefined, undefined]);
  }
  if (name === 'preset no/slash attachment') {
    expect(discoverContent({ kind: 'preset', location: b('no-slash.ffpreset'), content: await readFile(join(directory, 'no-slash.ffpreset')) }).dependencies.map(dependency => [dependency.role, dependency.value])).toEqual([
      ['attachment', b('in.wav')],
    ]);
  }
  if (name === 'probe no-prefixed handlers' || name === 'probe no/slash handlers') {
    expect(discover(tool, argv).dependencies.map(dependency => [dependency.role, dependency.value])).toEqual([
      ['input', b('in.wav')], ['output', b('out.json')],
    ]);
  }
  if (name.startsWith('preset native') || name === 'preset empty assignment retains partial output') {
    const filename = name === 'preset native delimiters' ? 'delimiters.ffpreset' : name === 'preset native read limit' ? 'long.ffpreset' : 'empty.ffpreset';
    const prediction = discoverContent({ kind: 'preset', location: b(filename), content: await readFile(join(directory, filename)) });
    expect(prediction.dependencies.map(dependency => [dependency.role, dependency.value])).toEqual(
      name === 'preset native delimiters' ? [['option-file', b('probe-input-option.txt')], ['attachment', b('in.wav')]] : [['attachment', b('in.wav')]],
    );
  }
  if (name === 'inherited option name') expect(discover(tool, argv).dependencies).toEqual([]);
  if (name === 'preset leading delimiters retain partial output') expect(discoverContent({ kind: 'preset', location: b('leading-delimiters.ffpreset'), content: await readFile(join(directory, 'leading-delimiters.ffpreset')) }).dependencies).toEqual([]);
  if (name === 'inherited filter name') expect(discover(tool, argv).dependencies.map(dependency => dependency.value)).toEqual([b('in.wav'), b('out.wav')]);
  if (name === 'inherited tee option') expect(discover(tool, argv).dependencies.map(dependency => [dependency.role, dependency.value])).toEqual([['input', b('in.wav')], ['output', b('out.wav')]]);
  if (name.startsWith('probe image2 global') || name === 'image2 literal statistics') {
    // Expected accesses are specified independently of native output and argv
    // forwarding. In particular, statistics are a literal file, not frames.
    const graph = await resolveDependencies(discover(tool, argv), {
      cwd: b(directory), budgets: { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 },
    });
    expect(graph.nodes.map(node => [node.original, node.kind, node.access])).toEqual(
      name === 'probe image2 global glob' ? [[b('seq*.ppm'), 'glob', 'read']]
        : name === 'probe image2 global none' ? [[b('literal%02d.ppm'), 'path', 'read']]
          : [[b('testsrc2=size=16x16:duration=0.08'), 'synthetic', 'read'], [b('stats%02d.txt'), 'path', 'write'], [b('out%02d.ppm'), 'output-pattern', 'write']],
    );
  }
  const native = await runNative(nativeReference.executables[tool].path, argv, context);
  if (name === 'zero-flag AVOption native timing') {
    expect(discover(tool, argv).dependencies).toEqual([]);
    expect(native.exitCode).not.toBe(0);
    const diagnostic = Buffer.from(native.stderr, 'base64').toString();
    expect(diagnostic).toContain(tool === 'ffmpeg'
      ? "Unrecognized option 'pkt_timebase'"
      : "Failed to set value '1/8000' for option 'pkt_timebase': Option not found");
    expect(diagnostic).not.toContain('missing.wav');
    expect(diagnostic).not.toContain('out.wav');
  }
  if (name === 'removed filter script native timing') {
    expect(discover(tool, argv).dependencies).toEqual([]);
    expect(native.exitCode).not.toBe(0);
    const diagnostic = Buffer.from(native.stderr, 'base64').toString();
    expect(diagnostic).toContain("Unrecognized option 'filter_script:a:0'");
    expect(diagnostic).not.toContain('missing.graph');
    expect(diagnostic).not.toContain('missing.wav');
  }
  if (name.startsWith('preset sequential handler ')) {
    expect(native.exitCode).not.toBe(0);
    // Native opens the first output before applying the second preset, but
    // processing has not started: the surviving effect is an empty file.
    expect(await readFile(join(directory, 'one.wav'))).toHaveLength(0);
    expect(await readdir(directory)).not.toContain('two.wav');
  }
  if (name.startsWith('image2 update') || name.startsWith('image2 strftime')) expect(native.exitCode).toBe(0);
  if (name === 'concat native read boundaries') expect(native.exitCode).toBe(0);
  if (name === 'concat native quoted keyword refusal' || name === 'inherited demuxer grammar') {
    expect(native.exitCode).not.toBe(0);
    expect(Buffer.from(native.stderr, 'base64').toString()).toContain(name === 'inherited demuxer grammar' ? "Unknown input format: 'constructor'" : "unknown keyword ''file''");
  }
  if (name.startsWith('probe image2 global')) {
    expect(native.exitCode).toBe(0);
    expect(JSON.parse(Buffer.from(native.stdout, 'base64').toString()).streams).toEqual([{ width: 1, height: 1 }]);
  }
  if (['subtitle macro alias', 'ass macro alias', 'subtitle positional font directory', 'unavailable subtitle before missing resource'].includes(name)) {
    // The pinned build lacks libass filters. Without a private class, native
    // rejects positional shorthand before reaching its unknown-filter error.
    // Source inventory predicts syntax, never build availability or validation.
    expect(native.exitCode).not.toBe(0);
    const diagnostic = Buffer.from(native.stderr, 'base64').toString();
    expect(diagnostic).toContain(name === 'subtitle positional font directory' ? 'No option name near' : 'No such filter');
    expect(diagnostic).not.toContain('Unable to open');
  }
  if (name.startsWith('tee ')) {
    expect(native.exitCode).toBe(name === 'tee partial output before failure' ? 254 : 0);
    if (name === 'tee malformed slave after file open') {
      // This build diagnoses the malformed slave but continues the first one.
      expect(Buffer.from(native.stderr, 'base64').toString()).toContain('No option found near');
    }
  }
  if (['AVIO option-file stdin', 'literal preset descriptor spelling'].includes(name)) expect(native.exitCode).toBe(0);
  if (["format option indirection", "concat filename token"].includes(name)) expect(native.exitCode).toBe(0);
  if (name === "explicit key ends filter shorthand") {
    expect(native.exitCode).not.toBe(0);
    expect(Buffer.from(native.stderr, "base64").toString()).toContain("No option name near");
  }
  if (["input seek", "output seek", "multiple codecs and maps", "empty metadata", "raw metadata", "legacy codec option", "probe legacy codec option", "leading dash", "option indirection", "preset file", "pipe bytes", "input sequence", "output pattern", "probe metadata", "probe output"].includes(name)) {
    expect(native.exitCode, name).toBe(0);
  }
  if (["contradictory overwrite", "empty output", "raw filename missing", "legacy private option refusal", "legacy format option refusal", "legacy stream suffix refusal", "legacy unflagged option refusal", "missing late filter file", "missing option file", "unknown before missing input", "partial output before failure", "probe invalid option"].includes(name)) {
    expect(native.exitCode, name).not.toBe(0);
  }
  if (name.startsWith("legacy ") && name.endsWith(" refusal")) {
    const diagnostic = Buffer.from(native.stderr, "base64").toString();
    expect(diagnostic).toContain("Unrecognized option");
    expect(diagnostic).not.toContain("missing.wav");
  }
  if (name === "pipe bytes") expect(Buffer.from(native.stdout, "base64")).toEqual(Buffer.from(wav().slice(44)));
  if (name === "input sequence") expect(Buffer.from(native.stdout, "base64")).toEqual(Buffer.from([255, 0, 0, 0, 255, 0]));
  const nativeEffects = await effects();
  if (name.startsWith('image2 AVIO ')) {
    expect(native.exitCode).toBe(0);
    if (name === 'image2 AVIO numbered input') expect(Buffer.from(native.stdout, 'base64')).toHaveLength(6);
    if (name === 'image2 AVIO probe input') expect(JSON.parse(Buffer.from(native.stdout, 'base64').toString()).streams).toEqual([{ width: 1, height: 1 }]);
    const filenames = Object.keys(nativeEffects).map(value => Buffer.from(value, 'base64').toString()).filter(value => value.startsWith('avio'));
    expect(filenames.sort()).toEqual(name.endsWith('input') ? [] : name === 'image2 AVIO numbered output' ? ['avio001.ppm', 'avio002.ppm'] : ['avio%03d.ppm']);
    for (const filename of filenames) expect(Buffer.from(nativeEffects[Buffer.from(filename).toString('base64')], 'base64').subarray(0, 3).toString()).toBe('P6\n');
  }
  if (name.startsWith('arnndn model ')) {
    expect(native.exitCode, Buffer.from(native.stderr, 'base64').toString()).toBe(0);
    const output = Buffer.from(nativeEffects[Buffer.from('out.wav').toString('base64')], 'base64');
    expect(output.subarray(0, 4).toString()).toBe('RIFF');
    expect(output.length).toBeGreaterThan(44);
  }
  if (name === 'arnndn ffprobe runtime model') {
    expect(native.exitCode).toBe(0);
    expect(JSON.parse(Buffer.from(native.stdout, 'base64').toString()).streams).toEqual([{ codec_type: 'audio' }]);
  }
  if (name === 'arnndn missing late model') {
    expect(native.exitCode).not.toBe(0);
    expect(Buffer.from(native.stderr, 'base64').toString()).toContain('Failed to open model file: missing.rnnn');
    expect(nativeEffects[Buffer.from('early.wav').toString('base64')]).toBe('');
    expect(nativeEffects).not.toHaveProperty(Buffer.from('later.wav').toString('base64'));
  }
  if (name === 'arnndn literal dash invalid model') {
    expect(native.exitCode).not.toBe(0);
    expect(Buffer.from(native.stderr, 'base64').toString()).not.toContain('Failed to open model file');
  }
  if (name === 'arnndn invalid option timing') {
    expect(native.exitCode).not.toBe(0);
    expect(Buffer.from(native.stderr, 'base64').toString()).toContain("Unrecognized option 'unknown_model_fixture'");
    expect(Buffer.from(native.stderr, 'base64').toString()).not.toContain('Failed to open model file');
    expect(nativeEffects).not.toHaveProperty(Buffer.from('out.wav').toString('base64'));
  }
  if (name === 'amovie AVIO dash filename') {
    expect(native.exitCode).toBe(0);
    expect(Buffer.from(nativeEffects[Buffer.from('out.wav').toString('base64')], 'base64').length).toBeGreaterThan(44);
  }
  if (name.startsWith('removelogo bitmap ')) {
    if (name.endsWith('f=missing-mask.pgm')) {
      expect(native.exitCode).not.toBe(0);
      expect(Buffer.from(native.stderr, 'base64').toString()).toContain("Failed to open input file 'missing-mask.pgm'");
      expect(nativeEffects).not.toHaveProperty(Buffer.from('out.raw').toString('base64'));
    } else {
      expect(native.exitCode).toBe(0);
      expect(Buffer.from(nativeEffects[Buffer.from('out.raw').toString('base64')], 'base64').length).toBe(16 * 16 * 3);
    }
  }
  if (name === 'removelogo invalid option timing') {
    expect(native.exitCode).not.toBe(0);
    const diagnostic = Buffer.from(native.stderr, 'base64').toString();
    expect(diagnostic).toContain("Unrecognized option 'unknown_bitmap_fixture'");
    expect(diagnostic).not.toContain('Failed to open input file');
    expect(nativeEffects).not.toHaveProperty(Buffer.from('out.raw').toString('base64'));
  }
  if (name.startsWith('probe duplicate')) {
    const succeeds = ['probe duplicate flag input valid', 'probe duplicate flag input missing',
      'probe duplicate positional then flag input', 'probe duplicate indirect input'].includes(name);
    expect(native.exitCode).toBe(succeeds ? 0 : 1);
    const diagnostic = Buffer.from(native.stderr, 'base64').toString();
    expect(diagnostic).toContain('was already specified');
    if (succeeds) {
      expect(JSON.parse(Buffer.from(native.stdout, 'base64').toString()).streams).toEqual([{ index: 0 }]);
      expect(diagnostic).not.toContain('No such file or directory');
    } else if (name === 'probe duplicate first input missing') {
      // The writer is initialized before probing the retained missing input.
      expect(JSON.parse(Buffer.from(native.stdout, 'base64').toString())).toEqual({});
      expect(diagnostic).toContain('missing.wav: No such file or directory');
    } else expect(native.stdout).toBe('');
    if (name.includes('output')) {
      expect(Buffer.from(nativeEffects[Buffer.from('first.json').toString('base64')], 'base64').toString()).toBe('first output sentinel');
      expect(Buffer.from(nativeEffects[Buffer.from('second.json').toString('base64')], 'base64').toString()).toBe('second output sentinel');
      expect(nativeEffects).not.toHaveProperty(Buffer.from('out.json').toString('base64'));
    }
  }
  if (name.startsWith('Photoshop curves ')) {
    if (name === 'Photoshop curves missing late file') {
      expect(native.exitCode).not.toBe(0);
      expect(Buffer.from(native.stderr, 'base64').toString()).toContain('missing.acv');
      expect(nativeEffects).toHaveProperty(Buffer.from('early.rgb').toString('base64'));
    } else {
      expect(native.exitCode).toBe(0);
      if (tool === 'ffmpeg') expect(Buffer.from(native.stdout, 'base64')).toEqual(Buffer.from([0, 255, 255]));
      else expect(JSON.parse(Buffer.from(native.stdout, 'base64').toString()).frames).toHaveLength(1);
    }
    if (name === 'Photoshop curves literal plot dash') expect(Buffer.from(nativeEffects[Buffer.from('-').toString('base64')], 'base64').toString()).toContain('plot');
  }
  if (name.startsWith('preset exit ignores later missing resources ')) {
    expect(native.exitCode).not.toBe(0);
    expect(Buffer.from(native.stdout, 'base64').toString()).toContain('ffmpeg version');
    const diagnostic = Buffer.from(native.stderr, 'base64').toString();
    expect(diagnostic).toBe('');
    expect(diagnostic).not.toContain('unreachable.wav');
    expect(diagnostic).not.toContain('unreachable.graph');
    expect(nativeEffects[Buffer.from('first.wav').toString('base64')]).toBe('');
    expect(nativeEffects).not.toHaveProperty(Buffer.from('second.wav').toString('base64'));
  }
  if (name === 'file protocol missing late output') {
    expect(native.exitCode).not.toBe(0);
    expect(nativeEffects[Buffer.from('first.wav').toString('base64')]).toBe('');
    expect(Buffer.from(native.stderr, 'base64').toString()).toContain('missing/pipe:1');
  }
  if (name === 'file protocol raw bytes missing input') {
    expect(native.exitCode).not.toBe(0);
    expect(Buffer.from(native.stderr, 'base64').includes(Buffer.from([...b('file:'), 253, ...b('.wav')]))).toBe(true);
    expect(nativeEffects).not.toHaveProperty(Buffer.from([254, ...b('.wav')]).toString('base64'));
  }
  if (name.startsWith('file protocol literal ') || name === 'probe AVIO output dash') {
    expect(native.exitCode).toBe(0);
    if (name !== 'probe AVIO output dash') expect(native.stdout).toBe('');
    else expect(nativeEffects[Buffer.from('-').toString('base64')]).toBe(Buffer.from('volume=0.5').toString('base64'));
    const output = Buffer.from(name === 'probe AVIO output dash' ? native.stdout : nativeEffects[Buffer.from('pipe:1').toString('base64')], 'base64');
    if (tool === 'ffprobe') expect(JSON.parse(output.toString()).streams).toEqual([{ index: 0 }]);
    else {
      const data = output.indexOf(Buffer.from('data'));
      expect(data).toBeGreaterThan(0);
      expect(output.subarray(data + 8)).toEqual(Buffer.from(wav().subarray(44)));
    }
  }
  if (name.startsWith('signature ')) {
    const argvPlan = discover(tool, argv);
    expect(argvPlan.dependencies.filter(dependency => dependency.role === 'filter-resource')).toEqual([
      expect.objectContaining({ access: 'write', literal: true, kind: 'resource-lookup', stage: 'runtime' }),
    ]);
    if (name === 'signature raw byte filename') {
      // The pinned macOS fopen reader refuses this filename with EINVAL;
      // raw bytes remain visible in its diagnostic and native status is zero.
      expect(native.exitCode).toBe(0);
      expect(Buffer.from(native.stderr, 'base64').includes(Buffer.from([255, ...b('.bin')]))).toBe(true);
      expect(nativeEffects).not.toHaveProperty(Buffer.from([255, ...b('.bin')]).toString('base64'));
    } else if (name === 'signature missing late output retains frames') {
      // This build diagnoses the failed EOF export but still returns success.
      // The shim must preserve that status and the already written frames.
      expect(native.exitCode).toBe(0);
      expect(Buffer.from(nativeEffects[Buffer.from('out.raw').toString('base64')], 'base64').length).toBeGreaterThan(0);
      expect(Buffer.from(native.stderr, 'base64').toString()).toContain('missing/signature.bin');
    } else {
      expect(native.exitCode).toBe(0);
      expect(native.stdout).toBe('');
      const filenames = name === 'signature multiple input expansion' ? [b('signature00.bin'), b('signature01.bin')]
        : [b(name === 'signature literal dash filename' ? '-' : name === 'signature literal descriptor spelling' ? 'pipe:3' : 'signature%02d.bin')];
      for (const filename of filenames) expect(Buffer.from(nativeEffects[Buffer.from(filename).toString('base64')], 'base64').length).toBeGreaterThan(0);
      if (name === 'signature multiple input expansion') expect(nativeEffects).not.toHaveProperty(Buffer.from('signature%02d.bin').toString('base64'));
    }
  }
  if (name.startsWith('image2 update') || name.startsWith('image2 strftime')) {
    const target = name.startsWith('image2 update') ? 'still%03d.ppm' : 'clock-%03d.ppm';
    expect(nativeEffects[Buffer.from(target).toString('base64')]).toBe(nativeEffects[Buffer.from('seq01.ppm').toString('base64')]);
  }
  if (name === 'image2 invalid switch native timing') {
    expect(native.exitCode).not.toBe(0);
    expect(nativeEffects).toHaveProperty(Buffer.from('one.ppm').toString('base64'));
    expect(nativeEffects).not.toHaveProperty(Buffer.from('clock-%03d.ppm').toString('base64'));
    expect(Buffer.from(native.stderr, 'base64').toString()).toContain('invalid');
  }
  if (name === 'preset nofpre search retains partial output') {
    expect(native.exitCode).not.toBe(0);
    expect(Buffer.from(native.stderr, 'base64').toString()).toContain("File for preset 'preset.ffpreset' not found");
    expect(nativeEffects).toHaveProperty(Buffer.from('one.wav').toString('base64'));
    expect(nativeEffects).not.toHaveProperty(Buffer.from('two.wav').toString('base64'));
  }
  if (name === 'command non-boolean no form refusal') {
    expect(native.exitCode).not.toBe(0);
    const diagnostic = Buffer.from(native.stderr, 'base64').toString();
    expect(diagnostic).toContain("Unrecognized option 'noattach'");
    expect(diagnostic).not.toContain('missing.wav');
  }
  if (name === 'preset sequential non-boolean no forms') {
    expect(native.exitCode, Buffer.from(native.stderr, 'base64').toString()).toBe(0);
    expect(Buffer.from(nativeEffects[Buffer.from('out.mkv').toString('base64')], 'base64').includes(Buffer.from(wav()))).toBe(true);
    expect(discoverContent({ kind: 'preset', location: b('no-prefixed.ffpreset'), content: b('noss=0.02\nnoattach=in.wav\n') }).dependencies.map(dependency => [dependency.role, dependency.value])).toEqual([
      ['attachment', b('in.wav')],
    ]);
  }
  if (name === 'concat native read boundaries') {
    const output = Buffer.from(nativeEffects[Buffer.from('out.wav').toString('base64')], 'base64');
    const data = output.indexOf(Buffer.from('data'));
    expect(data).toBeGreaterThan(0);
    expect(output.subarray(data + 8)).toEqual(Buffer.concat(Array.from({ length: 4 }, () => Buffer.from(wav().subarray(44)))));
  }
  if (name === 'preset no/slash attachment') {
    expect(native.exitCode, Buffer.from(native.stderr, 'base64').toString()).toBe(0);
    expect(Buffer.from(nativeEffects[Buffer.from('out.mkv').toString('base64')], 'base64').includes(Buffer.from(wav()))).toBe(true);
  }
  if (name === 'probe no-prefixed handlers' || name === 'probe no/slash handlers') {
    expect(native.exitCode).toBe(0);
    expect(JSON.parse(Buffer.from(nativeEffects[Buffer.from('out.json').toString('base64')], 'base64').toString()).streams).toEqual([{ index: 0 }]);
  }
  if (name.startsWith('preset native')) {
    expect(native.exitCode, Buffer.from(native.stderr, 'base64').toString()).toBe(0);
    expect(Buffer.from(nativeEffects[Buffer.from('out.mkv').toString('base64')], 'base64').includes(Buffer.from(wav()))).toBe(true);
  }
  if (name === 'preset empty assignment retains partial output') {
    expect(native.exitCode).not.toBe(0);
    expect(Buffer.from(native.stderr, 'base64').toString()).toContain('Invalid syntax');
    expect(nativeEffects).toHaveProperty(Buffer.from('one.wav').toString('base64'));
    expect(nativeEffects).not.toHaveProperty(Buffer.from('out.mkv').toString('base64'));
  }
  if (name === 'preset leading delimiters retain partial output') {
    expect(native.exitCode).not.toBe(0);
    expect(Buffer.from(native.stderr, 'base64').toString()).toContain("option '==/attach'");
    expect(nativeEffects).toHaveProperty(Buffer.from('one.wav').toString('base64'));
    expect(nativeEffects).not.toHaveProperty(Buffer.from('out.mkv').toString('base64'));
  }
  if (name === 'inherited tee option') {
    expect(native.exitCode).not.toBe(0);
    expect(Buffer.from(native.stderr, 'base64').toString()).toContain("Unknown option 'constructor'");
  }
  if (name === 'inherited option name' || name === 'inherited filter name') {
    expect(native.exitCode).not.toBe(0);
    const diagnostic = Buffer.from(native.stderr, 'base64').toString();
    expect(diagnostic).toContain(name === 'inherited option name' ? 'Unrecognized option' : 'No such filter');
    expect(diagnostic).not.toContain('missing.wav');
    expect(diagnostic).not.toContain('Unable to open');
    expect(nativeEffects).not.toHaveProperty(Buffer.from('out.wav').toString('base64'));
  }
  if (name === 'image2 literal statistics') {
    expect(native.exitCode).toBe(0);
    expect(Buffer.from(nativeEffects[Buffer.from('stats%02d.txt').toString('base64')], 'base64').length).toBeGreaterThan(0);
    for (const filename of ['out01.ppm', 'out02.ppm']) expect(nativeEffects).toHaveProperty(Buffer.from(filename).toString('base64'));
    expect(nativeEffects).not.toHaveProperty(Buffer.from('stats01.txt').toString('base64'));
  }
  if (['grouped no slash boolean', 'sequential slash private', 'preset slash private', 'raw filename success'].includes(name)) expect(native.exitCode).toBe(0);
  if (name === 'grouped no slash nonboolean native refusal') {
    expect(native.exitCode).not.toBe(0);
    const diagnostic = Buffer.from(native.stderr, 'base64').toString();
    expect(diagnostic).toContain("Unrecognized option 'no/ss'");
    expect(diagnostic).not.toContain('missing.wav');
  }
  if (name === 'raw filename success') {
    expect(nativeEffects).toHaveProperty(Buffer.from([254, 46, 119, 97, 118]).toString('base64'));
  }
  if (['split slash private refusal', 'format stream suffix refusal', 'scaler stream suffix refusal', 'resampler stream suffix refusal'].includes(name)) {
    expect(native.exitCode).not.toBe(0);
    const diagnostic = Buffer.from(native.stderr, 'base64').toString();
    expect(diagnostic).toContain('Unrecognized option');
    expect(diagnostic).not.toContain('missing.wav');
    expect(nativeEffects).not.toHaveProperty(Buffer.from('out.wav').toString('base64'));
  }
  if (name === 'sequential slash unknown missing file') {
    expect(native.exitCode).not.toBe(0);
    const diagnostic = Buffer.from(native.stderr, 'base64').toString();
    expect(diagnostic).toContain('Error reading the value');
    expect(diagnostic).toContain('missing-option.txt');
    expect(diagnostic).not.toContain('Unrecognized option');
    expect(diagnostic).not.toContain('missing.wav');
  }
  if (name === 'sequential slash boolean refusal') {
    expect(native.exitCode).not.toBe(0);
    const diagnostic = Buffer.from(native.stderr, 'base64').toString();
    expect(diagnostic).toContain('does not take an argument');
    expect(diagnostic).not.toContain('missing-option.txt');
    expect(diagnostic).not.toContain('missing.wav');
  }
  if (name === 'loaded attachment whitespace and NUL') {
    expect(native.exitCode).toBe(0);
    expect(Buffer.from(nativeEffects[Buffer.from('out.mkv').toString('base64')], 'base64').includes(Buffer.from(wav()))).toBe(true);
  }
  if (name === 'loaded missing late attachment') {
    expect(native.exitCode).not.toBe(0);
    expect(Buffer.from(native.stderr, 'base64').toString()).toContain('missing-attachment.txt');
    expect(nativeEffects).toHaveProperty(Buffer.from('one.wav').toString('base64'));
  }
  if (name === 'probe loaded input and output') {
    expect(native.exitCode).toBe(0);
    expect(JSON.parse(Buffer.from(nativeEffects[Buffer.from('out.json').toString('base64')], 'base64').toString())).toEqual({ programs: [], stream_groups: [], streams: [{ index: 0 }] });
  }
  if (['AVIO argument file dash', 'AVIO statistics filename dash', 'AVIO attachment filename dash', 'literal video statistics descriptor spelling', 'generated passlog descriptor spelling'].includes(name)) expect(native.exitCode).toBe(0);
  if (name === 'AVIO argument file dash') expect(nativeEffects).toHaveProperty(Buffer.from('out.wav').toString('base64'));
  if (name === 'AVIO statistics filename dash') {
    expect(Buffer.from(nativeEffects[Buffer.from('-').toString('base64')], 'base64').toString()).not.toBe('volume=0.5');
    expect(native.stdout).toBe('');
  }
  if (name === 'AVIO attachment filename dash') {
    expect(Buffer.from(nativeEffects[Buffer.from('out.mkv').toString('base64')], 'base64').includes(Buffer.from('volume=0.5'))).toBe(true);
  }
  if (name === 'literal video statistics descriptor spelling') {
    expect(Buffer.from(nativeEffects[Buffer.from('pipe:3').toString('base64')], 'base64').toString()).toContain('frame=');
  }
  if (name === 'generated passlog descriptor spelling') {
    expect(nativeEffects).toHaveProperty(Buffer.from('pipe:3-0.log').toString('base64'));
    expect(nativeEffects).not.toHaveProperty(Buffer.from('pipe:3').toString('base64'));
  }
  if (name === 'preset stream resource') {
    expect(native.exitCode).toBe(0);
    expect(Buffer.from(nativeEffects[Buffer.from('stats.txt').toString('base64')], 'base64').toString()).toContain('foo=bar');
  }
  if (name === 'preset argument file') expect(native.exitCode).toBe(0);
  if (name === 'preset missing argument file') {
    expect(native.exitCode).not.toBe(0);
    expect(Buffer.from(native.stderr, 'base64').toString()).toContain('missing-graph.txt');
    expect(nativeEffects).toHaveProperty(Buffer.from('one.wav').toString('base64'));
  }
  if (['filter metadata output', 'filter output option indirection'].includes(name)) {
    expect(native.exitCode).toBe(0);
    expect(Buffer.from(nativeEffects[Buffer.from('stats.txt').toString('base64')], 'base64').toString()).toContain('foo=bar');
  }
  if (name === 'filter literal statistics filename') {
    expect(native.exitCode).toBe(0);
    expect(Buffer.from(nativeEffects[Buffer.from('pipe:0').toString('base64')], 'base64').toString()).toContain('psnr_avg:inf');
  }
  if (name === 'filter statistics stdout') {
    expect(native.exitCode).toBe(0);
    expect(Buffer.from(native.stdout, 'base64').toString()).toContain('All:1.000000');
  }
  if (name === 'filter missing output directory') {
    expect(native.exitCode).not.toBe(0);
    expect(Buffer.from(native.stderr, 'base64').toString()).toContain('missing/stats.txt');
    // Filter initialization fails before the main output is opened in this build.
    expect(nativeEffects).not.toHaveProperty(Buffer.from('out.wav').toString('base64'));
  }
  if (name.startsWith('tee ') && name !== 'tee escaped destination') {
    expect(nativeEffects).toHaveProperty(Buffer.from('first.wav').toString('base64'));
  }
  if (name === 'tee escaped destination') {
    expect(nativeEffects).toHaveProperty(Buffer.from('one|two.wav').toString('base64'));
    expect(nativeEffects).toHaveProperty(Buffer.from('last.wav').toString('base64'));
  }
  if (name === "raw metadata") {
    const output = Buffer.from(nativeEffects[Buffer.from("out.wav").toString("base64")], "base64");
    const title = output.indexOf(Buffer.from("INAM"));
    expect(title).toBeGreaterThan(0);
    expect(output[title + 8]).toBe(255);
  }
  if (name === "late missing concat member") {
    // Stock FFmpeg diagnoses a demux read failure but returns success by default.
    expect(native.exitCode).toBe(0);
    expect(Buffer.from(native.stderr, "base64").toString()).toContain("missing-late.wav");
    expect(Buffer.from(nativeEffects[Buffer.from("out.wav").toString("base64")], "base64").length).toBeGreaterThan(44);
  }
  await reset(name === 'raw filename success', literalFilename, name === "arnndn model m='pipe\\:3'");
  let observed: Awaited<ReturnType<typeof runNative>> | undefined;
  const shims = createFFmpegShims<typeof context>({
    build: nativeReference.id, grammarRevision, argv: "bytes", lateAccess: "complete", effects: "live",
    async run(request) {
      observed = await runNative(request.executable.path, request.argv, request.context);
      return { exitCode: observed.exitCode };
    }
  });
  const result = await shims[tool](argv, context);
  expect(result.exitCode).toBe(native.exitCode);
  expect(observed!.stdout).toEqual(native.stdout);
  expect(comparableDiagnostics(Buffer.from(observed!.stderr, "base64"))).toEqual(comparableDiagnostics(Buffer.from(native.stderr, "base64")));
  expect(await effects()).toEqual(nativeEffects);
  if (name === "partial output before failure") {
    expect(native.exitCode).not.toBe(0);
    expect(nativeEffects).toHaveProperty(Buffer.from("one.wav").toString("base64"));
  }
});
