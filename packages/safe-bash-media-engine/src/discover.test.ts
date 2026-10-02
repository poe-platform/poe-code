import { describe, expect, it } from "vitest";
import { discover } from "./index.js";
const b = (s: string) => new TextEncoder().encode(s);
const text = (v: Uint8Array) => new TextDecoder().decode(v);
const parse = (...args: string[]) => discover("ffmpeg", args.map(b));
it('keeps command group separators out of sequential preset parsing', () => {
  for (const name of ['i', 'dec']) {
    const plan = discover('ffmpeg', [`-${name}`, 'opaque', 'out.wav'].map(b), 'preset');
    expect(plan.groups).toEqual([]);
    expect(plan.dependencies).toEqual([]);
    expect(plan.deferred).toContainEqual({ index: 0, reason: 'unknown-option' });
  }
});
it('stops sequential preset predictions at native exit handlers', () => {
  const plan = discover('ffmpeg', ['-version', '-attach', 'unreachable.wav', 'out.mkv'].map(b), 'preset');
  expect(plan.globals.map(option => [option.name, option.value])).toEqual([['version', undefined]]);
  expect(plan.groups).toEqual([]);
  expect(plan.dependencies).toEqual([]);
});
it('excludes inherited path metadata for tee slave options', () => {
  const plan = parse('-f', 'tee', '[f=wav:constructor=missing:toString=missing:__proto__=missing]out.wav');
  expect(plan.dependencies.map(dependency => [dependency.role, dependency.access, text(dependency.value)])).toEqual([
    ['output', 'write', 'out.wav'],
  ]);
});
it('distinguishes AVIO filenames, stdio aliases and literal video-statistics paths', () => {
  const plan = parse('-progress', '-', '-i', 'in.wav', '-attach', '-',
    '-stats_enc_pre:a', '-', '-stats_enc_post:a', 'pipe:3', '-vstats_file', 'pipe:4', 'out.wav');
  expect(plan.dependencies.map(d => [text(d.value), d.kind, d.literal === true])).toEqual([
    ['-', 'descriptor', false], ['in.wav', 'path', false], ['-', 'path', true],
    ['-', 'path', true], ['pipe:3', 'descriptor', false], ['pipe:4', 'path', true], ['out.wav', 'path', false]
  ]);
});
it('keeps slash-loaded dash filenames distinct from native CLI stdin aliases', () => {
  const plan = parse('-/af', '-', '-i', 'pipe:0', 'pipe:1');
  expect(plan.dependencies.map(d => [text(d.value), d.kind, d.literal === true])).toEqual([
    ['-', 'path', true], ['pipe:0', 'descriptor', false], ['pipe:1', 'descriptor', false]
  ]);
});
it('defers passlog prefix expansion rather than predicting a read of the prefix itself', () => {
  const plan = parse('-i', 'in.wav', '-pass', '2', '-passlogfile', 'pipe:3', 'out.wav');
  expect(plan.dependencies.find(d => text(d.value) === 'pipe:3')).toMatchObject({ kind: 'resource-lookup' });
  expect(plan.deferred).toContainEqual({ index: 4, reason: 'generated-name' });
});
it('discovers subtitle macro aliases and positional font directories with native reader semantics', () => {
  const plan = parse('-vf', "subtitles=f='https\\://host/title.srt':fontsdir='pipe\\:3',ass=f='pipe\\:0',subtitles=title.srt:16x16:fonts", 'out');
  expect(plan.dependencies.filter(d => d.role === 'filter-resource').map(d => [text(d.value), d.kind, d.literal])).toEqual([
    ['https://host/title.srt', 'url', false], ['pipe:3', 'path', true],
    ['pipe:0', 'path', true], ['title.srt', 'path', false], ['fonts', 'path', true]
  ]);
});
it('retains slash-loaded subtitle macro fields as AVIO reads and never expands inline styles', () => {
  const plan = parse('-vf', "ass=/f='pipe\\:0':/fontsdir=fonts-option.txt,subtitles=f=title.srt:force_style='FontName=other.srt'", 'out');
  expect(plan.dependencies.filter(d => d.role === 'filter-resource').map(d => [text(d.value), d.kind, d.literal])).toEqual([
    ['pipe:0', 'descriptor', false], ['fonts-option.txt', 'path', false], ['title.srt', 'path', false]
  ]);
});
it('predicts filter output accesses with their reader-specific filename semantics', () => {
  const plan = parse('-vf', "metadata=mode=print:file='pipe\\:3',psnr=f='pipe\\:0',ssim=stats_file=-", 'out');
  expect(plan.dependencies.filter(d => d.role === 'filter-resource').map(d => [text(d.value), d.access, d.kind, d.literal])).toEqual([
    ['pipe:3', 'write', 'descriptor', false], ['pipe:0', 'write', 'path', true], ['-', 'write', 'descriptor', false]
  ]);
});
it('predicts slash-loaded output fields as reads of argument files', () => {
  const plan = parse('-vf', "metadata=/file='pipe\\:0',psnr=/f=destination.txt", 'out');
  expect(plan.dependencies.filter(d => d.role === 'filter-resource').map(d => [text(d.value), d.access, d.kind, d.literal])).toEqual([
    ['pipe:0', 'read', 'descriptor', false], ['destination.txt', 'read', 'path', false]
  ]);
});
it('uses source table positions and aliases for output fields without treating metadata values as paths', () => {
  const plan = parse('-af', 'ametadata=print:key:value:same_str:0:stats.txt', '-vf', 'psnr=diff.txt,ssim=f=other.txt', 'out');
  expect(plan.dependencies.filter(d => d.role === 'filter-resource').map(d => [text(d.value), d.access])).toEqual([
    ['stats.txt', 'write'], ['diff.txt', 'write'], ['other.txt', 'write']
  ]);
});
it('classifies literal filter resources independently of their operand spelling', () => {
  const plan = parse('-vf', "lut3d=file='pipe\\:0',movie=filename='pipe\\:3'", 'out');
  expect(plan.dependencies.filter(d => d.role === 'filter-resource').map(d => [d.kind, d.literal])).toEqual([
    ['path', true], ['descriptor', false]
  ]);
});
it('uses AVIO semantics for slash-loaded filter fields even on literal-reader filters', () => {
  const plan = parse('-vf', "drawtext=/text='pipe\\:0':/fontfile='https\\://host/font'", 'out');
  expect(plan.dependencies.filter(d => d.role === 'filter-resource').map(d => [d.kind, d.literal])).toEqual([
    ['descriptor', false], ['url', false]
  ]);
});
it('discovers tee destinations rather than treating the slave expression as a filename', () => {
  const plan = parse('-i', 'in.wav', '-map', '0:a?', '-f', 'tee',
    "[f=wav]one.wav|[f=wav:onfail=ignore]missing/two.wav|[f=wav]pipe:3|[f=mpegts]https://host/out?sig=%2F+x");
  expect(plan.dependencies.map(d => [d.role, d.kind, text(d.value)])).toEqual([
    ['input', 'path', 'in.wav'], ['output', 'path', 'one.wav'],
    ['output', 'path', 'missing/two.wav'], ['output', 'descriptor', 'pipe:3'],
    ['output', 'url', 'https://host/out?sig=%2F+x']
  ]);
});
it('applies tee token escaping in layers, retaining empty destinations and byte paths', () => {
  const expression = new Uint8Array([...b("[f=wav:select=\\'a:0\\']'a|b.wav'|[]|"), 255, ...b('.wav')]);
  const plan = discover('ffmpeg', [b('-f'), b('tee'), expression]);
  expect(plan.dependencies.map(d => d.value)).toEqual([b('a|b.wav'), b(''), new Uint8Array([255, ...b('.wav')])]);
});
it('discovers tee muxer side resources while leaving malformed slave options native-owned', () => {
  const plan = parse('-f', 'tee', '[f=hls:hls_segment_filename=seg%03d.ts:hls_key_info_file=key.info]out.m3u8|[broken]bad.wav|[f=wav]last.wav');
  expect(plan.dependencies.map(d => [d.role, text(d.value)])).toEqual([
    ['sidecar', 'seg%03d.ts'], ['sidecar', 'key.info'], ['output', 'out.m3u8'], ['output', 'last.wav']
  ]);
  expect(plan.deferred.some(d => d.reason === 'native-access')).toBe(true);
});
it('owns Buffer argv and derived dependencies after producer reuse', () => {
  const input = Buffer.from('clip.wav');
  const plan = discover('ffmpeg', [Buffer.from('-i'), input]);
  input.fill(120);
  expect(text(plan.argv[1])).toBe('clip.wav');
  expect(text(plan.dependencies[0].value)).toBe('clip.wav');
});
describe("ordered native grammar discovery", () => {
  it("keeps seek placement, independent outputs, codecs and maps", () => {
    const plan = parse("-ss", "1", "-i", "a.wav", "-ss", "2", "-map", "0:a?", "-map", "-0:v", "-c:a", "pcm_s16le", "a.mkv", "-c:a:0", "flac", "b.mkv");
    expect(plan.groups.map(g => [g.kind, text(g.target!), g.options.map(o => [o.name, o.value && text(o.value)])])).toEqual([
      ["input", "a.wav", [["ss", "1"]]],
      ["output", "a.mkv", [["ss", "2"], ["map", "0:a?"], ["map", "-0:v"], ["c", "pcm_s16le"]]],
      ["output", "b.mkv", [["c", "flac"]]]
    ]);
    expect(plan.dependencies.map(d => [d.role, text(d.value)])).toEqual([["input", "a.wav"], ["output", "a.mkv"], ["output", "b.mkv"]]);
    expect(plan.deferred.some(d => d.reason === "stream-metadata")).toBe(true);
  });
  it("snapshots raw argv, duplicates, empty and shell-expanded arguments", () => {
    const args = [b("-y"), b("-n"), b("-y"), b("-i"), new Uint8Array([255, 46, 119]), b("-metadata"), b("title=$HOME *"), b("")];
    const original = args.map(a => a.slice());
    const plan = discover("ffmpeg", args);
    args[4][0] = 1;
    expect(plan.argv).toEqual(original);
    expect(plan.globals.map(o => o.name)).toEqual(["y", "n", "y"]);
    expect(plan.dependencies.map(d => d.value)).toEqual([original[4], b("")]);
  });
  it("distinguishes the two end-of-options grammars", () => {
    expect(parse("--", "-first", "-y", "last").globals.map(o => o.name)).toEqual(["y"]);
    const probe = discover("ffprobe", ["--", "-first", "-y", "last"].map(b));
    // -- disables option parsing, so -y becomes a duplicate positional input
    // whose callback stops parsing rather than an overwrite flag or a read.
    expect(probe.dependencies.map(d => text(d.value))).toEqual(["-first"]);
    expect(probe.globals).toEqual([]);
    expect(parse("-i", "-leading.wav", "out.wav").groups[0].target).toEqual(b("-leading.wav"));
  });
  it("does not invent outputs after an unknown option or reject missing values", () => {
    expect(parse("-new_private_option", "opaque", "out").dependencies).toEqual([]);
    expect(parse("-new_private_option", "opaque").deferred.some(d => d.reason === "unknown-option")).toBe(true);
    expect(() => parse("-i")).not.toThrow();
    expect(() => parse("-ss")).not.toThrow();
  });
  it("understands booleans, private arity, stream specifiers and loopback groups", () => {
    const plan = parse("-nostdin", "-i", "in", "-crf", "18", "-c:v:0", "libx264", "out", "-dec", "0:0");
    expect(plan.globals[0].name).toBe("stdin");
    expect(plan.groups.map(g => g.kind)).toEqual(["input", "output", "decoder"]);
    expect(plan.groups[1].options[1].specifier).toEqual(b("v:0"));
    expect(plan.dependencies.map(d => text(d.value))).toEqual(["in", "out"]);
  });
  it("recognizes argument files without interpreting their names as values", () => {
    const plan = parse("-/filter:v", "graph.txt", "-/ss", "time.txt", "-i", "input", "-fpre", "preset", "out");
    expect(plan.dependencies.filter(d => d.role === "option-file").map(d => text(d.value))).toEqual(["graph.txt", "time.txt"]);
    expect(plan.dependencies.some(d => d.role === "preset" && text(d.value) === "preset")).toBe(true);
    expect(plan.deferred.some(d => d.reason === "option-file-content")).toBe(true);
  });
  it("classifies URLs, descriptors, sequences and side effects independently", () => {
    const plan = parse("-progress", "pipe:3", "-i", "https://host/in?x=a:b", "-i", "frame%03d.png", "-i", "fd:4", "-hls_segment_filename", "seg%03d.ts", "out.m3u8");
    expect(plan.dependencies.map(d => [d.kind, text(d.value)])).toEqual([
      ["descriptor", "pipe:3"], ["url", "https://host/in?x=a:b"], ["pattern", "frame%03d.png"], ["descriptor", "fd:4"], ["pattern", "seg%03d.ts"], ["path", "out.m3u8"]
    ]);
  });
  it("discovers quoted filter resources and defers reloading and generated names", () => {
    const plan = parse("-i", "in", "-vf", "drawtext=textfile='a\\:b.txt':reload=1,lut3d=file=lut.cube", "-dump_attachment:t", "", "-passlogfile", "pass", "out");
    expect(plan.dependencies.filter(d => d.role === "filter-resource").map(d => text(d.value))).toEqual(["a:b.txt", "lut.cube"]);
    expect(plan.deferred.some(d => d.reason === "filter-runtime")).toBe(true);
    expect(plan.deferred.some(d => d.reason === "generated-name")).toBe(true);
  });
  it("handles probe input/output and show option arities", () => {
    const plan = discover("ffprobe", ["-show_streams", "-show_entries", "stream=index", "-o", "report.json", "-of", "json", "in.wav"].map(b));
    expect(plan.dependencies.map(d => [d.role, text(d.value)])).toEqual([["output", "report.json"], ["input", "in.wav"]]);
  });
});

it("applies ffprobe's final forced lavfi format without inventing a graph filename", () => {
  for (const args of [["-f", "lavfi", "movie=clip.mp4"], ["movie=clip.mp4", "-f", "lavfi"]]) {
    const plan = discover("ffprobe", args.map(b));
    expect(plan.dependencies.map(d => [d.role, text(d.value)])).toEqual([["filter-resource", "clip.mp4"]]);
  }
});
it("defers a slash-loaded input format instead of using its filename as the format", () => {
  const plan = parse("-/f", "lavfi", "-i", "clip.wav", "out.wav");
  expect(plan.dependencies.map(d => [d.role, text(d.value)])).toEqual([
    ["option-file", "lavfi"], ["input", "clip.wav"], ["output", "out.wav"]
  ]);
});
it("keeps shell-expanded sequence members distinct and exit-option token rules tool-specific", () => {
  expect(parse("-i", "first.png", "second.png", "third.png").dependencies.map(d => text(d.value))).toEqual(["first.png", "second.png", "third.png"]);
  expect(parse("-h", "-i", "file").dependencies.map(d => text(d.value))).toEqual(["file"]);
  expect(discover("ffprobe", ["-h", "-i", "file"].map(b)).dependencies).toEqual([]);
});
it("discovers resources after legacy media-prefixed generic codec options", () => {
  const plan = parse("-vthreads", "1", "-athreads", "2", "-sthreads", "3", "-i", "in.wav", "out.wav");
  expect(plan.dependencies.map(d => text(d.value))).toEqual(["in.wav", "out.wav"]);
  expect(plan.groups[0].options.map(o => [o.name, text(o.value!)])).toEqual([
    ["vthreads", "1"], ["athreads", "2"], ["sthreads", "3"]
  ]);
  const probe = discover("ffprobe", ["-athreads", "2", "in.wav"].map(b));
  expect(probe.dependencies.map(d => text(d.value))).toEqual(["in.wav"]);
});
it("does not extend the legacy codec prefix fallback to format or private codec options", () => {
  for (const name of ["aprobesize", "vcrf", "vthreads:0", "vpixel_format"]) {
    expect(parse("-" + name, "1", "out.wav").dependencies).toEqual([]);
    expect(parse("-" + name, "1").deferred.some(d => d.reason === "unknown-option")).toBe(true);
  }
});
