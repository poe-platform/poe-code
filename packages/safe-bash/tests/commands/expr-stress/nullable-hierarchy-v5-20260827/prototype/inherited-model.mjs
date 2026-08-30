export class Refusal extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export class Meter {
  constructor(options = {}) {
    this.work = 0;
    this.allocation = 0;
    this.workLimit = options.work ?? 1000000;
    this.allocationLimit = options.allocation ?? 1000000;
    this.signal = options.signal;
    if (!Number.isSafeInteger(this.workLimit) || this.workLimit < 0 || !Number.isSafeInteger(this.allocationLimit) || this.allocationLimit < 0) throw new Refusal('CAP');
    this.charge(128, 128);
  }

  charge(work = 1, allocation = 0) {
    if (this.signal?.aborted) throw this.signal.reason;
    if (!Number.isSafeInteger(work) || work < 0 || !Number.isSafeInteger(allocation) || allocation < 0) throw new Refusal('METER');
    if (work > this.workLimit - this.work || allocation > this.allocationLimit - this.allocation) throw new Refusal('LIMIT');
    this.work += work;
    this.allocation += allocation;
  }

  array(length) {
    this.charge(length + 1, length + 4);
    return new Array(length);
  }

  record(factory, slots = 16) {
    this.charge(slots, slots);
    return Object.freeze(factory());
  }
}

export function checkSpan(meter, start, end, size) {
  meter.charge(8);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || end > size) throw new Refusal('SPAN');
}

export class HistoryModel {
  constructor(spec, subject, options = {}) {
    this.meter = options.meter ?? new Meter(options);
    this.meter.charge(32, 32);
    this.maxDepth = options.depth ?? 24;
    this.maxEvents = options.events ?? 2048;
    this.maxCandidates = options.candidates ?? 32;
    if (!Number.isSafeInteger(this.maxDepth) || this.maxDepth < 0 || this.maxDepth > 24 || !Number.isSafeInteger(this.maxEvents) || this.maxEvents < 0 || this.maxEvents > 2048 || !Number.isSafeInteger(this.maxCandidates) || this.maxCandidates < 0 || this.maxCandidates > 32) throw new Refusal('CAP');
    this.meter.charge(subject.length + 1, subject.length + 4);
    if (subject.length > 32) throw new Refusal('INPUT');
    for (let index = 0; index < subject.length; index++) if (subject.charCodeAt(index) > 127) throw new Refusal('ASCII');
    this.subject = subject;
    this.nodes = 0;
    this.groups = 0;
    this.ast = this.compile(spec, 'r', 0);
    this.built = this.meter.array(this.maxCandidates);
    this.builtCount = 0;
  }

  compile(spec, id, depth) {
    this.meter.charge(12);
    if (depth > this.maxDepth) throw new Refusal('DEPTH');
    if (++this.nodes > 64) throw new Refusal('NODES');
    if (!Array.isArray(spec)) throw new Refusal('AST');
    const kind = spec[0];
    let count = 0;
    if (kind === 'cat') count = spec.length - 1;
    else if (kind === 'repeat' || kind === 'group') count = 1;
    else if (kind !== 'byte' && kind !== 'ref') throw new Refusal('AST');
    if (count < 0 || count > 16) throw new Refusal('AST');
    const children = this.meter.array(count);
    for (let index = 0; index < count; index++) {
      this.meter.charge(id.length + 8, id.length + 8);
      children[index] = this.compile(spec[kind === 'cat' ? index + 1 : kind === 'repeat' ? 3 : 2], `${id}.${index}`, depth + 1);
    }
    let group = 0;
    if (kind === 'group' || kind === 'ref') {
      group = spec[1];
      if (!Number.isSafeInteger(group) || group < 1 || group > 16) throw new Refusal('AST');
      this.groups = Math.max(group, this.groups);
    }
    const minimum = kind === 'repeat' ? spec[1] : 0;
    const maximum = kind === 'repeat' ? spec[2] : 0;
    if (kind === 'repeat' && (!Number.isSafeInteger(minimum) || minimum < 0 || minimum > 32 || (maximum !== null && (!Number.isSafeInteger(maximum) || maximum < minimum || maximum > 32)))) throw new Refusal('AST');
    if (kind === 'byte' && (typeof spec[1] !== 'string' || spec[1].length !== 1 || spec[1].charCodeAt(0) > 127)) throw new Refusal('AST');
    return this.meter.record(() => ({ kind, id, children: Object.freeze(children), group, minimum, maximum, byte: kind === 'byte' ? spec[1] : undefined }));
  }

  build(plan, localTail = true) {
    this.meter.charge(16, 16);
    if (this.builtCount >= this.maxCandidates) throw new Refusal('CANDIDATES');
    const events = this.meter.array(this.maxEvents);
    let eventCount = 0;
    let position = 0;
    let nextActivation = 0;
    let env = this.meter.array(this.groups + 1);
    for (let group = 0; group <= this.groups; group++) {
      this.meter.charge();
      env[group] = this.meter.record(() => ({ state: 'absent' }));
    }
    Object.freeze(env);
    const update = (group, state, start, end, activation) => {
      const updated = this.meter.array(env.length);
      for (let index = 0; index < env.length; index++) {
        this.meter.charge();
        updated[index] = env[index];
      }
      updated[group] = this.meter.record(() => ({ state, start, end, activation }));
      env = Object.freeze(updated);
    };
    const event = (type, node, activation, parent, ordinal, start, end) => {
      this.meter.charge(8);
      if (eventCount >= this.maxEvents) throw new Refusal('EVENTS');
      events[eventCount++] = this.meter.record(() => ({ type, node: node.id, activation, parent, ordinal, start, end, env }));
    };
    const visit = (node, choice, parent, ordinal, depth) => {
      this.meter.charge(24, 8);
      if (depth > this.maxDepth) throw new Refusal('DEPTH');
      const activation = nextActivation++;
      const start = position;
      if (node.kind === 'group') update(node.group, 'open', start, undefined, activation);
      event('enter', node, activation, parent, ordinal, start, undefined);
      let children;
      if (node.kind === 'cat') {
        if (!Array.isArray(choice) || choice.length !== node.children.length) throw new Refusal('PLAN');
        children = this.meter.array(choice.length);
        for (let index = 0; index < choice.length; index++) children[index] = visit(node.children[index], choice[index], activation, null, depth + 1);
      } else if (node.kind === 'group') {
        children = this.meter.array(1);
        children[0] = visit(node.children[0], choice, activation, null, depth + 1);
        update(node.group, position === start ? 'completed-empty' : 'completed-nonempty', start, position, activation);
      } else if (node.kind === 'repeat') {
        const abbreviated = Number.isSafeInteger(choice) && node.children[0].kind === 'byte';
        if (!abbreviated && !Array.isArray(choice)) throw new Refusal('PLAN');
        const count = abbreviated ? choice : choice.length;
        if (count < node.minimum) throw new Refusal('MINIMUM');
        if (count < 0 || count > 32 || (node.maximum !== null && count > node.maximum)) throw new Refusal('MAXIMUM');
        children = this.meter.array(count);
        let progressed = false;
        let optionalEmpty = false;
        for (let index = 0; index < count; index++) {
          this.meter.charge(8);
          if (localTail && optionalEmpty) throw new Refusal('OPTIONAL_CYCLE');
          const before = position;
          children[index] = visit(node.children[0], abbreviated ? null : choice[index], activation, index, depth + 1);
          if (position === before && index >= node.minimum) {
            if (localTail && progressed) throw new Refusal('OPTIONAL_TAIL');
            optionalEmpty = true;
          }
          progressed ||= position > before;
        }
        event('skip', node.children[0], null, activation, count, position, position);
      } else {
        if (choice !== null) throw new Refusal('PLAN');
        children = this.meter.array(0);
        if (node.kind === 'byte') {
          this.meter.charge(4);
          if (this.subject[position] !== node.byte) throw new Refusal('BYTE');
          position++;
        } else {
          position = this.reference(env[node.group], position);
        }
      }
      checkSpan(this.meter, start, position, this.subject.length);
      event('exit', node, activation, parent, ordinal, start, position);
      return this.meter.record(() => ({ node, activation, parent, ordinal, start, end: position, children: Object.freeze(children) }));
    };
    const tree = visit(this.ast, plan, null, null, 0);
    const retained = this.meter.array(eventCount);
    for (let index = 0; index < eventCount; index++) {
      this.meter.charge();
      retained[index] = events[index];
    }
    const history = this.meter.record(() => ({ tree, env, events: Object.freeze(retained) }));
    this.built[this.builtCount++] = history;
    return history;
  }

  reference(capture, position) {
    this.meter.charge(12);
    if (!capture || (capture.state !== 'completed-empty' && capture.state !== 'completed-nonempty')) throw new Refusal('REFERENCE');
    checkSpan(this.meter, capture.start, capture.end, this.subject.length);
    checkSpan(this.meter, position, position + capture.end - capture.start, this.subject.length);
    for (let offset = 0; offset < capture.end - capture.start; offset++) {
      this.meter.charge(4);
      if (this.subject[position + offset] !== this.subject[capture.start + offset]) throw new Refusal('REFERENCE');
    }
    return position + capture.end - capture.start;
  }

  validateExpected(history, whole, captures) {
    this.meter.charge(12);
    checkSpan(this.meter, whole[0], whole[1], this.subject.length);
    if (whole[0] !== history.tree.start || whole[1] !== history.tree.end || captures.length !== this.groups) throw new Refusal('EXPECTED');
    for (let index = 0; index < captures.length; index++) {
      this.meter.charge(8);
      checkSpan(this.meter, captures[index][0], captures[index][1], this.subject.length);
      const capture = history.env[index + 1];
      if (capture.start !== captures[index][0] || capture.end !== captures[index][1]) throw new Refusal('EXPECTED');
    }
  }

  owned(history) {
    for (let index = 0; index < this.builtCount; index++) {
      this.meter.charge();
      if (this.built[index] === history) return;
    }
    throw new Refusal('UNVALIDATED');
  }

  compare(left, right, policy) {
    this.meter.charge(8);
    this.owned(left);
    this.owned(right);
    if (policy !== 'AGGREGATE-v1' && policy !== 'ITERATION-v1') throw new Refusal('POLICY');
    const whole = left.tree.start - right.tree.start || right.tree.end - left.tree.end;
    if (whole) return whole;
    const compareTree = (first, second, depth) => {
      this.meter.charge(16, 4);
      if (depth > this.maxDepth) throw new Refusal('DEPTH');
      if (first.node !== second.node) throw new Refusal('AST_ID');
      if (policy === 'AGGREGATE-v1' || first.node.kind !== 'repeat') {
        const extent = (second.end - second.start) - (first.end - first.start);
        if (extent) return extent;
      }
      const shared = Math.min(first.children.length, second.children.length);
      for (let index = 0; index < shared; index++) {
        this.meter.charge(4);
        const result = compareTree(first.children[index], second.children[index], depth + 1);
        if (result) return result;
      }
      return first.children.length - second.children.length;
    };
    return compareTree(left.tree, right.tree, 0);
  }

  rank(histories, policy) {
    this.meter.charge(8);
    if (histories.length < 1 || histories.length > this.maxCandidates) throw new Refusal('CANDIDATES');
    let winner;
    for (let index = 0; index < histories.length; index++) {
      this.meter.charge(8);
      this.owned(histories[index]);
      if (!winner || this.compare(histories[index], winner, policy) < 0) winner = histories[index];
    }
    this.meter.charge();
    return winner;
  }
}

export function sameContinuationState(meter, first, second) {
  meter.charge(12);
  if (first.pc !== second.pc || first.position !== second.position || first.required !== second.required || first.progressed !== second.progressed || first.optionalEmpty !== second.optionalEmpty || first.activation !== second.activation || first.parent !== second.parent || first.env.length !== second.env.length) return false;
  for (let index = 0; index < first.env.length; index++) {
    meter.charge(8);
    if (first.env[index].state !== second.env[index].state || first.env[index].start !== second.env[index].start || first.env[index].end !== second.env[index].end) return false;
  }
  return true;
}
