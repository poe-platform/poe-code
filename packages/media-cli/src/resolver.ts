import { imageMagickAccessReferences } from './imagemagick-references.js';
import { frontendIssues } from './frontend-issues.js';
import { filterOptions } from './discover.js';
import { concatProtocolMembers } from './concat.js';
import { parseFilenameExpression } from './filename-expression.js';
import { byteText, textBytes } from './bytes.js';
import { parseDependencyContent } from './dependency-grammars.js';
import { classify, protocol, resolveLocation, subfileOperand, traceLocal } from './resolution-path.js';
import type { Discovery } from './types.js';
import type { ImageMagickDiscovery } from './imagemagick.js';
import type { AccessGraph, AccessNode, AccessReference, DependencyGrammar, ResolutionOptions } from './resolution-types.js';
export type * from './resolution-types.js';

export class DiscoveryBudgetError extends Error {
  constructor() { super('Dependency discovery budget exhausted; runtime mediation is still required'); }
}
/** Compare local reader identities only. Interior empty/dot components do not
 * select another object, even across symlinks. Parent components must remain:
 * their meaning depends on the traversed link target. Preserve the POSIX special
 * leading double slash and terminal directory requirements conservatively.
 * This key is never an operand, canonical target or resource resolution base. */
function localReaderIdentity(spelling: string): string {
  const components = spelling.split('/');
  const firstComponent = components.findIndex(part => part !== '');
  if (firstComponent < 0) return spelling;
  return components.filter((part, index) => index < firstComponent || index === components.length - 1
    || part !== '' && part !== '.').join('/');
}
/** An invocation-owned advisory graph. No filesystem opens, stdin reads, network
 * requests, delegates, output writes or native replay are possible through this API.
 * Pass already observed content explicitly, including the effective redirect URL.
 * Submit calls in evaluation/observation order. Graph nodes are access occurrences,
 * never a deduplicated filename set or a canonical file identity. */
export class DependencyResolver {
  private readonly nodes: AccessNode[] = [];
  private readonly edges: AccessGraph['edges'][number][] = [];
  private readonly issues: AccessGraph['issues'][number][] = [];
  private bytes = 0;
  private readonly captures = new Map<number, { location: Uint8Array; grammar: DependencyGrammar; canonical?: string; reader?: string }>();
  private incomplete = false;
  private readonly lineage = new Map<number, readonly { location?: Uint8Array; grammar?: DependencyGrammar; canonical?: string; reader?: string }[]>();
  private lastObserved?: AccessNode;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: ResolutionOptions, initialIssues: AccessGraph['issues'] = []) {
    for (const key of ['nodes', 'bytes', 'depth', 'symlinks'] as const) {
      const value = options.budgets[key];
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('Discovery budgets must be explicit positive safe integers');
    }
    const cwd = new Uint8Array(options.cwd);
    if (!byteText(cwd).startsWith('/')) throw new Error('Resolver cwd must be absolute');
    this.options = { ...options, cwd, budgets: { ...options.budgets },
      policy: options.policy && structuredClone(options.policy) };
    this.issues.push(...structuredClone(initialIssues));
    this.incomplete = initialIssues.some(issue => issue.reason !== 'live');
  }
  private issue(node: number | undefined, reason: AccessGraph['issues'][number]['reason'], detail: string): void {
    this.issues.push({ node, reason, detail });
    if (reason !== 'live') this.incomplete = true;
  }
  private schedule<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    // A rejected admission must not poison later observations. Mutations within
    // one submission, including recursive protocol/content expansion, stay atomic
    // with respect to other submissions, not with respect to native execution.
    this.pending = result.catch(() => undefined);
    return result;
  }
  add(reference: AccessReference, parent?: number): Promise<AccessNode> {
    // Capture at submission, before an earlier callback can reuse these bytes.
    reference = structuredClone(reference);
    return this.schedule(() => this.admit(reference, parent));
  }
  private async admit(reference: AccessReference, parent?: number): Promise<AccessNode> {
    if (parent !== undefined && !this.nodes[parent]) throw new Error('Unknown dependency parent');
    // Parentage is supplied by runtime readers as well as grammar expansion.
    // Bound every admission before charging bytes or yielding to metadata.
    const depth = parent === undefined ? 0 : (this.lineage.get(parent)?.length ?? 0) + 1;
    if (depth > this.options.budgets.depth) {
      this.issue(parent, 'budget', 'Reference admission exceeded depth budget');
      throw new DiscoveryBudgetError();
    }
    // An explicit policy replaces parent/invocation restrictions. Parentage
    // does not imply a path base. Policy is retained on every occurrence,
    // including wrappers/manifests; charge UTF-8 bytes before advisory work.
    const policy = reference.policy ?? (parent === undefined ? undefined : this.nodes[parent].policy) ?? this.options.policy;
    let metadataBytes = 0;
    const encoder = new TextEncoder();
    for (const value of [reference.source, reference.filterReader?.filter, reference.filterReader?.name,
      reference.optionReader?.name, ...(policy?.allow ?? []), ...(policy?.deny ?? [])]) {
      if (value !== undefined) metadataBytes += encoder.encode(value).length;
    }
    const referenceBytes = reference.value.length + (reference.path?.length ?? 0)
      + (reference.base?.value.length ?? this.options.cwd.length)
      + (reference.optionReader?.specifier?.length ?? 0) + metadataBytes;
    if (this.nodes.length >= this.options.budgets.nodes || this.bytes + referenceBytes > this.options.budgets.bytes) {
      this.issue(parent, 'budget', 'Reference admission exceeded nodes/bytes budget');
      throw new DiscoveryBudgetError();
    }
    this.bytes += referenceBytes;
    // Capture all reader metadata before yielding to advisory traversal. Buffer
    // slice() aliases producer memory, and readonly types do not own policy lists.
    reference = structuredClone(reference);
    const base = reference.base ?? { kind: 'directory' as const, value: this.options.cwd };
    // The invocation frontend interprets '-' as stdin. Manifest readers first
    // join that relative spelling against their resource, just like other names.
    // An explicit URL directory base has the same member semantics.
    // Protocol wrappers likewise open native URL operands, not CLI stdin aliases.
    const baseProtocol = protocol(byteText(base.value));
    const readerDash = (base.kind === 'resource' || baseProtocol !== undefined && baseProtocol !== 'file')
      && byteText(reference.value) === '-';
    const originalKind = readerDash ? 'path' : classify(reference.value);
    let kind = reference.kind ?? (reference.literal ? 'path' : originalKind);
    // A discovery path hint cannot replace an actual native network/descriptor
    // operand. Literal filesystem readers retain their native interpretation.
    const operand = !reference.literal && (originalKind === 'url' || originalKind === 'descriptor')
      ? reference.value : reference.path ?? reference.value;
    const operandKind = readerDash && byteText(operand) === '-' ? 'path' : classify(operand);
    const literal = reference.literal === true;
    if (!literal && ['path','file-protocol','url','image-selector','glob','output-pattern','filename-expression'].includes(kind)
      && (operandKind === 'url' || operandKind === 'descriptor')) kind = operandKind;
    let location: Uint8Array | undefined;
    let readerLocation: Uint8Array | undefined;
    let trace: AccessNode['trace'] = [];
    let expression: AccessNode['expression'];
    const id = this.nodes.length;
    if (['path','file-protocol','url','image-selector','glob','output-pattern','filename-expression'].includes(kind)) {
      location = resolveLocation(operand, base, literal);
      // Manifest members join against this operand, never the advisory target.
      readerLocation = location.slice();
      const scheme = protocol(byteText(location));
      if (scheme !== undefined && scheme !== 'file') kind = 'url';
      else if (!reference.kind && scheme && kind === 'path') kind = 'file-protocol';
      if (reference.filenameDialect === 'dash' || reference.filenameDialect === 'dash-resource') {
        // Native DASH substitutes after URL joining. Templates can be inherited
        // from a BaseURL even when the member itself has a fixed spelling.
        expression = parseFilenameExpression(location, reference.filenameDialect);
        if (expression.tokens.some(token => token.kind === 'template') && (kind === 'path' || kind === 'file-protocol')) kind = 'filename-expression';
      }
      const policyScheme = scheme ?? 'file';
      const denied = policy?.deny?.includes(policyScheme) || policy?.allow && !policy.allow.includes(policyScheme);
      if (denied) {
        this.issue(id, 'policy', 'Protocol requires native policy decision; no prefetch authorized');
      }
      if (!denied && (kind === 'path' || kind === 'file-protocol' || kind === 'image-selector')) {
        let local = location;
        // file.c strips exactly one file: prefix, then opens a literal POSIX
        // filename. Its suffix must not re-enter AVIO protocol selection.
        if (scheme === 'file') local = resolveLocation(textBytes(byteText(location).slice(5)), { kind: 'directory', value: this.options.cwd }, true);
        // URL reference syntax can return a bare operand whose prefix is not
        // an AVIO protocol. file.c opens it relative to native cwd, even when
        // the referring playlist was on the network.
        else if (!scheme) local = resolveLocation(location, { kind: 'directory', value: this.options.cwd }, true);
        if (!scheme || scheme === 'file') {
          const result = await traceLocal(local, this.options, this.options.budgets.bytes - this.bytes);
          this.bytes += result.bytes;
          // file: retains its protocol identity, while path traversal records local components.
          location = scheme === 'file' ? textBytes('file:' + byteText(result.location)) : result.location;
          trace = result.trace;
          if (result.issue) this.issue(id, result.issue, 'Canonical path traversal remains unresolved');
        }
      }
    }
    if (kind === 'descriptor' && !literal) {
      const scheme = protocol(byteText(operand));
      if (scheme && (policy?.deny?.includes(scheme) || policy?.allow && !policy.allow.includes(scheme))) {
        this.issue(id, 'policy', 'Descriptor protocol requires native policy decision; no prefetch authorized');
      }
    }
    expression ??= reference.filenameDialect ? parseFilenameExpression(reference.path ?? reference.value, reference.filenameDialect, reference.access !== 'read') : undefined;
    if (expression && !expression.complete) this.issue(id, 'syntax', 'Filename expression requires native validation');
    const node: AccessNode = {
      ...reference, value: reference.value.slice(), path: reference.path?.slice(), id, parent,
      original: reference.value.slice(), expression, kind, base: { ...base, value: base.value.slice() }, readerLocation, location, trace,
      live: true, upload: false, timing: { order: id, stage: reference.stage ?? 'runtime', certainty: 'predicted' },
      policy,
    };
    this.nodes.push(node);
    if (parent !== undefined) {
      const capture = this.captures.get(parent) ?? this.nodes[parent];
      this.lineage.set(id, [...(this.lineage.get(parent) ?? []), { location: capture.location?.slice(), grammar: capture.grammar,
        canonical: 'canonical' in capture ? capture.canonical : undefined,
        reader: 'reader' in capture ? capture.reader : undefined }]);
    }
    if (parent !== undefined) this.edges.push({ from: parent, to: id, kind: 'depends-on' });
    // Connect advisory admission order across captures and nested expansions,
    // including a later output alias. Parentage alone carries no timing. These
    // edges never establish observed native order; observe removes its incoming
    // prediction and records the independent runtime sequence instead.
    const previous = this.nodes.slice(0, -1).reverse().find(n => n.timing.certainty === 'predicted');
    if (previous && previous.id !== parent) this.edges.push({ from: previous.id, to: id, kind: 'before' });
    if (kind === 'url') {
      // Manifest joining can select a wrapper absent from the original member.
      // Expand the operand actually passed to AVIO, retaining original bytes on
      // the parent occurrence and each stripped reader operand on its child.
      const name = byteText(location ?? operand), scheme = protocol(name);
      const wrapper = scheme && ['cache','async','crypto','concatf','subfile'].includes(scheme);
      let subfile: string | undefined;
      if (scheme === 'subfile') {
        try { subfile = subfileOperand(name); }
        catch (error) {
          this.issue(id, 'syntax', error instanceof Error ? error.message : 'Unresolved subfile option grammar');
          return structuredClone(node);
        }
        this.issue(id, 'live', 'Subfile offset expressions, seeking and protocol accessibility remain native decisions');
      }
      const children = scheme === 'concat' ? concatProtocolMembers(name.slice(7))
        : scheme === 'subfile' ? [subfile!]
        : wrapper ? [name.slice(scheme.length + 1)] : [];
      if ((scheme === 'concat' && name.length > 7 || wrapper) && depth >= this.options.budgets.depth) this.issue(id, 'budget', 'Protocol nesting exceeds depth budget');
      else {
        let previous: AccessNode | undefined;
        for (const child of children) {
          try {
            // URLProtocol readers open the stripped operand directly. A relative
            // member does not inherit the playlist that named this wrapper.
            const member = await this.admit({ value: textBytes(child), access: scheme === 'concatf' ? 'read' : reference.access,
              literal: child === '-',
              grammar: scheme === 'concatf' ? 'concatf' : undefined,
              base: { kind: 'directory', value: this.options.cwd }, policy: node.policy, stage: reference.stage }, id);
            if (previous && previous.id !== member.id - 1) this.edges.push({ from: previous.id, to: member.id, kind: 'before' });
            previous = member;
          }
          catch (error) { if (error instanceof DiscoveryBudgetError) break; throw error; }
        }
      }
    }
    return structuredClone(node);
  }
  content(id: number, observation: { readonly content: Uint8Array; readonly location?: Uint8Array; readonly grammar?: DependencyGrammar }): Promise<AccessNode[]> {
    // An impossible capture needs no byte ownership: retain only its grammar,
    // and publish the refusal in submission order. Never clone a large producer
    // allocation merely to discover that it exceeds the entire capture budget.
    if (observation.content.byteLength + (observation.location?.byteLength ?? 0) > this.options.budgets.bytes) {
      const grammar = observation.grammar;
      return this.schedule(async () => {
        const node = this.nodes[id];
        if (!node) throw new Error('Unknown dependency node');
        if (!(grammar ?? node.grammar)) this.issue(id, 'unresolved', 'Content grammar must come from the selected native reader');
        else this.issue(id, 'budget', 'Content/location exceeds byte budget');
        return [];
      });
    }
    observation = structuredClone(observation);
    return this.schedule(() => this.expandContent(id, observation));
  }
  private async expandContent(id: number, observation: { readonly content: Uint8Array; readonly location?: Uint8Array; readonly grammar?: DependencyGrammar }): Promise<AccessNode[]> {
    const node = this.nodes[id];
    if (!node) throw new Error('Unknown dependency node');
    const grammar = observation.grammar ?? node.grammar;
    if (!grammar) { this.issue(id, 'unresolved', 'Content grammar must come from the selected native reader'); return []; }
    const readerLocation = node.readerLocation ?? node.location;
    const observationBytes = observation.content.length + (observation.location?.length ?? readerLocation?.length ?? 0);
    if (this.bytes + observationBytes > this.options.budgets.bytes) { this.issue(id, 'budget', 'Content/location exceeds byte budget'); return []; }
    this.bytes += observationBytes;
    // Observation buffers can be reused by the runtime bridge as soon as this
    // call yields. Own the capture before any asynchronous grammar evaluation.
    const content = Uint8Array.from(observation.content);
    const location = observation.location ? Uint8Array.from(observation.location) : readerLocation;
    if (!location) { this.issue(id, 'unresolved', 'No effective content location'); return []; }
    const lineage = this.lineage.get(id) ?? [];
    // Canonical traversal is a second advisory cycle key, never the manifest's
    // resolution base. Redirected captures and failed metadata cannot inherit it.
    const canonicalLocation = !observation.location && node.location && node.trace.length
      && !this.issues.some(issue => issue.node === id && issue.reason !== 'live')
      ? byteText(node.location) : undefined;
    // file.c removes exactly one prefix and opens the suffix against cwd.
    // This identity is known without metadata: comparing it does not simplify
    // '..', follow links, decode URL escapes or change the content reader base.
    // Interior dot/repeated separators are equivalent for local cycle identity
    // only; retained operands still carry their exact original spelling.
    // Effective redirected captures must use their own spelling, never a stale
    // canonical target from the original node.
    const spelling = byteText(location);
    const scheme = protocol(spelling);
    const localReader = node.readerLocation && (scheme === 'file' || scheme === undefined && spelling.startsWith('/'))
      ? localReaderIdentity(scheme === 'file'
        ? byteText(resolveLocation(textBytes(spelling.slice(5)), { kind: 'directory', value: this.options.cwd }, true))
        : spelling)
      : undefined;
    const canonical = canonicalLocation?.startsWith('file:') ? canonicalLocation.slice(5) : canonicalLocation;
    const depth = lineage.length;
    if (depth >= this.options.budgets.depth) { this.issue(id, 'budget', 'Content exceeds nesting budget'); return []; }
    for (const ancestor of lineage) {
      if (ancestor.grammar === grammar && (ancestor.location && byteText(ancestor.location) === byteText(location)
        || localReader !== undefined && ancestor.reader === localReader
        || canonical !== undefined && ancestor.canonical === canonical)) {
        this.issue(id, 'cycle', 'Ancestor content references itself; subsequent runtime access remains live');
        // A native observation has already happened. A revisit may be a reload
        // with new bytes, rather than recursive static expansion. Preserve its
        // content while retaining the cycle warning and all admission budgets.
        if (node.timing.certainty !== 'observed') return [];
        break;
      }
    }
    this.captures.set(id, { location: location.slice(), grammar, canonical, reader: localReader });
    const parsed = await parseDependencyContent(grammar, content, location, this.options.cwd, { nodes: this.options.budgets.nodes - this.nodes.length, depth: this.options.budgets.depth - depth }, node.optionReader, node.filterReader, { ...this.options, policy: node.policy });
    for (const issue of parsed.diagnostics ?? []) this.issue(id, issue.reason, issue.detail);
    for (const issue of parsed.issues) this.issue(id, parsed.budget ? 'budget' : parsed.incomplete ? 'syntax' : 'live', issue);
    const result: AccessNode[] = [];
    for (const reference of parsed.references) {
      try {
        const child = await this.admit({ ...reference, policy: reference.policy ?? node.policy, stage: 'runtime' }, id);
        if (result.length && result.at(-1)!.id !== child.id - 1) this.edges.push({ from: result.at(-1)!.id, to: child.id, kind: 'before' });
        result.push(child);
      } catch (error) { if (error instanceof DiscoveryBudgetError) break; throw error; }
    }
    return result;
  }
  /** A parent records the reader that caused this access, not an implicit base.
   * The runtime bridge supplies each reader's actual resolution base explicitly. */
  observe(reference: AccessReference & { readonly sequence: number }, parent?: number): Promise<AccessNode> {
    reference = structuredClone(reference);
    return this.schedule(async () => {
      if (!Number.isSafeInteger(reference.sequence) || reference.sequence < 0 || this.lastObserved && reference.sequence <= this.lastObserved.timing.sequence!) throw new Error('Runtime access sequence must increase');
      const node = await this.admit(reference, parent);
      const observed: AccessNode = { ...node, timing: { ...node.timing, certainty: 'observed', sequence: reference.sequence } };
      this.nodes[node.id] = observed;
      // Predicted order is not evidence of native timing.
      for (let i = this.edges.length - 1; i >= 0; i--) if (this.edges[i].kind === 'before' && this.edges[i].to === node.id) this.edges.splice(i, 1);
      if (this.lastObserved) this.edges.push({ from: this.lastObserved.id, to: node.id, kind: 'observed-before' });
      this.lastObserved = observed;
      return structuredClone(observed);
    });
  }
  graph(): AccessGraph {
    return structuredClone({ nodes: this.nodes, edges: this.edges, issues: this.issues, status: this.incomplete ? 'incomplete' : 'live' });
  }
}

/** Adapt frontend grammar hints, preserving original argv and access occurrences.
 * These are predicted evaluation stages, not a claim about observed native opens. */
export async function createDependencyResolver(discovery: Discovery | ImageMagickDiscovery, options: ResolutionOptions): Promise<DependencyResolver> {
  // Admission owns the whole invocation, not just whichever occurrence is
  // currently awaiting metadata. Producers may reuse later operand buffers,
  // policies and inline content while the first advisory traversal is pending.
  discovery = structuredClone(discovery);
  options = { ...options, cwd: new Uint8Array(options.cwd), budgets: { ...options.budgets },
    policy: options.policy && structuredClone(options.policy) };
  const resolver = new DependencyResolver(options, frontendIssues(discovery.deferred));
  const references: AccessReference[] = [];
  const inline = new Map<AccessReference, Uint8Array>();
  if ('dependencies' in discovery) {
    // ffprobe parses options sequentially, then initializes its output writer
    // before probe_file opens the input. FFmpeg opens grouped inputs first.
    // These stages predict reader evaluation, never authorize early effects.
    const rank = discovery.tool === 'ffprobe'
      ? { global: 0, output: 1, input: 2, runtime: 3 }
      : { global: 0, input: 1, output: 2, runtime: 3 };
    const lavfiGroups = discovery.groups.filter(group => {
      const format = [...discovery.globals, ...group.options].reverse().find(option => option.name === 'f');
      return group.kind === 'input' && group.target && format?.value && !format.fromFile && byteText(format.value) === 'lavfi';
    });
    const lavfiIndices = new Set(lavfiGroups.map(group => group.index));
    const dependencies = [...discovery.dependencies].sort((a, b) => rank[a.stage] - rank[b.stage] || a.index - b.index);
    for (const d of dependencies) {
      // Expand inline source grammar under its reader, rather than admitting
      // the frontend's flattened hints as unrelated root accesses.
      if (d.role === 'filter-resource' && lavfiIndices.has(d.index)) continue;
      const group = discovery.groups.find(g => g.index === d.index || g.options.some(o => o.index === d.index));
      const applied = [...discovery.globals, ...(group?.options ?? [])];
      const option = applied.find(o => o.index === d.index);
      const policyList = (name: string) => { const value = [...applied].reverse().find(o => o.name === name && !o.fromFile)?.value; return value && byteText(value).split(','); };
      const allow = policyList('protocol_whitelist'), deny = policyList('protocol_blacklist');
      const policy = allow || deny ? { allow, deny } : options.policy;
      const format = [...discovery.globals, ...(group?.options ?? [])].reverse().find(o => o.name === 'f');
      const name = format?.value && !format.fromFile && byteText(format.value);
      const inputGrammars = { concat: 'concat', hls: 'hls', dash: 'dash' } as const;
      const inputGrammar = name && Object.hasOwn(inputGrammars, name) ? inputGrammars[name as keyof typeof inputGrammars] : undefined;
      const grammar: DependencyGrammar | undefined = d.filterReader ? 'filter-option' : d.role === 'option-file' ? !d.optionReader?.discardValue && option && filterOptions.includes(option.name) ? 'filter' : 'option-file' : (d.optionReader?.name ?? option?.name) === 'hls_key_info_file' ? 'hls-key-info' : d.role === 'preset' ? 'preset' : d.role === 'filter-script' ? 'filter' : d.role === 'input' ? inputGrammar : undefined;
      const patternType = [...applied].reverse().find(o => o.name === 'pattern_type');
      const pattern = patternType?.value && !patternType.fromFile ? byteText(patternType.value) : undefined;
      // img2enc.c expands s->url before io_open selects an AVIO protocol.
      // Output counters/clocks therefore also apply to file: and network URLs.
      // img2dec.c likewise expands sequences before AVIO checks/opens, but
      // glob() consumes the literal URL in the local filesystem namespace.
      const image2 = name === 'image2' && (d.role === 'output' || d.role === 'input' && (pattern !== 'glob' || classify(d.value) === 'path'));
      // img2enc.c write_packet: update wins over clock expansion, then PTS or
      // frame numbering. Only predict canonical switch values; native owns
      // boolean aliases, malformed values and option-file interpretation.
      const filenameSwitch = (name: string) => {
        const option = [...applied].reverse().find(option => option.name === name);
        if (!option) return '0';
        const value = !option.fromFile && option.value && byteText(option.value);
        return value === '0' || value === '1' ? value : undefined;
      };
      const update = image2 && d.role === 'output' ? filenameSwitch('update') : '0';
      const strftime = image2 && d.role === 'output' ? filenameSwitch('strftime') : '0';
      // Signed URL escapes can make the native frame pattern invalid. Input
      // header probing then falls back to the untouched URL; do not decode its
      // escapes or turn that native fallback into a predictive syntax failure.
      const counterPattern = byteText(d.value).includes('%') && (classify(d.value) !== 'url' || parseFilenameExpression(d.value, 'sequence', d.role === 'output').complete);
      const kind = d.kind === 'resource-lookup' ? d.kind : d.literal ? 'path' : image2 && d.role === 'input' && pattern === 'glob' ? 'glob'
        : image2 && d.role === 'output' && update === '1' ? 'path'
        : image2 && d.role === 'output' && (update === undefined || strftime !== '0') ? 'resource-lookup'
        : image2 && pattern !== 'none' && counterPattern ? d.access === 'write' ? 'output-pattern' : 'filename-expression'
        : undefined;
      references.push({ value: d.value, access: d.access, kind, literal: d.literal, grammar, optionReader: d.optionReader, filterReader: d.filterReader, policy, filenameDialect: kind === 'filename-expression' || kind === 'output-pattern' ? 'sequence' : undefined, index: d.index, stage: d.stage,
        base: d.base === 'cwd' ? undefined : { kind: 'resource', value: d.base.resource } });
    }
    for (const group of discovery.groups) {
      if (group.kind === 'trailing') continue;
      for (const option of group.options) if (['pre','apre','vpre','spre'].includes(option.name) && option.value && !option.fromFile) {
        references.push({ value: option.value, kind: 'resource-lookup', access: 'read', stage: group.kind === 'input' ? 'input' : 'output', index: option.index });
      }
      if (lavfiIndices.has(group.index) && group.target) {
        const applied = [...discovery.globals, ...group.options];
        const policyList = (name: string) => { const value = [...applied].reverse().find(option => option.name === name && !option.fromFile)?.value; return value && byteText(value).split(','); };
        const allow = policyList('protocol_whitelist'), deny = policyList('protocol_blacklist');
        const reference: AccessReference = { value: group.target, kind: 'synthetic', access: 'read', stage: 'input', index: group.index, grammar: 'filter',
          policy: allow || deny ? { allow, deny } : options.policy };
        references.push(reference);
        inline.set(reference, group.target);
      }
    }
    references.sort((a, b) => rank[a.stage as keyof typeof rank] - rank[b.stage as keyof typeof rank] || (a.index ?? 0) - (b.index ?? 0));
  } else {
    const parsed = imageMagickAccessReferences(discovery);
    references.push(...parsed.references);
    for (const [reference, content] of parsed.inline) inline.set(reference, content);
  }
  for (const reference of references) {
    try {
      const node = await resolver.add(reference);
      const content = inline.get(reference);
      if (content) await resolver.content(node.id, { content, location: options.cwd });
    }
    catch (error) { if (error instanceof DiscoveryBudgetError) break; throw error; }
  }
  return resolver;
}

export async function resolveDependencies(discovery: Discovery | ImageMagickDiscovery, options: ResolutionOptions): Promise<AccessGraph> {
  const resolver = await createDependencyResolver(discovery, options);
  return resolver.graph();
}
