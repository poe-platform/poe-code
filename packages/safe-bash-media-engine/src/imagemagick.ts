import { byteText, textBytes } from "./bytes.js";
import { parseImageMagickOperand, parseImageMagickFontOperand } from "./imagemagick-operand.js";
import { imageMagickOptions, imageMagickReference, imageMagickGrammarRevision } from "./imagemagick.generated.js";

export type ImageMagickTool = keyof typeof imageMagickReference.executables;
export interface ImageMagickDiscoveryContext {
  /** Native IsPathAccessible semantics, in the invocation's filesystem/cwd.
   * Omit or return undefined when unknown; existence alone is insufficient. */
  accessible?(path: Uint8Array): Promise<boolean | undefined>;
  /** Native GetPathAttributes/stat success, including directories and other
   * non-regular paths. Distinct from IsPathAccessible's regular-file/F_OK check. */
  exists?(path: Uint8Array): Promise<boolean | undefined>;
  /** Native IsPathDirectory/stat classification at filename expansion sites.
   * Unknown results remain advisory; existence/accessibility cannot infer this. */
  isDirectory?(path: Uint8Array): Promise<boolean | undefined>;
  /** Optional advisory content read. Native must read again at execution time. */
  read?(path: Uint8Array): Promise<Uint8Array | undefined>;
}
export interface ImageMagickToken {
  readonly raw: Uint8Array;
  readonly index: number;
  readonly source: string;
  readonly depth: number;
  readonly kind: "option" | "operand" | "open" | "close";
  readonly values: readonly Uint8Array[];
  readonly flags?: string;
}
export interface ImageMagickResource {
  readonly operand: Uint8Array;
  readonly path?: Uint8Array;
  /** Discovery removed a likely scene/geometry suffix; no decoded image state. */
  readonly selector?: boolean;
  readonly index: number;
  readonly source: string;
  readonly access: "read" | "write" | "read-write" | "read-delete";
  readonly kind: "path" | "pattern" | "dynamic" | "synthetic" | "register" | "descriptor" | "url";
  readonly role: "image" | "text" | "font" | "profile" | "script" | "list";
}
export interface ImageMagickDiscovery {
  readonly tool: string;
  readonly command: string;
  readonly argv: readonly Uint8Array[];
  readonly grammarRevision: string;
  /** Ordered grammar, not a native image/settings stack or execution plan. */
  readonly tokens: readonly ImageMagickToken[];
  /** Predictions only. Never use to report effects, authorize accesses or fail execution. */
  readonly resources: readonly ImageMagickResource[];
  readonly deferred: readonly { index: number; source: string; reason: string }[];
}

/** Script lexical rules from MagickWand/script-token.c. Incomplete tokens are
 * withheld; completed tokens before a lexical failure still carry predictions. */
export function imageMagickScriptTokens(bytes: Uint8Array): { tokens: Uint8Array[]; incomplete: boolean } {
  // GetChar normalizes standalone CR, but preserves CRLF inside strings.
  const input = byteText(bytes);
  const tokens: Uint8Array[] = [];
  let word = "", quote = "", active = false, column = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i] === '\r' && input[i + 1] !== '\n' ? '\n' : input[i];
    const code = c.charCodeAt(0);
    if (code < 7 || (code > 13 && code < 32 && code !== 27)) return { tokens, incomplete: true };
    if (!quote && !active && (c === '#' || (column === 0 && (c === ':' || c === '@')))) {
      while (i < input.length && input[i] !== '\n' && !(input[i] === '\r' && input[i + 1] !== '\n')) {
        const code = input.charCodeAt(i);
        if (code < 7 || (code > 13 && code < 32 && code !== 27)) return { tokens, incomplete: true };
        i++;
      }
      column = 0;
      continue;
    }
    column = c === '\n' ? 0 : column + 1;
    if (c === '\\' && quote !== "'") {
      const next = input[i + 1] === '\r' && input[i + 2] !== '\n' ? '\n' : input[i + 1];
      if (next === undefined) break;
      const code = next.charCodeAt(0);
      if (code < 7 || (code > 13 && code < 32 && code !== 27)) return { tokens, incomplete: true };
      if (next === '\n') { i++; column = 0; continue; }
      if (!quote || next === '"' || next === '\\') {
        i++;
        column++;
        word += next; active = true; continue;
      }
    }
    if (quote) {
      if (c === quote) quote = ''; else word += c;
    } else if (c === "'" || c === '"') { quote = c; active = true; }
    else if (' \t\r\n'.includes(c)) {
      if (active) tokens.push(textBytes(word));
      word = ''; active = false;
    } else { word += c; active = true; }
  }
  if (quote) return { tokens, incomplete: true };
  if (active) tokens.push(textBytes(word));
  return { tokens, incomplete: false };
}

const noFinalOutput = new Set(['identify','mogrify','conjure','animate','display']);
const imageOperands = new Set(['-read','--','-mask','-read-mask','-write-mask','-clip-mask','-texture','-tile','-affinity','-remap','-map']);

export async function discoverImageMagick(tool: string, args: readonly Uint8Array[], context: ImageMagickDiscoveryContext = {}): Promise<ImageMagickDiscovery> {
  const argv = args.map(a => new Uint8Array(a));
  let command = tool;
  let start = 0;
  // utilities/magick.c matches both installed names with the magick prefix.
  // Subcommand dispatch precedes MagickImageCommand's implied-script branch.
  if ((tool === 'magick' || tool === 'magick-script') && argv[0]) {
    const first = byteText(argv[0]).toLowerCase();
    if (Object.hasOwn(imageMagickReference.executables, first) && first !== 'magick' && first !== 'magick-script') { command = first; start = 1; }
  }
  const tokens: ImageMagickToken[] = [], resources: ImageMagickResource[] = [];
  const deferred: { index: number; source: string; reason: string }[] = [];
  const defer = (index: number, source: string, reason: string) => { deferred.push({ index, source, reason }); };
  const accessible = async (name: string): Promise<boolean | undefined> => {
    if (name === '-') return true;
    try { return await context.accessible?.(textBytes(name)); } catch { return undefined; }
  };
  const exists = async (name: string): Promise<boolean | undefined> => {
    try { return await context.exists?.(textBytes(name)); } catch { return undefined; }
  };
  let literalFilenames = false;
  let pedantic = false;
  const visited = new Set<string>();
  const read = async (name: string): Promise<Uint8Array | undefined> => {
    try { return await context.read?.(textBytes(name)); } catch { return undefined; }
  };
  async function interpreted(value: Uint8Array, index: number, source: string): Promise<void> {
    // InterpretImageProperties checks leading C whitespace and IsPathAccessible
    // before @ replacement. Do not read/evaluate the replacement in discovery.
    const text = byteText(value);
    let offset = 0;
    while (' \t\r\n\f\v'.includes(text[offset] ?? '\0')) offset++;
    if (text[offset] === '@') {
      const path = text.slice(offset + 1);
      const available = await accessible(path);
      if (available !== false) {
        await add(textBytes(path), 'read', index, source, 'text');
        defer(index, source, 'native text replacement can change operand interpretation');
      }
      if (available === undefined) defer(index, source, 'filesystem-sensitive text indirection');
    }
    if (text.includes('%')) defer(index, source, 'native property expression');
  }
  async function add(operand: Uint8Array, access: ImageMagickResource['access'], index: number, source: string, role: ImageMagickResource['role'] = 'image', raw = false, expandFilenames = true): Promise<void> {
    let name = byteText(operand);
    // utility.c preserves quote bytes in argv and skips ExpandFilenames for
    // these operands. They are not shell quoting to strip or glob candidates.
    if (name.startsWith('"') || name.startsWith("'")) expandFilenames = false;
    let kind: ImageMagickResource['kind'] = 'path';
    let selector: boolean | undefined;
    if (role === 'text' && name === '-') kind = 'descriptor';
    if (raw && role === 'script' && (name === '-' || name.toLowerCase().startsWith('fd:'))) kind = 'descriptor';
    if (!raw && (role === 'image' || role === 'script')) {
      const parsed = await parseImageMagickOperand(operand, { accessible, exists, literalFilenames, expandFilenames, access });
      name = parsed.name; kind = parsed.kind;
      selector = parsed.selector;
      for (const reason of parsed.deferred) defer(index, source, reason);
      if (parsed.text !== undefined) await interpreted(textBytes(parsed.text), index, source);
    }
    // Concatenate also calls ExpandFilenames before opening its raw operands.
    // Keep coder/scene interpretation out of its eventual fopen/remove paths.
    if (raw && role === 'image' && expandFilenames && await accessible(name) !== true) {
      // ExpandFilenames checks the image tail (without a scene selector),
      // although concatenate subsequently opens the unnormalized raw spelling.
      const expansion = await parseImageMagickOperand(operand, {accessible, exists, literalFilenames, expandFilenames:true});
      // utility.c skips these MagickPath prefixes before testing glob syntax.
      // Concatenate still opens/deletes the original spelling as a raw file.
      // Use the filesystem-sensitive prefix hint, not a lexical colon split.
      const skipsExpansion = expansion.coder !== undefined && ['caption','label','pango','vid'].includes(expansion.coder);
      const tail = name.slice(name.lastIndexOf('/') + 1);
      if (!skipsExpansion && (expansion.kind === 'pattern' || (tail.includes('*') || tail.includes('?')) && await accessible(tail) !== true)) kind = 'pattern';
      for (const reason of expansion.deferred) defer(index, source, reason);
    }
    // ExpandFilenames tests the original argv spelling, before SetImageInfo.
    // A coder-prefixed @name is an image filename, and @names[0] opens the
    // literal list names[0], not the selector-normalized names. Its accessibility
    // check likewise applies to the original operand, never an extracted path.
    const original = byteText(operand);
    if (expandFilenames && (raw || kind === 'path' || kind === 'pattern') && original.startsWith('@') && role === 'image' && await accessible(original) !== true) {
      const list = original.slice(1);
      resources.push({ operand: operand.slice(), path: textBytes(list), index, source, access: 'read', kind: 'path', role: 'list' });
      defer(index, source, 'native filename list expansion');
      const membersStart = resources.length;
      if (visited.has('list:' + list) || visited.size < 32) {
        visited.add('list:' + list);
        const bytes = await read(list);
        if (bytes) {
          // ExpandFilenames uses StringToArgv, NOT the magick-script lexer:
          // quotes only at word start; no escapes or comments.
          const contents = byteText(bytes).split('\0')[0];
          const members: Uint8Array[] = [];
          let offset = 0;
          while (offset < contents.length) {
            while (' \t\r\n\f\v'.includes(contents[offset] ?? '\0')) offset++;
            if (offset >= contents.length) break;
            const quote = ['"', "'"].includes(contents[offset]) ? contents[offset++] : undefined;
            const start = offset;
            while (offset < contents.length && (quote ? contents[offset] !== quote : !' \t\r\n\f\v'.includes(contents[offset]))) offset++;
            // utility.c transfers this list directly into argv; it does not
            // recurse through ExpandFilenames for substituted list entries.
            members.push(textBytes(contents.slice(start, offset)));
            while (offset < contents.length && !' \t\r\n\f\v'.includes(contents[offset])) offset++;
          }
          const directories: (boolean | undefined)[] = [];
          for (const member of members) {
            let directory: boolean | undefined;
            try { directory = await context.isDirectory?.(member); } catch { /* Advisory probe only. */ }
            directories.push(directory);
          }
          if (directories.some(directory => directory === undefined)) defer(index, source, 'filesystem-sensitive filename-list directory filtering');
          // utility.c retains the original argv spelling if every member is a
          // directory. In mixed lists it filters directories, except parameters
          // transferred verbatim using the shared signed command table.
          if (!directories.every(directory => directory === true)) {
            let parameters = 0;
            for (let memberIndex = 0; memberIndex < members.length; memberIndex++) {
              const member = members[memberIndex];
              const name = byteText(member).toLowerCase();
              const arity = Object.hasOwn(imageMagickOptions, name) ? imageMagickOptions[name].arity : 0;
              if (parameters > 0 || arity > 0 || directories[memberIndex] !== true) await add(member, access, index, list, 'image', raw, false);
              if (parameters > 0) parameters--;
              else parameters = arity;
            }
          }
        }
      }
      // Empty/failed expansions retain the original operand in utility.c.
      // Unknown advisory content can do the same; later native expansion still
      // owns the eventual output choice, never these candidate effects.
      if (resources.length === membersStart) resources.push({operand:operand.slice(), path:textBytes(name), ...(selector ? {selector} : {}), index, source, access, kind:'path', role});
      return;
    }
    resources.push({ operand: operand.slice(), ...(kind === 'path' || kind === 'pattern' ? { path: textBytes(name) } : {}), ...(selector ? {selector} : {}), index, source, access, kind, role });
  }
  async function script(name: Uint8Array, index: number, source: string): Promise<void> {
    // AcquireScriptTokenInfo opens literal filenames, stdin or fd: streams;
    // it does not call the image coder/scene resolver or ExpandFilenames.
    await add(name, 'read', index, source, 'script', true);
    const path = byteText(name);
    defer(index, source, 'native script stream and runtime dependencies');
    if (path === '-' || path.toLowerCase().startsWith('fd:')) return;
    if (visited.has('script:' + path) || visited.size >= 32) return;
    visited.add('script:' + path);
    const bytes = await read(path);
    if (!bytes) return;
    const lexed = imageMagickScriptTokens(bytes);
    if (lexed.incomplete) defer(index, path, 'incomplete script token');
    await scan(lexed.tokens, 0, path, true);
  }
  async function scan(input: readonly Uint8Array[], begin: number, source: string, isScript: boolean): Promise<void> {
    const modern = command === 'magick' || command === 'magick-script' || isScript;
    const unexpanded = new Set<number>();
    if (!modern) {
      // Legacy ExpandFilenames runs before command-specific parsing. It skips
      // parameters using the shared table even when IsCommandOption later
      // treats the option as a file, or the legacy signed arity is different.
      for (let i = begin; i < input.length; i++) {
        const count = imageMagickOptions[byteText(input[i]).toLowerCase()]?.arity ?? 0;
        for (let n = 0; n < count && i + 1 < input.length; n++) unexpanded.add(++i);
      }
    }
    let depth = 0;
    const outputSettings = new Map<string, Uint8Array>();
    const final = !isScript && !noFinalOutput.has(command) ? input.length - 1 : -1;
    for (let i = begin; i < input.length; i++) {
      const raw = input[i], name = byteText(raw), lower = name.toLowerCase();
      if (i !== final && (name === '(' || name === ')' || (modern && (name === '{' || name === '}')))) {
        tokens.push({raw, index:i, source, depth, kind: name === '(' || name === '{' ? 'open' : 'close', values:[]});
        depth += name === '(' || name === '{' ? 1 : -1;
        continue;
      }
      const entry = Object.hasOwn(imageMagickOptions, lower) ? imageMagickOptions[lower] : undefined;
      const metadata = modern && entry?.flags.includes('NonMagickOptionFlag') ? undefined : entry;
      const signed = (name[0] === '-' || name[0] === '+') && name.length > 1 && 'abcdefghijklmnopqrstuvwxyz'.includes(lower[1]);
      // Modern known-option lookup precedes IsCommandOption. Legacy calls it first.
      const pathAccessible = (!modern || !metadata || i === final) && !pedantic && signed ? await accessible(name) : false;
      if (signed && pathAccessible === undefined) defer(i, source, 'filesystem-sensitive option classification');
      const option = i !== final && (modern && metadata || signed && pathAccessible !== true);
      if (option) {
        if (!metadata) { defer(i, source, 'unknown option; native validation'); tokens.push({raw,index:i,source,depth,kind:'option',values:[]}); continue; }
        // Audited legacy branch differences (MagickWand/{compare,composite,
        // montage,mogrify,deprecate}.c). Modified discovery hints for the
        // 7.1.2-31 legacy no-operand branches: mogrify.c:4799-4845,
        // deprecate.c:1543-1589 and montage.c:933-942. These signed resets
        // leave following filenames in argv; the modern table consumes values.
        // Other legacy entries remain table hints. See COPYING.ImageMagick.
        const overrides: Readonly<Record<string, Readonly<Record<string, number>>>> = {
          compare: {'+resize':0}, composite: {'+resize':0, '-tile':0, '+tile':0, '-distort':1, '+distort':0},
          montage: {'+resize':0, '+extent':0},
          mogrify: {'+resize':0, '+function':0, '+evaluate':0, '+evaluate-sequence':0, '+extent':0},
          convert: {'+resize':0, '+function':0, '+evaluate':0, '+evaluate-sequence':0, '+extent':0}
        };
        const count = !modern ? overrides[command]?.[lower] ?? metadata.arity : metadata.arity;
        // ProcessCommandOptions reserves the final argv slot before consuming
        // ordinary option arguments. -script alone may borrow that slot.
        // Keep incomplete grammar advisory, and leave the output token intact;
        // native still decides whether any predicted output is reached.
        const argumentEnd = modern && final >= 0 && lower !== '-script' ? final : input.length;
        const values = input.slice(i + 1, Math.min(i + 1 + count, argumentEnd));
        tokens.push({raw,index:i,source,depth,kind:'option',values,flags:metadata.flags});
        if (values.length !== count || (modern && final >= 0 && i + count >= final && lower !== '-script')) defer(i, source, 'missing option operand before implicit output');
        if (lower === '-script' && modern) {
          if (isScript) {
            // The pinned script parser handles this as a special option, not
            // an fopen or a recursive call. Keep its tokens; native owns the
            // diagnostic and determines whether later predictions execute.
            defer(i, source, 'native script-local special option');
            i += count;
            continue;
          }
          if (values[0]) { await script(values[0], i, source); return; }
        }
        if (lower === '-exit' && modern) return;
        // Modern CLI enables ProcessInterpretProperties for ordinary handlers.
        // -set has its own interpretation path despite NeverInterpretArgsFlag;
        // Genesis/special options bypass the ordinary operation handlers.
        const interprets = modern && ((!metadata.flags.includes('NeverInterpretArgsFlag') && !metadata.flags.includes('GenesisOptionFlag') && !metadata.flags.includes('SpecialOptionFlag')) || lower === '-set' || lower === '+set');
        if (interprets) for (const value of values) await interpreted(value, i, source);
        // Native uses LocaleNCompare for the prefix and LocaleCompare for
        // registry lookup. Track only literal grammar hints, never images.
        const firstValue = values[0] ? byteText(values[0]) : '';
        const registryName = firstValue.slice(0, 9).toLowerCase() === 'registry:' ? firstValue.slice(9).toLowerCase() : undefined;
        if (lower === '-define' && registryName !== undefined) {
          const separator = registryName.indexOf('=');
          const key = separator < 0 ? registryName : registryName.slice(0, separator);
          const enabled = separator >= 0 && ['true','1','yes','on'].includes(registryName.slice(separator + 1));
          if (key === 'option:pedantic') pedantic = enabled;
          if (key === 'filename:literal') literalFilenames = enabled;
        }
        if (lower === '+define' || (modern && lower === '-delete')) {
          if (registryName === 'filename:literal') literalFilenames = false;
          if (registryName === 'option:pedantic') pedantic = false;
        }
        // CLI -set interprets registry keys/values natively. Only literal
        // hints are useful here; property-derived registry changes stay late.
        if (modern && (lower === '-set' || lower === '+set') && values[0]) {
          const key = registryName === undefined ? firstValue : 'registry:' + registryName;
          const value = values[1] ? byteText(values[1]) : '';
          if (key === 'registry:filename:literal' || key === 'registry:option:pedantic') {
            const enabled = lower === '-set' && ['true','1','yes','on'].includes(value.toLowerCase());
            if (key === 'registry:filename:literal') literalFilenames = enabled;
            else pedantic = enabled;
            if (value.includes('%')) defer(i, source, 'native registry property expression');
          }
        }
        // CLIListOperatorImages and legacy MogrifyImage both treat this
        // literal key as a file read. Native runs SetImageInfo before
        // FileToStringInfo; interpretation timing differs between handlers.
        // +set deletes a property and never reads a profile file.
        if ((modern || ['convert','mogrify'].includes(command)) && lower === '-set' && firstValue.toLowerCase() === 'profile') {
          defer(i, source, 'native profile filename normalization or retained filename');
          if (values[1]) {
            const operand = values[1];
            // This handler calls SetImageInfo, then FileToStringInfo, rather
            // than ReadImage. Only ordinary canonical path hints apply here;
            // coder/register/source interpretation and retained filenames stay
            // native. Modern CLI opens the raw value before interpreting the
            // per-image property; legacy MogrifyImage interprets it first.
            const parsed = await parseImageMagickOperand(operand, {accessible, exists, literalFilenames, expandFilenames:false, filenameExpressions:!modern, access:'write'});
            for (const reason of parsed.deferred) defer(i, source, reason);
            const filename = byteText(operand);
            let offset = 0;
            while (' \t\r\n\f\v'.includes(filename[offset] ?? '\0')) offset++;
            const replaced = !modern && filename[offset] === '@' && await accessible(filename.slice(offset + 1)) !== false;
            const path = parsed.kind === 'path' && (modern || !filename.includes('%')) && !replaced;
            // Stock explicitly suppresses FileToStringInfo for canonical '-'.
            if (parsed.kind !== 'descriptor' || parsed.name !== '-') resources.push({
              operand:operand.slice(), ...(path ? {path:textBytes(parsed.name)} : {}),
              ...(path && parsed.selector ? {selector:true} : {}),
              index:i, source, access:'read', kind:path ? 'path' : 'dynamic', role:'profile'
            });
          }
        }
        if (command === 'mogrify' && ['-path','+path','-format','+format'].includes(lower)) {
          if (lower[0] === '+' || !values[0]) outputSettings.delete(lower.slice(1));
          else outputSettings.set(lower.slice(1), values[0]);
        }
        if (values[0]) {
          // WriteImages does not call ExpandFilenames. Legacy preliminary argv
          // expansion also skips known option arguments, including both writes.
          if (lower === '-write' || lower === '+write') await add(values[0], 'write', i, source, 'image', false, false);
          else if (['-encipher', '-decipher', '-cdl'].includes(lower)) {
            // FileToStringInfo opens passkeys literally; CDL's FileToString
            // strips one leading @ (with its own native policy check). Both
            // reach FileToBlob, where only '-' denotes stdin, not fd: or coders.
            const operand = values[0], filename = byteText(operand);
            const path = lower === '-cdl' && filename.startsWith('@') && filename.length > 1 ? operand.slice(1) : operand.slice();
            const descriptor = byteText(path) === '-';
            resources.push({operand:operand.slice(), ...(descriptor ? {} : {path}), index:i, source, access:'read', kind:descriptor ? 'descriptor' : 'path', role:'text'});
          }
          // CLI -read/-- expands argv. Cache readers call ReadImage directly;
          // their @names and wildcards are image filenames, not argv lists.
          // Stream's -map selects pixel components, unlike the image-cache
          // reader in the other parsers. IsCommandOption above still owns
          // accessible signed-filename classification before this branch.
          else if (imageOperands.has(lower) && !(lower === '-tile' && ['montage','composite'].includes(command)) && !(lower === '-map' && command === 'stream')) await add(values[0], 'read', i, source, 'image', false, lower === '-read' || lower === '--');
          else if (lower === '-fill' || lower === '-stroke') {
            // QueryColorCompliance precedes GetImageCache in stock CLI.
            // Path syntax/accessibility predicts candidates, never color validity.
            const paint = byteText(values[0]);
            defer(i, source, 'native color or image classification');
            if (paint.includes('/') || paint.includes('.') || paint.includes(':') || paint.includes('[') || paint.startsWith('@') || await accessible(paint) === true) await add(values[0], 'read', i, source, 'image', false, false);
          }
          else if (lower === '-font') {
            const font = await parseImageMagickFontOperand(values[0], {accessible,literalFilenames,interpretProperties:interprets});
            for (const reason of font.deferred) defer(i, source, reason);
            if (font.kind !== 'lookup') resources.push({operand:values[0].slice(), ...(font.kind === 'path' ? {path:textBytes(font.name)} : {}), index:i, source, access:'read', kind:font.kind, role:'font'});
          } else if (lower === '-profile') {
            // GetImageCache first uses ReadImage, including coder/scene/register
            // resolution. On failure FileToStringInfo tries the original literal
            // spelling. Neither reader performs argv list/glob expansion. Predict
            // both candidates without decoding a profile or choosing the branch.
            const operand = values[0];
            const parsed = await parseImageMagickOperand(operand, {accessible, exists, literalFilenames, expandFilenames:false});
            for (const reason of parsed.deferred) defer(i, source, reason);
            if (parsed.text !== undefined) await interpreted(textBytes(parsed.text), i, source);
            resources.push({operand:operand.slice(), ...(parsed.kind === 'path' ? {path:textBytes(parsed.name)} : {}), ...(parsed.selector ? {selector:true} : {}), index:i, source, access:'read', kind:parsed.kind, role:'profile'});
            if ((parsed.kind !== 'path' || parsed.name !== byteText(operand)) && byteText(operand) !== '-') await add(operand, 'read', i, source, 'profile', true, false);
            defer(i, source, 'native profile reader selection and literal fallback');
          }
          else if (['-caption','-comment','-label'].includes(lower)) {
            // These settings retain text until ReadImage applies it to decoded
            // images. Constitute's property reader uses the same accessibility
            // rule as direct interpretation; replacement and timing stay native.
            await interpreted(values[0], i, source);
            defer(i, source, 'native text setting interpretation after image read');
          }
          else if (lower === '-print' && !interprets) await interpreted(values[0], i, source);
          else if (!interprets && lower === '-format' && ['identify','compare','montage','composite'].includes(command)) {
            // utilities/magick.c requests metadata only for identify/compare.
            // Their handlers interpret retained format text after decoding;
            // montage/composite skip that reader when metadata is NULL.
            if (command === 'identify' || command === 'compare') {
              await interpreted(values[0], i, source);
              defer(i, source, 'native format interpretation after image processing');
            }
          }
          else if (!interprets && ['convert','mogrify'].includes(command) && (lower === '-annotate' || lower === '-set')) {
            // MogrifyImage interprets only the text/value, not the geometry/key.
            // Its property reader probes whitespace-prefixed @ paths and leaves
            // inaccessible names literal. +set deletes a literal key instead.
            if (values[1]) await interpreted(values[1], i, source);
          }
          else if (!interprets && ['-annotate','-format','-set'].includes(lower)) {
            const value = values.at(-1)!;
            if (byteText(value).startsWith('@')) await add(value.slice(1), 'read', i, source, 'text');
          }
          if (['-draw','-fx','-format','-set','-path'].includes(lower)) defer(i, source, 'native expression, drawing or output setting');
        }
        i += values.length;
      } else {
        // Legacy parsers recognize -- inside their filename branch, not as
        // the modern -read operation. A trailing -- remains a literal file.
        const escaped = !modern && name === '--' && i !== final && i + 1 < input.length;
        tokens.push({raw,index:i,source,depth,kind:'operand',values:escaped ? [input[i + 1]] : []});
        if (escaped) {
          const filenameIndex = ++i;
          const access = command === 'mogrify' ? outputSettings.size ? 'read' : 'read-write' : 'read';
          await add(input[i], access, filenameIndex, source, 'image', false, !unexpanded.has(i));
          if (command === 'mogrify' && outputSettings.size) {
            resources.push({operand:input[i].slice(),index:i,source,access:'write',kind:'dynamic',role:'image'});
            defer(i, source, 'mogrify path/format output requires native decoded filename');
          }
          if (i === final) {
            await add(input[i], 'write', i, source, 'image', false, false);
            defer(i, source, 'escaped input also reserved as implicit native output');
          }
          continue;
        }
        if (i === final && lower === '-exit') continue;
        await add(raw, command === 'mogrify' ? outputSettings.size ? 'read' : 'read-write' : i === final ? 'write' : 'read', i, source, command === 'conjure' ? 'script' : 'image', false, (!modern || i !== final) && !unexpanded.has(i));
        if (command === 'mogrify' && outputSettings.size) {
          resources.push({operand:raw.slice(), index:i, source, access:'write', kind:'dynamic', role:'image'});
          defer(i, source, 'mogrify path/format output requires native decoded filename');
        }
      }
    }
  }
  defer(start, 'argv', 'runtime filesystem bridge owns all actual accesses and effects');
  if (command.endsWith('-config')) defer(start, 'argv', 'installed build helper; no image grammar');
  else if (command === 'magick-script' && argv[start] && (byteText(argv[start]) === '-' || !byteText(argv[start]).startsWith('-'))) await script(argv[start], start, 'argv');
  // A script alias starting with an option falls back to MagickImageCommand's
  // ordinary special cases; only the implied-script branch above reads a script.
  else if (['magick','magick-script','convert'].includes(command) && byteText(argv[start] ?? new Uint8Array()).toLowerCase() === '-concatenate' && argv.length - start >= 2) {
    defer(start, 'argv', 'concatenate filename expansion can change raw output and deletion operands');
    // ExpandFilenames runs over the whole vector before fopen chooses the last
    // operand. Its shared-table parameter skipping applies even though the
    // concatenate loop subsequently opens every argument as a raw filename.
    let parameters = 0;
    for (let i = start + 1; i < argv.length; i++) {
      await add(argv[i], 'read-delete', i, 'argv', 'image', true, parameters === 0);
      if (parameters > 0) parameters--;
      else parameters = imageMagickOptions[byteText(argv[i]).toLowerCase()]?.arity ?? 0;
    }
    const expanded = resources.splice(0);
    const operands = expanded.filter(r => r.role === 'image');
    const output = operands.pop();
    resources.push(...expanded.filter(r => r.role === 'list'));
    if (output) resources.push({...output, access:'write'});
    resources.push(...operands);
  } else if ((command === 'magick' || command === 'magick-script') && argv.length - start === 2 && byteText(argv[start]).toLowerCase() === '-list') {
    // MagickImageCommand handles this query before ProcessCommandOptions,
    // without reserving an implicit image output or validating the list here.
    tokens.push({raw:argv[start],index:start,source:'argv',depth:0,kind:'option',values:[argv[start + 1]],flags:imageMagickOptions['-list'].flags});
  } else if (argv.length - start === 1 && ['-version','--version','-help','--help','-usage'].includes(byteText(argv[start]).toLowerCase())) {
    tokens.push({raw:argv[start],index:start,source:'argv',depth:0,kind:'option',values:[]});
  } else {
    if (command !== 'magick' && command !== 'magick-script') defer(start, 'argv', 'legacy parser arities and filename expansion require runtime; modern table hints are not full support');
    await scan(argv, start, 'argv', false);
  }
  return {tool, command, argv, grammarRevision:imageMagickGrammarRevision, tokens, resources, deferred};
}

export interface ImageMagickInvocation<Context> {
  readonly tool: ImageMagickTool;
  /** Alias path must retain argv[0] dispatch; never replace it with its realpath. */
  readonly executable: (typeof imageMagickReference.executables)[ImageMagickTool];
  readonly argv: readonly Uint8Array[];
  readonly discovery: ImageMagickDiscovery;
  readonly context: Context;
}
export interface ImageMagickBinding<Context> {
  readonly build: string;
  readonly grammarRevision: string;
  readonly argv: 'bytes';
  readonly lateAccess: 'complete';
  readonly effects: 'live';
  discoveryContext?(context: Context): ImageMagickDiscoveryContext;
  /** Execute stock CLI once. Drain native diagnostics, descriptors and observed
   * effects (including deletions/partial writes on failure) before resolving.
   * No operation ABI, predicted-effect replay or success-only collection. */
  run(invocation: ImageMagickInvocation<Context>): Promise<{exitCode:number}>;
}
export function createImageMagickShims<Context>(binding: ImageMagickBinding<Context>): Record<ImageMagickTool, (argv: readonly Uint8Array[], context: Context) => Promise<{exitCode:number}>> {
  if (binding.build !== imageMagickReference.id || binding.grammarRevision !== imageMagickGrammarRevision) throw Error('Native ImageMagick build or grammar drift');
  if (binding.argv !== 'bytes' || binding.lateAccess !== 'complete' || binding.effects !== 'live') throw Error('ImageMagick requires byte argv, complete late access and live effects');
  const run = binding.run.bind(binding);
  const getDiscoveryContext = binding.discoveryContext?.bind(binding);
  return Object.fromEntries((Object.keys(imageMagickReference.executables) as ImageMagickTool[]).map(tool => [tool, async (args: readonly Uint8Array[], context: Context) => {
    if (!Array.isArray(args)) throw new TypeError('Native argv must be an array of byte arguments');
    const argv = Array.from({ length: args.length }, (_, index) => {
      if (!Object.hasOwn(args, index)) throw new TypeError('Native argv slot is missing');
      const arg = args[index];
      if (!(arg instanceof Uint8Array)) throw new TypeError('Native argv arguments must be bytes');
      return new Uint8Array(arg);
    });
    if (argv.some(a => a.includes(0))) throw Error('NUL is not representable in native argv');
    let discoveryContext: ImageMagickDiscoveryContext | undefined;
    try { discoveryContext = getDiscoveryContext?.(context); } catch { /* Advisory lookup must not replace native errors. */ }
    const discovery = await discoverImageMagick(tool, argv, discoveryContext);
    const result = await run({tool, executable:imageMagickReference.executables[tool], argv, discovery, context});
    const exitCode = result?.exitCode;
    if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) throw new TypeError('Invalid native exit status');
    return { exitCode };
  }])) as Record<ImageMagickTool, (argv: readonly Uint8Array[], context: Context) => Promise<{exitCode:number}>>;
}
