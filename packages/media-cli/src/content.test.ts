import { expect, it } from "vitest";
import { discover, discoverContent } from "./index.js";
const b = (value: string) => new TextEncoder().encode(value);
const t = (value: Uint8Array) => new TextDecoder().decode(value);
it('defers preset reads after an option missing from the registered grammar', () => {
  const result = discoverContent({ kind: 'preset', location: b('preset'),
    content: b('attach=before.wav\nunknown_preset_option=value\nattach=late.wav\n/af=late.graph\n') });
  expect(result.dependencies.map(dependency => t(dependency.value))).toEqual(['before.wav']);
  expect(result.deferred).toBe(true);
});
it('does not predict preset resources after a sequential native exit handler', () => {
  for (const key of ['version', 'noversion', 'no/version', 'version:0']) {
    const result = discoverContent({ kind: 'preset', location: b('preset'),
      content: b(`attach=before.wav\n${key}=ignored\nattach=unreachable.wav\n/af=unreachable.graph\n`) });
    expect(result.dependencies.map(dependency => t(dependency.value)), key).toEqual(['before.wav']);
    expect(result.deferred).toBe(true);
  }
});
it('follows concat native CR, CRLF and NUL read boundaries while retaining raw filename bytes', () => {
  const content = new Uint8Array([...b('file first.wav\rfile second.wav\r\nfile third.wav\0file '), 255, ...b('.wav\n')]);
  const result = discoverContent({ kind: 'concat-list', location: b('list'), content });
  expect(result.dependencies.map(dependency => dependency.value)).toEqual([
    b('first.wav'), b('second.wav'), b('third.wav'), new Uint8Array([255, ...b('.wav')]),
  ]);
});
it('keeps concat keywords unquoted and stops prediction at unknown or empty directives', () => {
  for (const invalid of ["'file' invented.wav", 'unknown value', 'file']) {
    const result = discoverContent({ kind: 'concat-list', location: b('list'), content: b(`file first.wav\n${invalid}\nfile unreachable.wav\n`) });
    expect(result.dependencies.map(dependency => dependency.value)).toEqual([b('first.wav')]);
    expect(result.deferred).toBe(true);
  }
});
it('uses preset strtok delimiters and per-read C-string boundaries', () => {
  const result = discoverContent({ kind: 'preset', location: b('preset'), content: b('/attach=name.txt\rignored\nattach=first\0ignored\nattach==literal\nattach=last\n') });
  expect(result.dependencies.map(dependency => [dependency.role, t(dependency.value)])).toEqual([
    ['option-file', 'name.txt'], ['attachment', 'first'], ['attachment', '=literal'], ['attachment', 'last'],
  ]);
});

it('retains leading preset delimiters when opt_preset ignores returned token pointers', () => {
  expect(discoverContent({ kind: 'preset', location: b('preset'), content: b('==/attach=name.txt\n') }).dependencies).toEqual([]);
  expect(discoverContent({ kind: 'preset', location: b('preset'), content: b('attach=\rname.txt\n') }).dependencies.map(dependency => dependency.value)).toEqual([b('\rname.txt')]);
});

it('stops preset prediction at a native-invalid empty assignment', () => {
  const result = discoverContent({ kind: 'preset', location: b('preset'), content: b('attach=first\nattach=\nattach=unreachable\n') });
  expect(result.dependencies.map(dependency => t(dependency.value))).toEqual(['first']);
});

it('follows the native 999-byte preset read limit without splitting byte characters', () => {
  const content = new Uint8Array([...b('#' + 'x'.repeat(998)), ...b('attach='), 255, ...b('.txt\n')]);
  const result = discoverContent({ kind: 'preset', location: b('preset'), content });
  expect(result.dependencies.map(dependency => dependency.value)).toEqual([new Uint8Array([255, ...b('.txt')])]);
});
it('discovers paths from an already-read option file using its option and stream scope', () => {
  const plan = discover('ffmpeg', ['-/attach', 'attachment-option', '-/filter:a:0', 'graph-option', 'out.mkv'].map(b));
  const options = plan.groups[0].options;
  const attachment = discoverContent({ kind: 'option-file', tool: 'ffmpeg', option: options[0], location: b('/elsewhere/attachment-option'), content: new Uint8Array([255, ...b('.txt\n')]) });
  expect(attachment.dependencies).toEqual([expect.objectContaining({ index: 0, value: new Uint8Array([255, ...b('.txt\n')]), role: 'attachment', access: 'read', stage: 'runtime', base: 'cwd' })]);
  const filter = discoverContent({ kind: 'option-file', tool: 'ffmpeg', option: options[1], location: b('/elsewhere/graph-option'), content: b('ametadata=mode=print:file=stats.txt') });
  expect(filter.dependencies).toEqual([expect.objectContaining({ index: 2, value: b('stats.txt'), access: 'write', base: 'cwd' })]);
  expect(filter.deferred).toBe(true);
});
it('uses native C string termination for loaded values while retaining empty values', () => {
  const option = discover('ffmpeg', ['-/attach', 'option.txt', 'out'].map(b)).groups[0].options[0];
  for (const content of [b(''), b('\0ignored'), b('first\0ignored')]) {
    const result = discoverContent({ kind: 'option-file', tool: 'ffmpeg', option, location: b('option.txt'), content });
    expect(result.dependencies.map(d => d.value)).toEqual([content.slice(0, content.includes(0) ? content.indexOf(0) : content.length)]);
  }
});
it('defers loaded metadata and unresolved formats rather than probing streams or inventing filenames', () => {
  for (const name of ['map', 'f', 'c:a:0']) {
    const option = discover('ffmpeg', [b('-/' + name), b('option.txt'), b('out')]).groups[0].options[0];
    expect(discoverContent({ kind: 'option-file', tool: 'ffmpeg', option, location: b('option.txt'), content: b('opaque') })).toEqual({ dependencies: [], deferred: true });
  }
});
it('discovers ffprobe loaded input/output operands with their original option index', () => {
  for (const [name, role, access] of [['i', 'input', 'read'], ['o', 'output', 'write']] as const) {
    const option = discover('ffprobe', ['-/'+name, 'option.txt'].map(b)).globals[0];
    const result = discoverContent({ kind: 'option-file', tool: 'ffprobe', option, location: b('option.txt'), content: b('actual.wav') });
    expect(result.dependencies).toEqual([expect.objectContaining({ index: 0, role, access, value: b('actual.wav') })]);
  }
});
it('retains reader syntax and deferred passlog prefixes in observed presets', () => {
  const result = discoverContent({ kind: 'preset', location: b('preset'), content: b('stats_enc_pre:a=-\nvstats_file=pipe:3\npasslogfile=pipe:4\n/af=-\n') });
  expect(result.dependencies.map(d => [t(d.value), d.kind, d.literal === true])).toEqual([
    ['-', 'path', true], ['pipe:3', 'path', true], ['pipe:4', 'resource-lookup', true], ['-', 'path', true]
  ]);
});
it('discovers preset stream keys and slash-loaded values without parsing the argument-file name', () => {
  const result = discoverContent({ kind: 'preset', location: b('preset'), content: b('af:a:0=ametadata=mode=print:file=stats.txt\n/af:a:0=graph.txt\n/passlogfile:v=log-option.txt\n') });
  expect(result.dependencies.map(d => [t(d.value), d.role, d.access])).toEqual([
    ['stats.txt', 'filter-resource', 'write'], ['graph.txt', 'option-file', 'read'], ['log-option.txt', 'option-file', 'read']
  ]);
});
it('retains filter output access and font lookup semantics in observed scripts', () => {
  const result = discoverContent({ kind: 'filter-script', location: b('script'), content: b('ametadata=mode=print:file=stats.txt,drawtext=font=Example Sans:text=hello') });
  expect(result.dependencies.map(d => [t(d.value), d.access, d.kind])).toEqual([
    ['stats.txt', 'write', 'path'], ['Example Sans', 'read', 'resource-lookup']
  ]);
});
it("discovers resources when a filter script is actually read, with no filesystem access", () => {
  const result = discoverContent({ kind: "filter-script", location: b("script"), content: b("movie='clip.mp4',lut3d=file=lut.cube") });
  expect(result.dependencies.map(d => [t(d.value), d.base])).toEqual([["clip.mp4", "cwd"], ["lut.cube", "cwd"]]);
  expect(result.deferred).toBe(true);
});
it("preserves concat list URL bases and escaping without validating native safety", () => {
  const result = discoverContent({ kind: "concat-list", location: b("https://host/redirected/list"), content: b("ffconcat version 1.0\nfile 'first clip.wav'\nfile ../other.wav\nduration 1\nfile /absolute.wav\n") });
  expect(result.dependencies.map(d => t(d.value))).toEqual(["first clip.wav", "../other.wav", "/absolute.wav"]);
  expect(result.dependencies[0].base).toEqual({ resource: b("https://host/redirected/list") });
});
it("finds nested preset paths but leaves content-dependent filenames deferred", () => {
  const result = discoverContent({ kind: "preset", location: b("p.ffpreset"), content: b("#comment\nfpre=other.ffpreset\nvf=lut3d=file=lut.cube\npasslogfile=stats\n") });
  expect(result.dependencies.map(d => t(d.value))).toEqual(["other.ffpreset", "lut.cube", "stats"]);
  expect(result.deferred).toBe(true);
});
it('discovers positional drawtext font/textfile options and slash-loaded filter options', () => {
  const result = discoverContent({ kind: 'filter-script', location: b('s'), content: b('drawtext=font.ttf:hello:words.txt,drawtext=/text=payload') });
  expect(result.dependencies.map(d => t(d.value))).toEqual(['payload','font.ttf','words.txt']);
});
it('stops interpreting filter shorthand after an explicit key', () => {
  const result = discoverContent({ kind: 'filter-script', location: b('s'), content: b('drawtext=font.ttf:text=hello:invented.txt') });
  expect(result.dependencies.map(d => t(d.value))).toEqual(['font.ttf']);
});
it('uses concat token whitespace delimiters while preserving quoted and escaped whitespace', () => {
  const result = discoverContent({ kind: 'concat-list', location: b('list'), content: b("file first.wav ignored\nfile 'second clip.wav'\nfile third\\ clip.wav\n") });
  expect(result.dependencies.map(d => t(d.value))).toEqual(['first.wav', 'second clip.wav', 'third clip.wav']);
});
