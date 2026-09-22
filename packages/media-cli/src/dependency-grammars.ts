import { imageMagickAccessReferences } from './imagemagick-references.js';
import { frontendIssues } from './frontend-issues.js';
import { parseMvg } from './mvg.js';
import { SaxesParser } from 'saxes';
import { byteText, textBytes } from './bytes.js';
import { concatFiles, concatfFiles, manifestLines } from './concat.js';
import { discoverContent, presetDependencies } from './content.js';
import { presetAssignments } from './preset.js';
import { filterOptions } from './discover.js';
import { filterResources, filterValueResource } from './resources.js';
import { discoverImageMagick, imageMagickScriptTokens } from './imagemagick.js';
import { protocol, resolveLocation } from './resolution-path.js';
import { parseFilenameExpression } from './filename-expression.js';
import { imageMagickPropertyReference, imageMagickReaderReferences } from './imagemagick-operand.js';
import type { AccessGraph, AccessReference, DependencyGrammar, ResolutionBase, ResolutionOptions } from './resolution-types.js';

export interface ParsedContent { references: AccessReference[]; issues: string[]; diagnostics?: AccessGraph['issues']; incomplete: boolean; budget: boolean }
/** Registered ff_parse_key_value reader: quoted backslash escapes, whitespace
 * delimited bare values and last assignment wins. This is not shell parsing. */
function attributes(input: string): Map<string, string> {
  const result = new Map<string, string>();
  let i = 0;
  while (i < input.length) {
    while (input[i] === ',' || ' \t\r\n\v\f'.includes(input[i] ?? '\0')) i++;
    if (i === input.length) break;
    const start = i;
    while (i < input.length && input[i] !== '=') i++;
    if (i === input.length) break;
    const key = input.slice(start, i++);
    const quoted = input[i] === '"';
    if (quoted) i++;
    let value = '';
    while (i < input.length && (quoted ? input[i] !== '"' : input[i] !== ',' && !' \t\r\n\v\f'.includes(input[i]))) {
      if (quoted && input[i] === '\\') {
        if (i + 1 === input.length) break;
        i++;
      }
      value += input[i++];
    }
    result.set(key, value);
    if (quoted && input[i] === '"') i++;
  }
  return result;
}

interface Element { name: string; attrs: Record<string, string>; children: Element[]; content: (string | Element)[]; start: number; end: number }
/** libxml's xmlNodeGetContent string value, including descendant text in
 * document order. Keep references to child nodes rather than copying every
 * descendant's text into every ancestor; depth is bounded by the XML reader. */
function xmlText(node: Element): string {
  const text: string[] = [];
  const pending = [...node.content].reverse();
  while (pending.length) {
    const part = pending.pop()!;
    if (typeof part === 'string') text.push(part);
    else for (let index = part.content.length - 1; index >= 0; index--) pending.push(part.content[index]);
  }
  return text.join('');
}
function xml(content: Uint8Array, maxDepth: number, foldNames: boolean): { root: Element; error?: Error } {
  const root: Element = { name: '', attrs: {}, children: [], content: [], start: 0, end: content.length };
  const stack = [root];
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => { throw new Error('External/entity declarations require native resolution'); });
  parser.on('opentag', tag => {
    if (stack.length > maxDepth) throw new ContentBudgetError();
    const attrs: Record<string, string> = {};
    for (const attr of Object.values(tag.attributes)) {
      const key = attr.uri === 'http://www.w3.org/1999/xlink' ? 'xlink:' + attr.local
        : attr.uri === 'http://www.w3.org/XML/1998/namespace' ? 'xml:' + attr.local : attr.name;
      attrs[key] = attr.value;
    }
    // dashdec.c compares element names with av_strcasecmp; attributes stay exact.
    const node: Element = { name: foldNames ? tag.local.toLowerCase() : tag.local, attrs, children: [], content: [], start: parser.position, end: parser.position };
    stack.at(-1)!.content.push(node);
    stack.at(-1)!.children.push(node); stack.push(node);
  });
  parser.on('text', value => { stack.at(-1)!.content.push(value); });
  parser.on('cdata', value => { stack.at(-1)!.content.push(value); });
  parser.on('closetag', () => { stack.pop()!.end = parser.position; });
  try { parser.write(new TextDecoder('utf-8', { fatal: true }).decode(content)).close(); }
  catch (error) { return { root, error: error instanceof Error ? error : new Error('Unresolved XML grammar') }; }
  return { root };
}

class ContentBudgetError extends Error { constructor() { super('Content expansion exceeds explicit budget'); } }

export async function parseDependencyContent(grammar: DependencyGrammar, content: Uint8Array, location: Uint8Array, cwd: Uint8Array, limits: { nodes: number; depth: number }, optionReader?: AccessReference['optionReader'], filterReader?: AccessReference['filterReader'], filesystem: Pick<ResolutionOptions, 'accessible' | 'exists' | 'directory' | 'policy'> = {}): Promise<ParsedContent> {
  const references: AccessReference[] = [], issues: string[] = [];
  let diagnostics: AccessGraph['issues'][number][] | undefined;
  let incomplete = false, budget = false;
  const resourceBase: ResolutionBase = { kind: 'resource', value: location };
  const cwdBase: ResolutionBase = { kind: 'directory', value: cwd };
  const add = (value: Uint8Array, extra: Partial<AccessReference> = {}) => { if (references.length >= limits.nodes) throw new ContentBudgetError(); references.push({ value, access: 'read', base: resourceBase, ...extra }); };
  const imageAccessible = async (path: Uint8Array): Promise<boolean | undefined> => {
    if (path.length === 1 && path[0] === 45) return true;
    try {
      // Probe filename bytes, even when a colon resembles a URL/coder. Native
      // checks the literal path before choosing that interpretation.
      return await filesystem.accessible?.(resolveLocation(path, cwdBase, true));
    }
    catch { return undefined; }
  };
  const imageExists = async (path: Uint8Array): Promise<boolean | undefined> => {
    try { return await filesystem.exists?.(resolveLocation(path, cwdBase, true)); }
    catch { return undefined; }
  };
  const imagePaths = {
    accessible: async (name: string) => imageAccessible(textBytes(name)),
    exists: async (name: string) => imageExists(textBytes(name)),
  };
  const input = byteText(content);
  try {
    if (grammar === 'text') return { references, issues, incomplete, budget };
    if (grammar === 'filter-option') {
      if (filterReader?.discardValue) return { references, issues, incomplete, budget };
      if (!filterReader) throw new Error('Filter-option content requires the selected filter reader');
      const end = content.indexOf(0);
      const file = filterValueResource(filterReader.filter, filterReader.name, content.slice(0, end < 0 ? content.length : end));
      if (file) add(file.value, { access: file.access ?? 'read', base: cwdBase, kind: file.kind, literal: file.literal, filterReader: file.filterReader, grammar: file.filterReader ? 'filter-option' : undefined });
      issues.push('Loaded filter option application, initialization and reloads remain live');
    } else if (grammar === 'option-file') {
      if (!optionReader) throw new Error('Option-file content requires the selected option reader');
      const parsed = discoverContent({ kind: 'option-file', location, content, tool: optionReader.tool,
        option: { name: optionReader.name, specifier: optionReader.specifier, discardValue: optionReader.discardValue, index: -1, fromFile: true, scopes: [] } });
      for (const dependency of parsed.dependencies) add(dependency.value, {
        access: dependency.access, base: cwdBase, literal: dependency.literal,
        kind: dependency.kind === 'resource-lookup' ? 'resource-lookup' : dependency.literal ? 'path' : undefined,
        optionReader: dependency.optionReader, filterReader: dependency.filterReader,
        grammar: dependency.filterReader ? 'filter-option' : dependency.role === 'option-file' ? dependency.optionReader && filterOptions.includes(dependency.optionReader.name) ? 'filter' : 'option-file'
          : dependency.role === 'preset' ? 'preset' : dependency.role === 'filter-script' ? 'filter'
          : optionReader.name === 'hls_key_info_file' ? 'hls-key-info' : undefined,
      });
      issues.push('Loaded option application and metadata-dependent reader selection remain live');
    } else if (grammar === 'mvg') {
      const parsed = await parseMvg(content, cwd, limits.nodes, imagePaths);
      for (const reference of parsed.references) add(reference.value, reference);
      if (parsed.budget) throw new ContentBudgetError();
      if (!parsed.complete) { incomplete = true; issues.push('MVG command expansion remains unresolved'); }
    } else if (grammar === 'filter') {
      const parsed = filterResources(content);
      for (const file of parsed.resources) add(file.value, { access: file.access ?? 'read', base: cwdBase, kind: file.kind ?? (file.literal ? 'path' : undefined), literal: file.literal, filterReader: file.filterReader, grammar: file.filterReader ? 'filter-option' : undefined });
      if (!parsed.complete) {
        diagnostics = [{ reason: 'syntax', detail: 'Malformed filter graph requires native validation' }];
        incomplete = true;
      }
      issues.push('Filter initialization, fontconfig, commands and frame-time paths remain live');
    } else if (grammar === 'preset') {
      for (const { key, value, index, span } of presetAssignments(content)) {
        const parsed = presetDependencies(key, value, index);
        const deferred = frontendIssues(parsed.deferred);
        (diagnostics ??= []).push(...deferred);
        if (deferred.some(issue => issue.reason === 'syntax')) incomplete = true;
        for (const dependency of parsed.dependencies) add(dependency.value, {
          access: dependency.access, base: cwdBase, span,
          kind: dependency.kind === 'resource-lookup' ? 'resource-lookup' : dependency.literal ? 'path' : undefined,
          literal: dependency.literal,
          optionReader: dependency.optionReader, filterReader: dependency.filterReader,
          grammar: dependency.filterReader ? 'filter-option' : dependency.role === 'option-file' ? dependency.optionReader && filterOptions.includes(dependency.optionReader.name) ? 'filter' : 'option-file'
            : dependency.optionReader?.name === 'hls_key_info_file' ? 'hls-key-info'
            : dependency.role === 'preset' ? 'preset' : dependency.role === 'filter-script' ? 'filter' : undefined,
        });
      }
    } else if (grammar === 'concat') {
      const entries: { index: number; options: Map<string, string> }[] = [];
      try {
        for (const { value, span, options } of concatFiles(content)) {
          add(value, { span });
          entries.push({ index: references.length - 1, options });
        }
      } finally {
        // Also preserve options already parsed before a malformed/budget stop.
        // Native copies parent restrictions, then applies the file dictionary.
        for (const { index, options } of entries) {
          if (!options.has('protocol_whitelist') && !options.has('protocol_blacklist')) continue;
          const policy = { ...filesystem.policy };
          if (options.has('protocol_whitelist')) policy.allow = options.get('protocol_whitelist')!.split(',');
          if (options.has('protocol_blacklist')) policy.deny = options.get('protocol_blacklist')!.split(',');
          references[index] = { ...references[index], policy };
        }
      }
    } else if (grammar === 'concatf') {
      for (const { value, span } of concatfFiles(content)) add(value, { base: cwdBase, span, literal: byteText(value) === '-' });
    } else if (grammar === 'hls-key-info') {
      // hlsenc.c reads three fields with ff_get_line, not fgets or a
      // newline-only split. CR, LF (including CRLF) and NUL terminate a read.
      // Its URI/file buffers hold MAX_URL_SIZE bytes plus the terminating NUL.
      // Native drains overlong lines but retains a prefix. Do not silently
      // substitute that prefix for signed content or claim complete discovery.
      let index = 0;
      for (const { line, span } of manifestLines(input)) {
        if (index >= 2) break; // The third field is IV data, never a filename.
        if (line.length > 4096) {
          incomplete = true;
          diagnostics = [{ reason: 'unresolved', detail: 'HLS key-info field exceeds the native 4096-byte reader boundary; remaining dependencies require runtime discovery' }];
          return { references, issues, diagnostics, incomplete, budget };
        }
        if (index === 1 && line) add(textBytes(line), { base: cwdBase, span, literal: line === '-' });
        index++;
      }
      issues.push('HLS key-info application, periodic rekeying and key accesses remain native live decisions');
    } else if (grammar === 'hls') {
      let variant = false;
      const hlsReference = (uri: string, extra: Partial<AccessReference>) => {
        // Preserve variable-bearing content exactly. Substitution can depend on
        // the selected parent playlist and must never probe a placeholder path.
        const expression = parseFilenameExpression(textBytes(uri), 'hls');
        const dynamic = expression.tokens.some(token => token.kind === 'property');
        add(textBytes(uri), { ...extra, ...(dynamic ? { kind: 'filename-expression', filenameDialect: 'hls' } : {}) });
        if (dynamic) issues.push('HLS variable substitution requires runtime discovery');
      };
      const lines = [...manifestLines(input)];
      if (grammar === 'hls' && !lines.length) throw new Error('Missing HLS EXTM3U header');
      for (let index = 0; index < lines.length; index++) {
        let { line } = lines[index];
        const { span } = lines[index];
        if (grammar === 'hls') {
          // hls.c reads through ff_get_chomp_line into MAX_URL_SIZE (4096).
          // The byte alphabet makes length a native byte count, not Unicode
          // code points. Native drains the line but retains only its prefix.
          // Do not rewrite a signed URI or interpret later lines using parser
          // state inferred from different bytes. Runtime owns this capture.
          if (line.length > 4095) {
            incomplete = true;
            (diagnostics ??= []).push({ reason: 'unresolved', detail: 'HLS line exceeds the native 4095-byte reader boundary; remaining dependencies require runtime discovery' });
            return { references, issues, diagnostics, incomplete, budget };
          }
          while (line.length && ' \t\r\n\v\f'.includes(line.at(-1)!)) line = line.slice(0, -1);
          if (index === 0) {
            if (line !== '#EXTM3U') throw new Error('Missing HLS EXTM3U header');
            continue;
          }
        }
        if (!line) continue;
        if (!line.startsWith('#')) { hlsReference(line, { grammar: variant ? 'hls' : undefined, span }); variant = false; continue; }
        const colon = line.indexOf(':');
        const tag = colon < 0 ? line : line.slice(0, colon);
        if (tag === '#EXT-X-STREAM-INF') variant = true;
        // Registered hls.c recognizes these resource tags. Other HLS tags
        // are skipped comments, even when the standard assigns a URI field.
        // Standards vocabulary alone cannot predict a native resource access.
        else if (['#EXT-X-KEY','#EXT-X-MAP','#EXT-X-MEDIA'].includes(tag)) {
          const attrs = attributes(line.slice(colon + 1));
          const uri = attrs.get('URI');
          // hls.c resets key_type to KEY_NONE on every EXT-X-KEY, then
          // enables only these exact methods. Missing/unknown methods do not
          // open a key, even when URI names an existing or signed resource.
          const disabledKey = tag === '#EXT-X-KEY' && !['AES-128','SAMPLE-AES'].includes(attrs.get('METHOD') ?? '');
          if (uri && !disabledKey) hlsReference(uri, { span, grammar: tag === '#EXT-X-MEDIA' ? 'hls' : undefined });
        }
      }
      if (grammar === 'hls') issues.push('Playlist selection, protocol policy, byte ranges and reloads are native live accesses');
    } else if (grammar === 'magick-script') {
      const parsed = imageMagickScriptTokens(content);
      // The existing frontend owns incremental script option grammar. Supplying
      // tokens as script mode avoids reserving an implicit final output.
      const result = await discoverImageMagick('magick-script', [textBytes('__observed_script__')], {
        accessible: imageAccessible,
        exists: imageExists,
        isDirectory: async path => filesystem.directory?.(resolveLocation(path, cwdBase, true)),
        read: async path => byteText(path) === '__observed_script__' ? content : undefined,
      });
      const adapted = imageMagickAccessReferences(result);
      diagnostics = [...frontendIssues(result.deferred)];
      if (diagnostics.some(issue => issue.reason === 'syntax')) incomplete = true;
      // Only the first occurrence is our entry wrapper. Script-local -script
      // remains a native special option, never a recursive content reader.
      for (const reference of adapted.references.slice(1)) {
        add(reference.value, { ...reference, base: cwdBase });
        const drawing = adapted.inline.get(reference);
        if (drawing) {
          const resources = await parseMvg(drawing, cwd, limits.nodes - references.length, imagePaths);
          for (const resource of resources.references) add(resource.value, resource);
          if (resources.budget) throw new ContentBudgetError();
          if (!resources.complete) { incomplete = true; issues.push('MVG command expansion remains unresolved'); }
        }
      }
      if (parsed.incomplete) { incomplete = true; issues.push('Incomplete script token; earlier operations remain ordered'); }
    } else if (grammar === 'magick-list') {
      // Reuse ExpandFilenames/StringToArgv and image operand semantics together.
      // Only this already observed wrapper has content. Its entries do not
      // undergo another list/glob expansion in the pinned native reader.
      const result = await discoverImageMagick('identify', [textBytes('@__observed_list__')], {
        accessible: async path => byteText(path) === '@__observed_list__' ? false : imageAccessible(path),
        exists: imageExists,
        isDirectory: async path => filesystem.directory?.(resolveLocation(path, cwdBase, true)),
        read: async path => byteText(path) === '__observed_list__' ? content : undefined,
      });
      diagnostics = [...frontendIssues(result.deferred)];
      if (diagnostics.some(issue => issue.reason === 'syntax')) incomplete = true;
      for (const reference of imageMagickAccessReferences(result).references.slice(1)) {
        // Empty/all-directory lists retain the original native @operand. This
        // wrapper has no original spelling: never invent a filesystem resource
        // from its internal name. Runtime owns the fallback and any effects.
        if (reference.source === 'argv' && byteText(reference.value) === '@__observed_list__') {
          issues.push('Native filename-list fallback requires the original runtime operand');
          continue;
        }
        add(reference.value, { ...reference, base: cwdBase, source: byteText(location) });
      }
    } else {
      const document = xml(content, limits.depth, grammar === 'dash' || grammar === 'magick-config');
      if (document.error) {
        // MSL executes SAX start-tag operations before a later syntax error.
        // Preserve that parsed prefix without guessing how native recovery proceeds.
        if (grammar !== 'msl') throw document.error;
        incomplete = true; budget = document.error instanceof ContentBudgetError;
        issues.push(document.error.message);
      }
      if (grammar === 'dash' && document.root.children[0]?.name !== 'mpd') throw new Error('Missing DASH MPD root');
      async function walk(node: Element, bases: readonly ResolutionBase[], inheritedAddressing?: Element): Promise<void> {
        let effective = bases;
        // The pinned dashdec.c joins BaseURL content and never reads xml:base.
        // SVG/XML resource readers still use XML base semantics.
        if (grammar !== 'dash' && grammar !== 'magick-config' && node.attrs['xml:base']) effective = bases.map(base => ({ kind: 'resource', value: resolveLocation(new TextEncoder().encode(node.attrs['xml:base']), base) }));
        const children = node.children.filter(c => c.name === (grammar === 'dash' ? 'baseurl' : 'BaseURL'));
        if (grammar === 'dash' && children.length) {
          if (effective.length > limits.nodes / children.length) throw new ContentBudgetError();
          // dashdec.c reads BaseURL with xmlNodeGetContent. Whitespace is
          // filename/URL data, including signed query and fragment suffixes.
          effective = effective.flatMap(base => children.map(child => ({ kind: 'resource' as const, value: resolveLocation(new TextEncoder().encode(xmlText(child)), base) })));
          if (children.length > 1) issues.push('Multiple DASH BaseURL alternatives require native selection');
          if (node.name !== 'representation' && effective.some(base => {
            const scheme = protocol(byteText(base.value));
            return scheme !== 'http' && scheme !== 'https'
              && parseFilenameExpression(base.value, 'dash-resource').tokens.some(token => token.kind === 'template');
          })) {
            // resolve_content_path mutates the native BaseURL hierarchy. The
            // selected reader can discard inherited local roots rather than
            // perform RFC joining. Keep hints, but never qualify this guessed
            // base or probe its template. Runtime supplies the actual operand.
            incomplete = true;
            (diagnostics ??= []).push({ reason: 'unresolved', detail: 'Inherited templated local BaseURL resolution requires the native reader\'s effective operand' });
          }
        }
        const emit = (value: string, extra: Partial<AccessReference> = {}) => {
          for (const base of effective) add(new TextEncoder().encode(value), { base, ...extra });
        };
        if (grammar === 'dash') {
          if (['initialization','representationindex'].includes(node.name) && node.attrs.sourceURL !== undefined) emit(node.attrs.sourceURL, { filenameDialect: 'dash-resource' });
          if (node.name === 'segmenturl') for (const key of ['media','index']) if (node.attrs[key] !== undefined) emit(node.attrs[key], { filenameDialect: 'dash-resource' });
          if (node.name === 'segmenttemplate') for (const key of ['media','initialization','index']) {
            const value = node.attrs[key];
            if (value !== undefined) emit(value, { kind: value.includes('$') ? 'filename-expression' : undefined, filenameDialect: 'dash' });
          }
          const addressingChildren = node.children.filter(c => ['segmentlist','segmenttemplate','segmentbase'].includes(c.name));
          if (addressingChildren.length > 1) { incomplete = true; issues.push('Ambiguous DASH segment addressing requires native validation'); }
          const ownAddressing = addressingChildren[0];
          const addressing = ownAddressing && ownAddressing.name === inheritedAddressing?.name
            ? { ...ownAddressing, attrs: { ...inheritedAddressing.attrs, ...ownAddressing.attrs }, children: [
              ...inheritedAddressing.children.filter(child => !ownAddressing.children.some(override => override.name === child.name)),
              ...ownAddressing.children,
            ] }
            : ownAddressing ?? inheritedAddressing;
          if (node.name === 'representation' && (!addressing || addressing.name === 'segmentbase')) {
            for (const child of children) for (const base of bases) add(new TextEncoder().encode(xmlText(child)), { base, filenameDialect: 'dash-resource' });
          }
          if (node.attrs['xlink:href']) emit(node.attrs['xlink:href'], { grammar: 'dash' });
          if (node.name === 'representation' && addressing) {
            await walk(addressing, effective);
            for (const alternative of addressingChildren.slice(1)) await walk(alternative, effective);
          }
          for (const child of node.children) if (child.name !== 'baseurl' && !['segmentlist','segmenttemplate','segmentbase'].includes(child.name)) await walk(child, effective, addressing);
          return;
        } else if (grammar === 'msl') {
          const name = node.name.toLowerCase();
          if (name === 'read' || name === 'write') {
            let output: AccessReference[] = [];
            for (const [key, value] of Object.entries(node.attrs)) {
              const bytes = new TextEncoder().encode(value);
              const property = imageMagickPropertyReference(bytes, cwd);
              if (property) add(property.value, property);
              if (key.toLowerCase() === 'filename') {
                const resources = (await imageMagickReaderReferences(bytes, cwd, name === 'read' ? 'read' : 'write', imagePaths))
                  .map(reference => ({ ...reference, optional: property ? true : reference.optional }));
                if (name === 'write') output = resources;
                else for (const reference of resources) add(reference.value, reference);
              }
            }
            // WriteImage runs once after all attributes, using the last filename.
            for (const reference of output) add(reference.value, reference);
          }
          // msl.c uses attribute *names* for GetImageCache/FileToStringInfo.
          // Values are interpreted properties, never profile filenames.
          if (name === 'profile') for (const [key, value] of Object.entries(node.attrs)) {
            const property = imageMagickPropertyReference(new TextEncoder().encode(value), cwd);
            if (property) add(property.value, property);
            const colon = key.indexOf(':');
            const filename = colon < 0 ? key : key.slice(colon + 1);
            add(new TextEncoder().encode(filename), { base: cwdBase, literal: true, optional: true });
          }
        } else if (grammar === 'svg') {
          if (node.name === 'image' || node.name === 'use') {
            const href = node.attrs.href ?? node.attrs['xlink:href'];
            if (href && !href.startsWith('#')) emit(href);
          }
          if (node.name === 'style') issues.push('SVG CSS resources require runtime discovery');
        } else {
          const attrs = Object.fromEntries(Object.entries(node.attrs).map(([key, value]) => [key.toLowerCase(), value]));
          if (node.name === 'include' && attrs.file) emit(attrs.file, { grammar: 'magick-config', literal: true });
          if (node.name === 'type') for (const field of ['glyphs','metrics']) if (attrs[field]) {
            // type.c SetTypeNodePath first tests the literal token against cwd,
            // then concatenates the map directory even for an absolute token.
            // Unknown metadata retains alternatives, never a selected font.
            const value = new TextEncoder().encode(attrs[field]);
            let accessible: boolean | undefined;
            try { accessible = await filesystem.accessible?.(resolveLocation(value, cwdBase, true)); }
            catch { /* Advisory failure cannot expose a native font error. */ }
            if (accessible !== false) add(value, { base: cwdBase, literal: true, optional: accessible !== true });
            if (accessible !== true) {
              for (const base of effective) {
                const map = byteText(base.value);
                const path = textBytes(map.slice(0, map.lastIndexOf('/') + 1) + byteText(value));
                let fallback: boolean | undefined;
                try { fallback = await filesystem.accessible?.(resolveLocation(path, cwdBase, true)); }
                catch { /* Keep failed fallback metadata advisory too. */ }
                add(value, { path, base, literal: true, optional: accessible !== false || fallback !== true });
              }
              issues.push('Font-map accessibility, fallback selection and later font reads remain live');
            }
          }
          if (node.name === 'delegate' && attrs.command) emit(attrs.command, { kind: 'delegate', base: cwdBase });
        }
        for (const child of node.children) if (child.name !== 'BaseURL') await walk(child, effective);
      }
      await walk(document.root, [resourceBase]);
      if (grammar === 'dash') issues.push('DASH timeline/template expansion and reloads require runtime discovery');
      if (grammar === 'msl') issues.push('MSL property replacement, image state and profile cache/fallback remain native live decisions');
    }
  } catch (error) { incomplete = true; budget = error instanceof ContentBudgetError; issues.push(error instanceof Error ? error.message : 'Unresolved content grammar'); }
  return { references, issues, diagnostics, incomplete, budget };
}
