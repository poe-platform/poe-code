export function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`nonunique edit: ${before.slice(0, 90)}`);
  return source.replace(before, after);
}

export function instrument(source) {
  source = replaceOnce(source, '  const input = symbols(subject,', '  globalThis.diagnosticInstructions = instructions;\n  const input = symbols(subject,');
  source = replaceOnce(source, '      if (state.visited.includes(state.program)) break;', `      globalThis.diagnosticTrace.push({ program: state.program, position: state.position, captures: [...state.captures], visited: [...state.visited], pruned: state.visited.includes(state.program) });
      if (state.visited.includes(state.program)) break;`);
  source = replaceOnce(source, '    steps: work.steps,', '    steps: work.steps, diagnostics: { nodes: work.nodes, states: work.states, allocated: work.allocated },');
  return source;
}

export function prototype(source) {
  source = replaceOnce(source, '  validateCaptureRepetition(tree, work);', '');
  source = replaceOnce(source, '| { kind: "jump"; target: number }', '| { kind: "repeat-enter"; minimum: number; maximum: number; exit: number } | { kind: "repeat-end"; entry: number } | { kind: "jump"; target: number }');
  const start = source.indexOf('    } else if (node.kind === "repeat") {', source.indexOf('function compile('));
  const finish = source.indexOf('    } else emit(node);', start);
  if (start < 0 || finish < start) throw new Error('missing repeat lowering');
  source = source.slice(0, start) + `    } else if (node.kind === "repeat") {
      const entry = instructions.length;
      const repeat: Instruction & { kind: "repeat-enter" } = { kind: "repeat-enter", minimum: node.minimum, maximum: node.maximum, exit: 0 };
      emit(repeat); build(node.child); emit({ kind: "repeat-end", entry });
      repeat.exit = instructions.length;
` + source.slice(finish);
  source = replaceOnce(source, '  interface State { program: number; position: number; captures: number[]; visited: number[] }', `  interface Frame { entry: number; count: number; position: number }
  interface State { program: number; position: number; captures: number[]; visited: number[]; frames: Frame[] }
  function fork(state: State, program: number): State {
    work.state(); work.allocate(state.captures.length + state.frames.length * 3 + 8);
    return { program, position: state.position, captures: [...state.captures], visited: [], frames: state.frames.map(frame => ({ ...frame })) };
  }`);
  source = replaceOnce(source, 'captures: new Array<number>(parser.groups * 2).fill(-1), visited: []', 'captures: new Array<number>(parser.groups * 2).fill(-1), visited: [], frames: []');
  source = replaceOnce(source, '      if (state.visited.includes(state.program)) break;', '');
  source = replaceOnce(source, '      work.allocate(1); state.visited.push(state.program);', '');
  source = replaceOnce(source, '      if (instruction.kind === "split") {', `      if (instruction.kind === "repeat-enter") {
        const entry = state.program - 1;
        let frame = state.frames.at(-1);
        if (!frame || frame.entry !== entry) {
          work.allocate(4);
          frame = { entry, count: 0, position: state.position };
          state.frames.push(frame);
        }
        if (frame.count === instruction.maximum) { state.frames.pop(); state.program = instruction.exit; }
        else {
          if (frame.count >= instruction.minimum) {
            const exit = fork(state, instruction.exit);
            exit.frames.pop(); stack.push(exit);
          }
          frame.position = state.position;
        }
      } else if (instruction.kind === "repeat-end") {
        const frame = state.frames.at(-1)!;
        const repeat = instructions[instruction.entry] as Instruction & { kind: "repeat-enter" };
        if (frame.position === state.position && frame.count >= repeat.minimum) {
          if (frame.count !== 0) break;
          state.frames.pop(); state.program = repeat.exit;
        } else { frame.count++; state.program = instruction.entry; }
      } else if (instruction.kind === "split") {`);
  source = replaceOnce(source, `        work.state(); work.allocate(state.captures.length + state.visited.length + 4);
        stack.push({ program: instruction.second, position: state.position, captures: [...state.captures], visited: [...state.visited] });`, '        stack.push(fork(state, instruction.second));');
  source = replaceOnce(source, '      else if (instruction.kind === "save") state.captures[instruction.slot] = state.position;', `      else if (instruction.kind === "save") {
        state.captures[instruction.slot] = state.position;
        if (instruction.slot % 2 === 0) state.captures[instruction.slot + 1] = -1;
      }`);
  source = replaceOnce(source, '        if (!best || state.position > best.position) best = state;', `        if (!best || state.position > best.position) best = state;
        else if (state.position === best.position) {
          for (let slot = 0; slot < state.captures.length; slot += 2) {
            work.charge(2);
            const length = state.captures[slot] < 0 || state.captures[slot + 1] < state.captures[slot] ? -1 : state.captures[slot + 1] - state.captures[slot];
            const previous = best.captures[slot] < 0 || best.captures[slot + 1] < best.captures[slot] ? -1 : best.captures[slot + 1] - best.captures[slot];
            if (length !== previous) { if (length > previous) best = state; break; }
          }
        }`);
  source = replaceOnce(source, '      work.charge(state.visited.length + 1);', `      work.charge();
      if (globalThis.diagnosticTrace.length < 4096) globalThis.diagnosticTrace.push({ program: state.program, position: state.position, captures: [...state.captures], frames: state.frames.map(frame => ({ ...frame })) });`);
  source = replaceOnce(source, '  const input = symbols(subject,', '  globalThis.diagnosticInstructions = instructions;\n  const input = symbols(subject,');
  source = replaceOnce(source, '    steps: work.steps,', '    steps: work.steps, diagnostics: { nodes: work.nodes, states: work.states, allocated: work.allocated },');
  return source;
}
