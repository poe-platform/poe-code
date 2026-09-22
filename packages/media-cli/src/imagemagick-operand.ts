import { byteText, textBytes } from './bytes.js';
import { parseFilenameExpression } from './filename-expression.js';
import type { ImageMagickResource } from './imagemagick.js';
import type { AccessReference } from './resolution-types.js';

const syntheticCoders = new Set(['xc','canvas','gradient','radial-gradient','plasma','pattern','rose','logo','wizard','granite','netscape','null','hald']);
/** Likely suffix grammar from IsSceneGeometry/ParseGeometry, not validation.
 * Native parsing still decides whether these bytes form a usable selector. */
export const imageMagickSelectorCharacters = '0123456789xXeE+-,. %!<>^@/:()#\t\r\n\f\v\xD7';

/** RenderType probes ordinary font names literally. Only leading @ selects
 * RenderFreetype's SetImageInfo face resolver; this is not an image reader. */
export async function parseImageMagickFontOperand(value: Uint8Array, options: {
  accessible?: (name: string) => Promise<boolean | undefined>;
  literalFilenames?: boolean;
  /** The modern CLI interprets option properties; legacy font settings do not. */
  interpretProperties?: boolean;
} = {}): Promise<{name:string; kind:'path' | 'dynamic' | 'lookup'; deferred:string[]}> {
  let name = byteText(value);
  const deferred: string[] = [];
  const accessible = async (path: string) => {
    try { return await options.accessible?.(path); } catch { return undefined; }
  };
  if (options.interpretProperties !== false && name.includes('%')) return {name,kind:'dynamic',deferred:['native font property expression']};
  if (name.startsWith('@')) {
    name = name.slice(1);
    const literal = await accessible(name);
    if (name.includes(':')) return {name,kind:'dynamic',deferred:['native font coder filename normalization']};
    if (name.endsWith(']') && !(options.literalFilenames && literal === true)) {
      const bracket = name.lastIndexOf('[');
      const selector = name.slice(bracket + 1, -1);
      if (bracket >= 0 && selector.length && [...selector].every(c => imageMagickSelectorCharacters.includes(c))) name = name.slice(0, bracket);
      else deferred.push('native font face selector or literal brackets');
      if (literal === undefined) deferred.push('filesystem-sensitive font filename');
    }
    return {name,kind:'path',deferred};
  }
  // Path-shaped names remain candidates when missing; native can instead
  // select a registered type or renderer. Predictions never validate a font.
  if (name.includes('/') || name.includes('.') || name.includes('[') || await accessible(name) === true) return {name,kind:'path',deferred};
  return {name,kind:'lookup',deferred:['native font lookup']};
}

/** SetImageInfo/GetPathComponent hints shared by invocation and image readers.
 * Accessibility is advisory; coder selection and literal filename fallback remain
 * native decisions. This parser never expands @ lists or probes image contents. */
export async function parseImageMagickOperand(value: Uint8Array, options: {
  accessible?: (name: string) => Promise<boolean | undefined>;
  /** GetPathAttributes/stat success; not regular-file accessibility. */
  exists?: (name: string) => Promise<boolean | undefined>;
  literalFilenames?: boolean;
  expandFilenames?: boolean;
  /** SetImageInfo(frames=1) file readers do not interpolate scene filenames. */
  filenameExpressions?: boolean;
  access?: ImageMagickResource['access'];
} = {}): Promise<{ name: string; kind: ImageMagickResource['kind']; coder?: string; text?: string; selector?: boolean; deferred: string[] }> {
  let name = byteText(value), kind: ImageMagickResource['kind'] = 'path';
  let selectorRemoved = false;
  const deferred: string[] = [];
  const accessible = async (path: string): Promise<boolean | undefined> => {
    try { return await options.accessible?.(path); }
    catch { deferred.push('filesystem-sensitive accessibility probe failed'); return undefined; }
  };
  const exists = async (path: string): Promise<boolean | undefined> => {
    try { return await options.exists?.(path); }
    catch { deferred.push('filesystem-sensitive stat probe failed'); return undefined; }
  };
  // GetPathComponent removes scene geometry before its colon/file check.
  // A file named xc:red[0] does not shadow xc: unless literal mode retains
  // that suffix; conversely xc:red can shadow xc:red[0] after stripping it.
  let classificationName = name;
  if (name.endsWith(']')) {
    const bracket = name.lastIndexOf('['), selector = name.slice(bracket + 1, -1);
    if (bracket >= 0 && selector.length && [...selector].every(c => imageMagickSelectorCharacters.includes(c))
      && !(options.literalFilenames && await accessible(name) === true)) classificationName = name.slice(0, bracket);
  }
  const colon = name.indexOf(':');
  const candidateAccessible = colon > 0 ? await accessible(classificationName) : undefined;
  const candidateExists = colon > 0 && candidateAccessible !== true ? await exists(classificationName) : candidateAccessible;
  const prefix = colon > 0 && candidateAccessible !== true && candidateExists !== true ? name.slice(0, colon).toLowerCase() : '';
  if (colon > 0 && candidateAccessible !== true && candidateExists === undefined) deferred.push('filesystem-sensitive coder or literal filename');
  let text: string | undefined;
  if (prefix === 'mpr') kind = 'register';
  // WriteImage may fall back from a read-only coder to the decoded image's
  // encoder, restoring the original filename (constitute.c). Source syntax
  // therefore does not imply a destination without filesystem effects.
  else if (options.access === 'write' && prefix !== 'null' &&
    (syntheticCoders.has(prefix) || ['caption','label','pango'].includes(prefix))) {
    kind = 'dynamic'; deferred.push('native encoder selection and literal filename fallback');
  }
  // INLINE/DATA readers use LocaleNCompare for the normalized filename's
  // leading data: scheme. Other operands are blob filenames, including destinations.
  // Keep this lexical hint independent of base64 and image validation.
  else if (['inline','data'].includes(prefix) && options.access !== 'write' && name.slice(colon + 1, colon + 6).toLowerCase() === 'data:') kind = 'synthetic';
  else if (name === '-') kind = 'descriptor';
  else if (prefix === 'fd') {
    // OpenBlob checks IsGeometry before fdopen, unlike script-token.c.
    // Decimal descriptors are a useful hint; other spellings may be native
    // geometry or fall through to a literal filename. Do not validate them
    // here or remove their spelling as though fd were an image coder.
    const descriptor = name.slice(colon + 1);
    if (descriptor.length && [...descriptor].every(c => '0123456789'.includes(c))) kind = 'descriptor';
    else {
      kind = 'dynamic';
      deferred.push('native descriptor geometry or literal filename');
    }
  }
  else if (['http','https','ftp'].includes(prefix)) kind = 'url';
  else if (['caption','label','pango'].includes(prefix)) {
    // LABEL interprets SetImageInfo's canonical filename, which removes a
    // scene suffix. CAPTION/PANGO prefer the retained filename option instead.
    // Literal registry mode selects SubcanonicalPath for an explicit coder,
    // retaining the suffix even when the original coder operand is not a file.
    kind = 'synthetic';
    text = (prefix === 'label' && !options.literalFilenames ? classificationName : name).slice(colon + 1);
  } else if (syntheticCoders.has(prefix)) kind = 'synthetic';
  // InterpretImageFilename returns the original spelling in literal registry
  // mode. External sources still need the runtime bridge in that mode.
  else if ((!options.literalFilenames && options.filenameExpressions !== false && name.includes('%')) || ['screenshot','clipboard'].includes(prefix)) {
    kind = 'dynamic'; deferred.push('native expression, scene filename or external source');
    if (prefix && name.includes('%') && [...prefix].every(c => 'abcdefghijklmnopqrstuvwxyz0123456789_-'.includes(c))) name = name.slice(colon + 1);
  } else {
    let literal = await accessible(name);
    if (literal === undefined && (name.includes('[') || colon > 0)) deferred.push('filesystem-sensitive filename');
    const explicitCoder = prefix !== '' && [...prefix].every(c => 'abcdefghijklmnopqrstuvwxyz0123456789_-'.includes(c));
    if (explicitCoder) {
      name = name.slice(colon + 1); literal = await accessible(name);
    }
    // SetImageInfo selects SubcanonicalPath for an explicit coder in literal
    // registry mode, even for missing files and not-yet-created destinations.
    // GetPathComponent's ordinary literal-path check is a different call site.
    const retainCoderSuffix = options.literalFilenames && explicitCoder;
    if (name.endsWith(']') && !retainCoderSuffix && !(options.literalFilenames && literal === true)) {
      const bracket = name.lastIndexOf('['), selector = name.slice(bracket + 1, -1);
      if (bracket >= 0 && selector.length && [...selector].every(c => imageMagickSelectorCharacters.includes(c))) {
        name = name.slice(0, bracket);
        selectorRemoved = true;
      }
      else if (bracket >= 0) deferred.push('native selector or literal brackets');
    }
    if (name === '-' && prefix) kind = 'descriptor';
    else if (options.expandFilenames && await accessible(byteText(value)) !== true) {
      // ExpandFilenames uses the scene-normalized tail before SetImageInfo
      // chooses the eventual literal coder filename. A retained scene suffix
      // alone therefore does not imply filename glob expansion.
      const expansionName = retainCoderSuffix ? classificationName.slice(colon + 1) : name;
      // utility.c tests TailPath, not HeadPath. Brackets/wildcards in a
      // directory are literal bytes, and accessibility tests the original
      // argv spelling before coder/scene normalization, not this tail.
      const tail = expansionName.slice(expansionName.lastIndexOf('/') + 1);
      // IsGlob also probes its tail argument relative to native cwd, which
      // is distinct from both the original argv and the normalized full path.
      if ([...tail].some(c => '*?{}[]'.includes(c)) && await accessible(tail) !== true) kind = 'pattern';
    }
  }
  return { name, kind, ...(prefix ? {coder:prefix} : {}), text, ...(selectorRemoved ? {selector:true} : {}), deferred };
}

/** ReadImage/WriteImage positions bypass the CLI's ExpandFilenames pass. */
export async function imageMagickReaderReferences(value: Uint8Array, cwd: Uint8Array, access: AccessReference['access'], options: Parameters<typeof parseImageMagickOperand>[1] = {}): Promise<AccessReference[]> {
  const parsed = await parseImageMagickOperand(value, {...options, access});
  const base = { kind: 'directory' as const, value: cwd };
  let kind: AccessReference['kind'] = parsed.kind === 'dynamic' ? 'filename-expression' : parsed.kind === 'pattern' ? 'glob' : parsed.kind;
  const filename = parsed.kind === 'path' || parsed.kind === 'dynamic' && byteText(value).includes('%');
  const path = filename ? textBytes(parsed.name) : undefined;
  if (parsed.kind === 'path' && parsed.selector) kind = 'image-selector';
  if (parsed.kind === 'dynamic' && byteText(value).includes('%')) {
    const expression = parseFilenameExpression(value, 'imagemagick');
    if (access === 'write' && expression.complete && expression.tokens.some(token => token.kind === 'counter')
      && !expression.tokens.some(token => token.kind === 'property')) {
      kind = 'output-pattern';
    }
  }
  const references: AccessReference[] = [{ value, path, kind, access, base,
    literal: filename,
    filenameDialect: kind === 'filename-expression' || kind === 'output-pattern' ? 'imagemagick' : undefined }];
  if (parsed.text !== undefined) {
    const property = imageMagickPropertyReference(textBytes(parsed.text), cwd);
    if (property) {
      // InterpretImageProperties leaves inaccessible @text literal. Preserve
      // unknown candidates without reading replacements or validating images.
      let available: boolean | undefined;
      if (property.kind === 'descriptor') available = true;
      else {
        try { available = await options.accessible?.(byteText(property.path!)); }
        catch { /* Advisory lookup cannot replace native diagnostics. */ }
      }
      if (available !== false) references.push(property);
    }
  }
  return references;
}

/** InterpretImageProperties probes a leading @ filename before replacement.
 * Missing optional text remains native literal text; no replacement is evaluated. */
export function imageMagickPropertyReference(value: Uint8Array, cwd: Uint8Array): AccessReference | undefined {
  const text = byteText(value);
  let offset = 0;
  while (' \t\r\n\f\v'.includes(text[offset] ?? '\0')) offset++;
  if (text[offset] !== '@') return;
  const descriptor = text.slice(offset + 1) === '-';
  return { value: value.slice(offset), path: descriptor ? undefined : value.slice(offset + 1), access: 'read', kind: descriptor ? 'descriptor' : 'path', literal: !descriptor,
    grammar: 'text', base: { kind: 'directory', value: cwd }, optional: true };
}
