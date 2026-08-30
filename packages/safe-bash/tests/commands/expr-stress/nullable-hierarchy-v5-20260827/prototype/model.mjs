import { HistoryModel as InheritedModel, Refusal } from './inherited-model.mjs';
export { Meter, Refusal, checkSpan, sameContinuationState } from './inherited-model.mjs';

function bounded(options) {
  if ((options.work ?? 1000000) > 1000000 || (options.allocation ?? 1000000) > 1000000 || (options.meter?.workLimit ?? 0) > 1000000 || (options.meter?.allocationLimit ?? 0) > 1000000) throw new Refusal('CAP');
  return options;
}

export class HistoryModel extends InheritedModel {
  constructor(spec, subject, options = {}) {
    super(spec, subject, bounded(options));
    this.meter.charge(64, 64);
    this.raw = this.meter.array(64);
    this.columns = this.meter.array(64);
    this.aliases = this.meter.array(64);
    this.prepared = this.meter.array(this.maxCandidates);
    this.rawCount = 0;
    this.columnCount = 0;
    this.aliasCount = 0;
    this.describe(this.ast, null, 0, 0);
  }

  describe(node, parent, slot, depth) {
    this.meter.charge(24, 4);
    if (depth > this.maxDepth) throw new Refusal('DEPTH');
    this.raw[this.rawCount++] = node;
    if (node.kind === 'group') {
      const semantic = this.unwrapped(node);
      this.aliases[this.aliasCount++] = this.meter.record(() => ({ raw: node.id, semantic: semantic.id }));
      this.describe(node.children[0], parent, slot, depth + 1);
    } else {
      this.columns[this.columnCount++] = this.meter.record(() => ({ node, parent, slot }));
      for (let index = 0; index < node.children.length; index++) {
        this.meter.charge();
        this.describe(node.children[index], node, index, depth + 1);
      }
    }
  }

  unwrapped(node) {
    this.meter.charge(8, 4);
    while (node.kind === 'group') {
      this.meter.charge(8);
      node = node.children[0];
    }
    return node;
  }

  normalized(occurrence, depth = 0) {
    this.meter.charge(24, 8);
    while (occurrence.node.kind === 'group') {
      this.meter.charge(8);
      occurrence = occurrence.children[0];
      depth++;
    }
    if (depth > this.maxDepth) throw new Refusal('DEPTH');
    const children = this.meter.array(occurrence.children.length);
    for (let index = 0; index < children.length; index++) {
      this.meter.charge();
      children[index] = this.normalized(occurrence.children[index], depth + 1);
    }
    return this.meter.record(() => ({ node: occurrence.node, start: occurrence.start, end: occurrence.end, children: Object.freeze(children) }));
  }

  visitParents(tree, parent, action, depth = 0) {
    this.meter.charge(16, 4);
    if (depth > this.maxDepth) throw new Refusal('DEPTH');
    if (tree.node === parent) action(tree);
    for (let index = 0; index < tree.children.length; index++) {
      this.meter.charge();
      this.visitParents(tree.children[index], parent, action, depth + 1);
    }
  }

  tables(tree) {
    this.meter.charge(32, 32);
    const tables = this.meter.array(this.columnCount);
    for (let index = 0; index < this.columnCount; index++) {
      this.meter.charge(32, 32);
      const column = this.columns[index];
      let count = column.parent === null ? 1 : 0;
      if (column.parent !== null) this.visitParents(tree, column.parent, () => { this.meter.charge(); count++; });
      const contexts = this.meter.array(count);
      let cursor = 0;
      const append = parent => {
        this.meter.charge(16, 8);
        let occurrences;
        if (parent?.node.kind === 'repeat') occurrences = parent.children;
        else {
          occurrences = this.meter.array(1);
          occurrences[0] = parent === null ? tree : parent.children[column.slot];
          Object.freeze(occurrences);
        }
        contexts[cursor++] = this.meter.record(() => ({ parent, occurrences }));
      };
      if (column.parent === null) append(null);
      else this.visitParents(tree, column.parent, append);
      if (cursor !== count) throw new Refusal('CONTEXT');
      tables[index] = Object.freeze(contexts);
    }
    return Object.freeze(tables);
  }

  trace(history) {
    this.meter.charge(32, 32);
    const names = this.meter.array(this.maxEvents);
    for (let index = 0; index < names.length; index++) { this.meter.charge(); names[index] = -1; }
    let next = 0;
    for (let index = 0; index < history.events.length; index++) {
      this.meter.charge(8);
      const event = history.events[index];
      if (event.type === 'enter') {
        if (!Number.isSafeInteger(event.activation) || event.activation < 0 || event.activation >= names.length || names[event.activation] !== -1) throw new Refusal('PROVENANCE');
        names[event.activation] = next++;
      }
    }
    const name = activation => {
      this.meter.charge(8);
      if (activation === null || activation === undefined) return null;
      if (!Number.isSafeInteger(activation) || activation < 0 || activation >= names.length || names[activation] < 0) throw new Refusal('PROVENANCE');
      return names[activation];
    };
    const trace = this.meter.array(history.events.length);
    for (let index = 0; index < trace.length; index++) {
      this.meter.charge(16);
      const event = history.events[index];
      const env = this.meter.array(event.env.length);
      for (let group = 0; group < env.length; group++) {
        this.meter.charge(8);
        const capture = event.env[group];
        const origin = name(capture.activation);
        env[group] = this.meter.record(() => ({ state: capture.state, start: capture.start, end: capture.end, origin }));
      }
      const activation = name(event.activation);
      const parent = name(event.parent);
      trace[index] = this.meter.record(() => ({ type: event.type, node: event.node, ordinal: event.ordinal, start: event.start, end: event.end, activation, parent, env: Object.freeze(env) }));
    }
    return Object.freeze(trace);
  }

  build(plan, eligibility) {
    this.meter.charge(32, 16);
    if (eligibility !== 'FINITE-PERMISSIVE' && eligibility !== 'LOCAL-TAIL-HYPOTHESIS') throw new Refusal('ELIGIBILITY');
    const previous = this.builtCount;
    const history = super.build(plan, eligibility === 'LOCAL-TAIL-HYPOTHESIS');
    try {
      const tree = this.normalized(history.tree);
      const tables = this.tables(tree);
      const trace = this.trace(history);
      this.prepared[previous] = this.meter.record(() => ({ tree, tables, trace }));
      this.meter.charge();
      return history;
    } catch (error) {
      this.built[previous] = undefined;
      this.prepared[previous] = undefined;
      this.builtCount = previous;
      throw error;
    }
  }

  owned(history) {
    for (let index = 0; index < this.builtCount; index++) {
      this.meter.charge(4);
      if (this.built[index] === history && this.prepared[index]) return this.prepared[index];
    }
    throw new Refusal('UNVALIDATED');
  }

  policy(policy) {
    this.meter.charge(8);
    if (policy !== 'HNODE-AGG-v5' && policy !== 'HTREE-AGG-v5') throw new Refusal('POLICY');
  }

  extent(first, second) {
    this.meter.charge(8);
    if (first.node !== second.node) throw new Refusal('AST_ID');
    return first.start - second.start || second.end - first.end;
  }

  list(first, second, recursive, depth) {
    this.meter.charge(16, 4);
    if (depth > this.maxDepth) throw new Refusal('DEPTH');
    if (first.length === 0 || second.length === 0) return second.length === 0 ? (first.length === 0 ? 0 : -1) : 1;
    const shared = Math.min(first.length, second.length);
    for (let index = 0; index < shared; index++) {
      this.meter.charge(8);
      const order = recursive ? this.treeOrder(first[index], second[index], depth) : this.extent(first[index], second[index]);
      if (order) return order;
    }
    return first.length - second.length;
  }

  treeOrder(first, second, depth = 0) {
    this.meter.charge(16, 4);
    if (depth > this.maxDepth) throw new Refusal('DEPTH');
    const order = this.extent(first, second);
    if (order || (first.children.length === 0 && second.children.length === 0)) return order;
    return this.list(first.children, second.children, true, depth + 1);
  }

  nodeOrder(first, second) {
    this.meter.charge(16, 4);
    for (let column = 0; column < this.columnCount; column++) {
      this.meter.charge(8);
      const left = first.tables[column];
      const right = second.tables[column];
      if (left.length !== right.length) throw new Refusal('CONTEXT_ALIGNMENT');
      for (let context = 0; context < left.length; context++) {
        this.meter.charge(8);
        const order = this.list(left[context].occurrences, right[context].occurrences, false, 0);
        if (order) return order;
      }
    }
    return 0;
  }

  neutralTie(first, second) {
    this.meter.charge(16, 4);
    if (first.trace.length !== second.trace.length) throw new Refusal('UNRESOLVED_TIE');
    for (let index = 0; index < first.trace.length; index++) {
      const left = first.trace[index];
      const right = second.trace[index];
      this.meter.charge(32 + left.node.length + right.node.length);
      if (left.type !== right.type || left.node !== right.node || left.ordinal !== right.ordinal || left.start !== right.start || left.end !== right.end || left.activation !== right.activation || left.parent !== right.parent || left.env.length !== right.env.length) throw new Refusal('UNRESOLVED_TIE');
      for (let group = 0; group < left.env.length; group++) {
        this.meter.charge(16);
        const firstCapture = left.env[group];
        const secondCapture = right.env[group];
        if (firstCapture.state !== secondCapture.state || firstCapture.start !== secondCapture.start || firstCapture.end !== secondCapture.end || firstCapture.origin !== secondCapture.origin) throw new Refusal('UNRESOLVED_TIE');
      }
    }
    return 0;
  }

  compare(left, right, policy) {
    this.meter.charge(16, 4);
    this.policy(policy);
    const first = this.owned(left);
    const second = this.owned(right);
    const whole = this.extent(first.tree, second.tree);
    if (whole) return whole;
    const order = policy === 'HNODE-AGG-v5' ? this.nodeOrder(first, second) : this.treeOrder(first.tree, second.tree);
    return order || this.neutralTie(first, second);
  }

  rank(histories, policy) {
    this.meter.charge(16, 4);
    this.policy(policy);
    return super.rank(histories, policy);
  }

  rawNode(id) {
    for (let index = 0; index < this.rawCount; index++) {
      this.meter.charge(id.length + 4);
      if (this.raw[index].id === id) return this.raw[index];
    }
    throw new Refusal('AST_ID');
  }

  validateFrozen(history, expected) {
    this.meter.charge(32, 32);
    this.owned(history);
    if (history.tree.start !== expected.whole[0] || history.tree.end !== expected.whole[1]) throw new Refusal('EXPECTED');
    const counts = this.meter.array(this.groups + 1);
    const live = this.meter.array(this.groups + 1);
    for (let group = 0; group <= this.groups; group++) {
      this.meter.charge(4);
      counts[group] = 0;
      live[group] = this.meter.record(() => ({ state: 'absent' }));
    }
    let references = 0;
    for (let index = 0; index < history.events.length; index++) {
      this.meter.charge(16);
      const event = history.events[index];
      const node = this.rawNode(event.node);
      if (node.kind === 'group' && event.type === 'enter') live[node.group] = this.meter.record(() => ({ state: 'open', start: event.start, activation: event.activation }));
      if (node.kind === 'group' && event.type === 'exit') {
        const span = expected.captureCompletions[node.group]?.[counts[node.group]++];
        if (!span || span[0] !== event.start || span[1] !== event.end) throw new Refusal('EXPECTED_CAPTURE');
        live[node.group] = this.meter.record(() => ({ state: event.start === event.end ? 'completed-empty' : 'completed-nonempty', start: event.start, end: event.end, activation: event.activation }));
      }
      for (let group = 0; group <= this.groups; group++) {
        this.meter.charge(16);
        const actual = event.env[group];
        const wanted = live[group];
        if (actual.state !== wanted.state || actual.start !== wanted.start || actual.end !== wanted.end || actual.activation !== wanted.activation) throw new Refusal('EXPECTED_ENV');
      }
      if (node.kind === 'ref' && event.type === 'exit') {
        const reference = expected.refs[references++];
        if (!reference || reference.group !== node.group || reference.completion !== counts[node.group] - 1 || reference.span[0] !== event.start || reference.span[1] !== event.end) throw new Refusal('EXPECTED_REFERENCE');
      }
    }
    for (let group = 1; group <= this.groups; group++) {
      this.meter.charge(8);
      if (counts[group] !== expected.captureCompletions[group]?.length) throw new Refusal('EXPECTED_CAPTURE');
      if (history.env[group] !== history.events[history.events.length - 1].env[group]) throw new Refusal('EXPECTED_ENV');
    }
    if (references !== expected.refs.length) throw new Refusal('EXPECTED_REFERENCE');
    return true;
  }
}
