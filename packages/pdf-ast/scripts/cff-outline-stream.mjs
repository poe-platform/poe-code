/** Keep the vendored interpreter and its synchronous convenience API on the
 * same operators while allowing retained rendering to drain each operator. */
export function streamCffOutlines(source) {
  const start = source.indexOf("function compileCharString("),
    end = source.indexOf("\nvar Commands = class", start) >= 0
      ? source.indexOf("\nvar Commands = class", start)
      : source.indexOf("\nclass Commands", start);
  if (start < 0 || end < start) throw new Error("CFF outline source markers changed");
  let parser = source.slice(start, end);
  parser = parser.replace("function compileCharString(", "function* compileCharString(")
    .replace("  function parse(code) {", "  function* parse(code, depth = 0) {\n    if (cmds.streaming && depth > cmds.maxSubrDepth) { cmds.onFrameAllocation?.(256); cmds.maxSubrDepth = depth; }")
    .replaceAll("parse(subrCode);", "yield* parse(subrCode, depth + 1);")
    .replaceAll("            compileCharString(", "            yield* compileCharString(")
    .replace("  parse(charStringCode);", "  yield* parse(charStringCode);")
    .replaceAll("stack.push(", "yield* pushOperand(")
    .replaceAll("stack.pop()", '(yield* readOperand("pop"))')
    .replaceAll("stack.shift()", '(yield* readOperand("shift"))')
    .replace("  const stack = [];", `  const stack = cmds.createStack?.(cmds.depth) ?? [];
  function* pushOperand(value) {
    if (!Array.isArray(stack)) { yield stack.push(value); return; }
    if (cmds.streaming && stack.length + 1 > cmds.maxOperands) { cmds.onFrameAllocation?.(16); cmds.maxOperands = stack.length + 1; }
    stack.push(value);
  }
  function* readOperand(method) {
    return Array.isArray(stack) ? stack[method]() : yield stack[method]();
  }`);
  for (const name of ["moveTo", "lineTo", "bezierCurveTo"]) {
    const start = parser.indexOf("  function " + name + "("),
      nextFunction = parser.indexOf("\n  function ", start + 1),
      end = nextFunction < 0 ? parser.indexOf("\n  const stack", start) : nextFunction;
    if (start < 0 || end < start) throw new Error("CFF drawing helper changed: " + name);
    let helper = parser.slice(start, end);
    const close = helper.lastIndexOf("}");
    helper = helper.slice(0, close) + "  if (cmds.streaming) { yield cmds.getPath(); cmds.cmds.length = 0; }\n  " + helper.slice(close);
    helper = helper.replace("function " + name, "function* " + name);
    parser = parser.slice(0, start) + helper + parser.slice(end);
    parser = parser.replaceAll("    " + name + "(", "    yield* " + name + "(");
  }
  // Separate seac invocations have their own operand stack, but share commands.
  const body = parser.indexOf("{\n") + 2, close = parser.lastIndexOf("}");
  parser = parser.slice(0, body) + "  cmds.depth = (cmds.depth ?? 0) + 1;\n  if (cmds.streaming && cmds.depth > cmds.maxDepth) { cmds.onFrameAllocation?.(4096); cmds.maxDepth = cmds.depth; }\n  try {\n" + parser.slice(body, close) + "  } finally { cmds.depth--; }\n" + parser.slice(close);
  source = source.slice(0, start) + parser + source.slice(end);
  const marker = "    compileCharString(code, cmds, this, glyphId);";
  if (!source.includes(marker)) throw new Error("CFF compiler source marker changed");
  source = source.replace(marker, "    for (const ignored of compileCharString(code, cmds, this, glyphId)) { /* synchronous collector */ }");
  const method = `  *glyphCommands(code, glyphId, onAllocation, createStack) {
    onAllocation?.(16384);
    if (!code?.length || code[0] === 14) return;
    let matrix = this.fontMatrix;
    if (this.isCFFCIDFont) {
      const index = this.fdSelect.getFDIndex(glyphId);
      if (index >= 0 && index < this.fdArray.length) matrix = this.fdArray[index].getByName("FontMatrix") || FONT_IDENTITY_MATRIX;
    }
    assert(isNumberArray(matrix, 6), "Expected a valid fontMatrix.");
    const cmds = new Commands();
    cmds.streaming = true;
    cmds.createStack = createStack;
    cmds.maxDepth = 1;
    cmds.maxSubrDepth = 10;
    cmds.maxOperands = 48;
    cmds.onFrameAllocation = onAllocation;
    cmds.transform(matrix.slice());
    yield* compileCharString(code, cmds, this, glyphId);
    cmds.add(DrawOPS.closePath);
    yield cmds.getPath();
  }
`;
  const at = source.indexOf("  compileGlyphImpl(code, cmds, glyphId) {", source.indexOf("class Type2Compiled") >= 0 ? source.indexOf("class Type2Compiled") : source.indexOf("var Type2Compiled"));
  if (at < 0) throw new Error("CFF Type2 source marker changed");
  return source.slice(0, at) + method + source.slice(at);
}
