import { expect, it } from 'vitest';
import { parseFilenameExpression } from './filename-expression.js';
const b = (s: string) => new TextEncoder().encode(s);
it('tokenizes HLS variable references without interpreting signed URL octets', () => {
  const parsed = parseFilenameExpression(b('{$dir}/{$segment_1}?sig=%2F+a#part'), 'hls');
  expect(parsed.complete).toBe(true);
  expect(parsed.tokens.map(t => [t.kind,t.value])).toEqual([
    ['property','dir'],['literal','/'],['property','segment_1'],['literal','?sig=%2F+a#part'],
  ]);
  for (const malformed of ['{$missing','{$}','{$invalid name}']) {
    expect(parseFilenameExpression(b(malformed), 'hls').complete).toBe(false);
  }
});
it('parses sequence formatting and escaped percent without expanding frames', () => {
  expect(parseFilenameExpression(b('frame-%%-%03d.png'), 'sequence').tokens.map(t => [t.kind,t.value])).toEqual([['literal','frame-%-'],['counter','03'],['literal','.png']]);
  expect(parseFilenameExpression(b('frame-%s.png'), 'sequence').complete).toBe(false);
});
it('parses ImageMagick nested property/FX references without interpreting them', () => {
  const parsed = parseFilenameExpression(b('%[fx:u[0].r]-%[filename:base]-%03d.png'), 'imagemagick');
  expect(parsed.tokens.filter(t => t.kind !== 'literal').map(t => t.kind)).toEqual(['property','property','counter']);
  expect(parseFilenameExpression(b('%[missing'), 'imagemagick').complete).toBe(false);
});
it('parses DASH template identifiers, formatting, and dollar escapes', () => {
  const parsed = parseFilenameExpression(b('$$-$RepresentationID$-$Number%05d$.m4s'), 'dash');
  expect(parsed.tokens.map(t => [t.kind,t.value])).toEqual([['literal','$-'],['template','RepresentationID'],['literal','-'],['template','Number%05d'],['literal','.m4s']]);
  expect(parseFilenameExpression(b('$unknown$'), 'dash').complete).toBe(false);
});
it.each(['%d', '%5d', '%010d', '%00', '%05x'])('defers DASH format %s which the registered reader does not substitute', format => {
  for (const identifier of ['Number', 'Bandwidth', 'Time']) {
    const parsed = parseFilenameExpression(b(`Case雪\n-$${identifier}${format}$.m4s?sig=%2f+X#part`), 'dash');
    expect(parsed.complete).toBe(false);
    expect(parsed.tokens.at(-1)?.value).toBe('.m4s?sig=%2f+X#part');
  }
});
it.each(['%00d', '%01d', '%09d'])('retains the registered DASH single-digit format %s without expansion', format => {
  for (const identifier of ['Number', 'Bandwidth', 'Time']) {
    const parsed = parseFilenameExpression(b(`$${identifier}${format}$`), 'dash');
    expect(parsed.complete).toBe(true);
    expect(parsed.tokens).toEqual([{ kind: 'template', value: identifier + format, start: 0, end: identifier.length + format.length + 2 }]);
  }
});
