import { expect, it, vi } from 'vitest';
import { Volume } from 'memfs';
import { parseMvg } from './mvg.js';

const b = (value: string) => new TextEncoder().encode(value);
const text = (value: Uint8Array) => new TextDecoder().decode(value);

it.each(['font.ttf', 'font[0]', 'plain', '%font.ttf'])('discovers accessible MVG font %s as a literal file', async name => {
  const volume = Volume.fromJSON({[name]: 'font bytes'}, '/work');
  const accessible = vi.fn(async (path: string) => {
    try { return volume.statSync('/work/' + path).isFile(); } catch { return false; }
  });
  const result = await parseMvg(b(`push graphic-context font '${name}' text 0,0 'x' pop graphic-context`), b('/work'), 10, {accessible});
  expect(result).toMatchObject({complete:true, budget:false});
  expect(result.references).toMatchObject([{value:b(name), path:b(name), kind:'path', literal:true, access:'read'}]);
});

it('discovers MVG FreeType face syntax without treating ordinary brackets as selectors', async () => {
  const result = await parseMvg(b("font '@font.ttf[0]' text 0,0 'x' font 'font[0]' text 0,0 'y'"), b('/work'), 10, {accessible:async () => true});
  expect(result.references).toMatchObject([
    {value:b('@font.ttf[0]'),path:b('font.ttf'),kind:'path',literal:true},
    {value:b('font[0]'),path:b('font[0]'),kind:'path',literal:true}
  ]);
});

it('keeps unknown font lookups and native font normalization unresolved', async () => {
  const result = await parseMvg(b("font 'Example Sans' text 0,0 'x' font '@TTF:font.ttf[0]' text 0,0 'y'"), b('/work'), 10, {accessible:async () => false});
  expect(result.references).toMatchObject([
    {value:b('Example Sans'),kind:'resource-lookup'},
    {value:b('@TTF:font.ttf[0]'),kind:'filename-expression'}
  ]);
  expect(result.references.every(reference => reference.path === undefined)).toBe(true);
});

it('keeps failed MVG font probes advisory and retains later image discovery', async () => {
  const accessible = async () => { throw Error('probe failed'); };
  const result = await parseMvg(b("font 'Example Sans' image Over 0,0 1,1 'overlay.ppm'"), b('/work'), 10, {accessible});
  expect(result.references.map(reference => text(reference.value))).toEqual(['Example Sans','overlay.ppm']);
  expect(result.references[1]).toMatchObject({kind:'path',path:b('overlay.ppm')});
});
