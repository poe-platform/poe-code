function privateAssignmentName(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  let node = value as Record<string, unknown>;
  while (node.type === "AssignmentPattern" || node.type === "RestElement")
    node = (node.type === "AssignmentPattern" ? node.left : node.argument) as Record<string, unknown>;
  if (node.type !== "MemberExpression") return undefined;
  const property = node.property as Record<string, unknown>;
  return property.type === "PrivateIdentifier" ? String(property.name) : undefined;
}

function asyncResourceDeclaration(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  return node.type === "VariableDeclaration" && node.disposal === "async";
}

// Schema validation precedes this source-ownership check in both restore paths.
export function validateGuestFunctionAst(record: Record<string, unknown>, origin: unknown): void {
  if (record.kind === "guest-class") {
    if (origin === null || typeof origin !== "object" || !["ClassDeclaration", "ClassExpression"].includes(String((origin as Record<string, unknown>).type)))
      throw new TypeError("Unknown class AST identity");
    const node = origin as import("../parse.js").ClassNode;
    const expected = node.body.body.flatMap((element,index) => element.type === "PropertyDefinition" && !element.static ? [{element,index}] : []);
    const fields = record.fields as Array<{index:number;key:unknown;privateName?:unknown}>;
    if (fields.length !== expected.length) throw new TypeError("Invalid class field count.");
    expected.forEach(({element,index}, position) => {
      const field = fields[position];
      if (field.index !== index) throw new TypeError("Invalid class field AST identity.");
      if ((element.key.type === "PrivateIdentifier") !== (field.privateName !== undefined)) throw new TypeError("Invalid private field identity.");
      if (!element.computed) {
        const key = element.key.type === "PrivateIdentifier" ? `#${element.key.name}` : element.key.type === "Identifier" ? element.key.name : String((element.key as {value:string|number}).value);
        if (field.key !== key) throw new TypeError("Invalid class field key.");
      }
    });
    return;
  }
  if (origin === null || typeof origin !== "object" ||
      !["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"].includes(String((origin as Record<string, unknown>).type)))
    throw new TypeError("Unknown guest function AST identity");
  if (record.kind !== "guest-generator") return;
  const functionNode = origin as Record<string, unknown>;
  const representedAsync = record.asyncFunction === true || (record.async === true && record.driver !== undefined);
  if (record.asyncFunction === true
      ? functionNode.async !== true || functionNode.generator === true || record.async !== false
      : functionNode.generator !== true || (functionNode.async === true) !== record.async)
    throw new TypeError("Invalid generator AST identity");

  let yieldBlocks: ReadonlySet<number> | undefined;
  let yieldFinalizers: ReadonlySet<number> | undefined;
  type ExpressionPosition = { kind: "dynamic-import" } | { kind: "binary" } | { kind: "pattern-source" } | { kind: "identifier-assignment" } | { kind: "member"; superReceiver: boolean }
    | { kind: "switch"; phase: "test" | "body"; index: number; statementIndex: number }
    | { kind: "for"; phase: string }
    | { kind: "for-in"; phase: string }
    | { kind: "for-of"; phase: string; async: boolean }
    | { kind: "array-pattern"; index: number; privateName?: string }
    | { kind: "declaration"; index: number }
    | { kind: "yield-delegate"; async: boolean }
    | { kind: "object-pattern"; index: number; key: boolean; privateName?: string }
    | { kind: "member-assignment"; superReceiver: boolean; key: boolean; privateName?: string }
    | { kind: "array" | "call" | "new" | "template" | "tagged"; index: number; member?: boolean }
    | { kind: "object"; index: number; key: boolean };
  let yieldExpressions: ReadonlyMap<number, ExpressionPosition> | undefined;
  const pending: Array<{ value: unknown; blocks: ReadonlySet<number>; finalizers: ReadonlySet<number>; expressions: ReadonlyMap<number, ExpressionPosition> }> = [
    { value: functionNode.body, blocks: new Set(), finalizers: new Set(), expressions: new Map() }
  ];
  while (pending.length > 0) {
    const frame = pending.pop()!;
    if (frame.value === null || typeof frame.value !== "object") continue;
    const node = frame.value as Record<string, unknown>;
    if (["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"].includes(String(node.type))) continue;
    let blocks = frame.blocks;
    if (node.type === "BlockStatement" && typeof node.nodeId === "number") blocks = new Set([...blocks, node.nodeId]);
    const cases = node.type === "SwitchStatement" ? node.cases as Array<{consequent:unknown[]}> : undefined;
    const resourceBoundary = representedAsync && (
      (node.type === "BlockStatement" && Array.isArray(node.body) && node.body.some(asyncResourceDeclaration)) ||
      (node.type === "ForOfStatement" && asyncResourceDeclaration(node.left)) ||
      (node.type === "ForStatement" && asyncResourceDeclaration(node.init)) ||
      (cases !== undefined && cases.some(entry => entry.consequent.some(asyncResourceDeclaration))));
    const iteratorBoundary = representedAsync && node.type === "ForOfStatement" && node.await === true &&
      ["next", "close"].includes((record.expressionStates as Record<string, {phase:string}> | undefined)?.[String(node.nodeId)]?.phase ?? "");
    const delegateBoundary = representedAsync && node.type === "YieldExpression" && node.delegate === true &&
      ["await", "close"].includes((record.expressionStates as Record<string, {phase:string}> | undefined)?.[String(node.nodeId)]?.phase ?? "");
    if ((node.type === "YieldExpression" || (representedAsync && node.type === "AwaitExpression") ||
        (record.awaitPhase === "return" && node.type === "ReturnStatement") || resourceBoundary || iteratorBoundary) && node.nodeId === record.yieldNodeId) {
      if (record.awaitPhase !== undefined) {
        const valid = record.awaitPhase === "await" ? node.type === "AwaitExpression" || resourceBoundary || iteratorBoundary || delegateBoundary
          : record.awaitPhase === "return" ? node.type === "ReturnStatement"
          : node.type === "YieldExpression" && (record.awaitPhase === "resume-return" || node.delegate !== true);
        if (!valid) throw new TypeError("Invalid async generator await source position.");
      }
      yieldBlocks = blocks;
      yieldFinalizers = frame.finalizers;
      yieldExpressions = node.delegate === true && typeof node.nodeId === "number"
        ? new Map([...frame.expressions, [node.nodeId, { kind: "yield-delegate", async: record.async === true }]])
        : frame.expressions;
      if (resourceBoundary && typeof node.nodeId === "number") {
        if (node.type === "ForOfStatement") yieldExpressions = new Map([...frame.expressions, [node.nodeId, {kind:"for-of",phase:"body",async:node.await===true}]]);
        if (node.type === "ForStatement") yieldExpressions = new Map([...frame.expressions, [node.nodeId, {kind:"for",phase:"dispose"}]]);
        if (cases !== undefined) {
          const progress = (record.expressionStates as Record<string, {phase:string;index:number;statementIndex:number}> | undefined)?.[String(node.nodeId)];
          if (progress === undefined || progress.phase !== "body" || progress.index < 0 || progress.index >= cases.length ||
              progress.statementIndex < 0 || progress.statementIndex >= cases[progress.index]!.consequent.length) throw new TypeError("Invalid switch disposal position.");
          yieldExpressions = new Map([...frame.expressions, [node.nodeId, {kind:"switch",phase:"body",index:progress.index,statementIndex:progress.statementIndex}]]);
        }
      }
      if (iteratorBoundary && typeof node.nodeId === "number")
        yieldExpressions = new Map([...frame.expressions, [node.nodeId, {kind:"for-of",phase:(record.expressionStates as Record<string, {phase:string}>)[String(node.nodeId)]!.phase,async:true}]]);
    }
    for (const [key, value] of Object.entries(node)) {
      if (node.type === "SwitchStatement" && key === "cases" && typeof node.nodeId === "number" && Array.isArray(value)) {
        const id = node.nodeId;
        value.forEach((entry: Record<string, unknown>, index) => {
          pending.push({ value: entry.test, blocks, finalizers: frame.finalizers,
            expressions: new Map([...frame.expressions, [id, { kind: "switch", phase: "test", index, statementIndex: 0 }]]) });
          (entry.consequent as unknown[]).forEach((statement, statementIndex) => pending.push({ value: statement, blocks, finalizers: frame.finalizers,
            expressions: new Map([...frame.expressions, [id, { kind: "switch", phase: "body", index, statementIndex }]]) }));
        });
        continue;
      }
      if (node.type === "VariableDeclaration" && key === "declarations" && typeof node.nodeId === "number" && Array.isArray(value)) {
        value.forEach((declarator, index) => pending.push({ value: declarator, blocks, finalizers: frame.finalizers,
          expressions: new Map([...frame.expressions, [node.nodeId as number, { kind: "declaration", index }]]) }));
        continue;
      }
      // Tagged templates evaluate substitutions as arguments, not string prefixes.
      if (node.type === "TaggedTemplateExpression" && key === "quasi") {
        ((value as Record<string, unknown>).expressions as unknown[]).forEach((expression, index) => {
          pending.push({ value: expression, blocks, finalizers: frame.finalizers,
            expressions: new Map([...frame.expressions, [node.nodeId as number, { kind: "tagged", index }]]) });
        });
        continue;
      }
      if (node.type === "ObjectPattern" && key === "properties" && typeof node.nodeId === "number" && Array.isArray(value)) {
        const id = node.nodeId;
        value.forEach((property: Record<string, unknown>, index) => {
          for (const part of property.type === "RestElement" ? ["argument"] : ["key", "value"]) {
            pending.push({ value: property[part], blocks, finalizers: frame.finalizers,
              expressions: new Map([...frame.expressions, [id, { kind: "object-pattern", index, key: part === "key",
                privateName: part === "key" ? undefined : privateAssignmentName(property[part]) }]]) });
          }
        });
        continue;
      }
      if (node.type === "ObjectExpression" && key === "properties" && typeof node.nodeId === "number" && Array.isArray(value)) {
        const id = node.nodeId;
        value.forEach((property: Record<string, unknown>, index) => {
          if (property.type === "SpreadElement") {
            pending.push({ value: property.argument, blocks, finalizers: frame.finalizers,
              expressions: new Map([...frame.expressions, [id, { kind: "object", index, key: false }]]) });
          } else {
            for (const part of ["key", "value"]) pending.push({ value: property[part], blocks, finalizers: frame.finalizers,
              expressions: new Map([...frame.expressions, [id, { kind: "object", index, key: part === "value" }]]) });
          }
        });
        continue;
      }
      if ((((node.type === "ArrayExpression" || node.type === "ArrayPattern") && key === "elements") ||
          (node.type === "TemplateLiteral" && key === "expressions") ||
          ((node.type === "CallExpression" || node.type === "NewExpression") && key === "arguments")) &&
          typeof node.nodeId === "number" && Array.isArray(value)) {
        const kind = node.type === "ArrayPattern" ? "array-pattern" : node.type === "ArrayExpression" ? "array" : node.type === "TemplateLiteral" ? "template"
          : node.type === "CallExpression" ? "call" : "new";
        value.forEach((element, index) => pending.push({ value: element, blocks, finalizers: frame.finalizers,
          expressions: new Map([...frame.expressions, [node.nodeId as number, { kind, index,
            ...(kind === "array-pattern" ? { privateName: privateAssignmentName(element) } : {}),
            member: kind === "call" && (node.callee as Record<string, unknown>)?.type === "MemberExpression" }]]) }));
        continue;
      }
      pending.push({ value, blocks: node.type === "CatchClause" && key === "param" && typeof node.nodeId === "number"
        ? new Set([...blocks, node.nodeId]) : blocks,
        expressions: node.type === "CatchClause" && key === "param" && typeof node.nodeId === "number"
          ? new Map([...frame.expressions, [node.nodeId, { kind: "pattern-source" }]])
          : ((node.type === "VariableDeclarator" && key === "id" && node.init !== undefined) ||
          ((node.type === "AssignmentExpression" || node.type === "AssignmentPattern") && key === "left")) && typeof node.nodeId === "number" &&
          ["ArrayPattern", "ObjectPattern"].includes(String((value as Record<string, unknown>)?.type))
          ? new Map([...frame.expressions, [node.nodeId, { kind: "pattern-source" }]])
          : node.type === "ForOfStatement" && ["left", "body"].includes(key) && typeof node.nodeId === "number"
          ? new Map([...frame.expressions, [node.nodeId, { kind: "for-of", phase: key, async: node.await === true }]])
          : node.type === "ForInStatement" && ["left", "body"].includes(key) && typeof node.nodeId === "number"
          ? new Map([...frame.expressions, [node.nodeId, { kind: "for-in", phase: key }]])
          : node.type === "ForStatement" && ["init", "test", "body", "update"].includes(key) && typeof node.nodeId === "number"
          ? new Map([...frame.expressions, [node.nodeId, { kind: "for", phase: key }]])
          : node.type === "BinaryExpression" && key === "right" && typeof node.nodeId === "number"
          ? new Map([...frame.expressions, [node.nodeId, { kind: "binary" }]])
          : node.type === "ImportExpression" && key === "options" && typeof node.nodeId === "number"
          ? new Map([...frame.expressions, [node.nodeId, { kind: "dynamic-import" }]])
          : node.type === "AssignmentExpression" && key === "right" && typeof node.nodeId === "number" &&
              (node.left as Record<string, unknown>).type === "Identifier"
            ? new Map([...frame.expressions, [node.nodeId, { kind: "identifier-assignment" }]])
          : node.type === "AssignmentExpression" && key === "right" && typeof node.nodeId === "number" &&
              (node.left as Record<string, unknown>).type === "MemberExpression"
            ? new Map([...frame.expressions, [node.nodeId, { kind: "member-assignment", key: node.operator !== "=" && ((node.left as Record<string, unknown>).property as Record<string, unknown>).type !== "PrivateIdentifier",
              privateName: ((node.left as Record<string, unknown>).property as Record<string, unknown>).type === "PrivateIdentifier"
                ? String(((node.left as Record<string, unknown>).property as Record<string, unknown>).name) : undefined,
              superReceiver: ((node.left as Record<string, unknown>).object as Record<string, unknown>).type === "Super" }]])
          : node.type === "MemberExpression" && node.computed === true && key === "property" && typeof node.nodeId === "number"
            ? new Map([...frame.expressions, [node.nodeId, { kind: "member", superReceiver: (node.object as Record<string, unknown>).type === "Super" }]])
            : frame.expressions,
        finalizers: node.type === "TryStatement" && key === "finalizer" && typeof node.nodeId === "number"
          ? new Set([...frame.finalizers, node.nodeId]) : frame.finalizers });
    }
  }
  if (record.yieldNodeId !== undefined && yieldBlocks === undefined)
    throw new TypeError("Invalid generator AST identity");
  if (record.state === "suspended" && Object.keys((record.blockScopes ?? {}) as object).length !== yieldBlocks?.size)
    throw new TypeError(`Invalid generator AST identity: expected blocks ${[...(yieldBlocks ?? [])]}, received ${Object.keys((record.blockScopes ?? {}) as object)}.`);
  if (record.blockScopes !== undefined) {
    for (const id of Object.keys(record.blockScopes as object)) {
      if (!yieldBlocks?.has(Number(id))) throw new TypeError("Invalid generator AST identity");
    }
  }
  const completions = Object.keys((record.finallyCompletions ?? {}) as object);
  if (record.state === "suspended" && completions.length !== yieldFinalizers?.size)
    throw new TypeError("Invalid generator AST identity: missing finally completion");
  for (const id of completions) {
    if (!yieldFinalizers?.has(Number(id))) throw new TypeError("Invalid generator AST identity: unrelated finally completion");
  }
  const expressions = Object.entries((record.expressionStates ?? {}) as Record<string, Record<string, unknown>>);
  if (record.state === "suspended" && expressions.length !== yieldExpressions?.size)
    throw new TypeError("Invalid generator AST identity: missing expression continuation");
  for (const [id, expression] of expressions) {
    const expected = yieldExpressions?.get(Number(id));
    const compatibleKind = expected?.kind === expression.kind ||
      (expected?.kind === "for-of" && (expression.kind === "for-of-iterator" || (!expected.async && expression.kind === "for-of-array"))) ||
      (expected?.kind === "call" && expected.member === true && expression.kind === "array-call");
    if (expected === undefined || !compatibleKind ||
        (expected.kind !== "dynamic-import" && expected.kind !== "binary" && expected.kind !== "yield-delegate" && expected.kind !== "pattern-source" && expected.kind !== "identifier-assignment" && expected.kind !== "member" && expected.kind !== "member-assignment" && expected.kind !== "for" && expected.kind !== "for-in" && expected.kind !== "for-of" && expected.index !== expression.index) ||
        (expected.kind === "yield-delegate" && expected.async !== expression.async) ||
        (expected.kind === "switch" && (expected.phase !== expression.phase || expected.statementIndex !== expression.statementIndex)) ||
        ((expected.kind === "for" || expected.kind === "for-of") && expected.phase !== expression.phase) ||
        (expected.kind === "for-in" && expected.phase !== (expression.phase ?? "body")) ||
        (expected.kind === "object-pattern" && expected.key !== (expression.phase === "key")) ||
        ((expected.kind === "object-pattern" || expected.kind === "array-pattern") &&
          (expression.phase === "binding" ? expected.privateName : undefined) !== expression.privateName) ||
        (expected.kind === "for-of" && expression.kind === "for-of-iterator" && expected.async !== expression.async) ||
        (expected.kind === "member-assignment" && (expected.key !== Object.hasOwn(expression, "key") ||
          expected.privateName !== expression.privateName ||
          expected.superReceiver !== Object.hasOwn(expression, "superReceiver"))) ||
        (expected.kind === "member" && expected.superReceiver !== Object.hasOwn(expression, "superReceiver")) ||
        (expected.kind === "object" && expected.key !== Object.hasOwn(expression, "key")))
      throw new TypeError("Invalid generator AST identity: unrelated expression continuation");
  }
}
