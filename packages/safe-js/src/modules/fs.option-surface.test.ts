import ts from "typescript";
import { describe, expect, it } from "vitest";

import { FS_OPTION_SURFACE } from "./fs.js";

// The module's option surface is only trustworthy if it is measured against the
// node it actually runs on rather than a remembered list, so node's own
// fs/promises typings are read here through the TypeScript checker: it resolves
// the overloads, unions, intersections, aliases, and inherited option interfaces
// that a hand-rolled reader of the .d.ts would have to re-implement and get
// wrong. An option node adds later fails this suite instead of reaching the
// implementation unclassified.
const PROBE = "fs-option-surface-probe.ts";

const PROBE_SOURCE = 'import * as fsPromises from "fs/promises";\nexport const probe = fsPromises;\n';

// node names the options argument `options` everywhere except stat and lstat,
// which name it `opts`.
const OPTIONS_PARAMETERS = ["options", "opts"];

// Reads every option key node's typings declare for each fs/promises function,
// keyed by function name. The probe module is served from memory: nothing is
// written to disk to ask the question.
function readNodeOptionKeys(): Map<string, Set<string>> {
  const host = ts.createCompilerHost({}, true);
  const readSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);

  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    fileName === PROBE
      ? ts.createSourceFile(fileName, PROBE_SOURCE, languageVersion, true)
      : readSourceFile(fileName, languageVersion, ...rest);
  host.fileExists = (fileName) => fileName === PROBE || fileExists(fileName);
  host.readFile = (fileName) => (fileName === PROBE ? PROBE_SOURCE : readFile(fileName));

  const program = ts.createProgram([PROBE], { strict: true, types: ["node"] }, host);
  const checker = program.getTypeChecker();
  const probe = program.getSourceFile(PROBE);
  const declaration = probe?.statements.find(ts.isVariableStatement)?.declarationList
    .declarations[0];

  if (declaration === undefined) {
    throw new Error("The fs/promises probe module did not compile.");
  }

  const namespace = checker.getTypeAtLocation(declaration.name);
  const keys = new Map<string, Set<string>>();

  for (const operation of namespace.getProperties()) {
    const operationType = checker.getTypeOfSymbolAtLocation(operation, declaration.name);
    const operationKeys = new Set<string>();

    for (const signature of operationType.getCallSignatures()) {
      const parameters = signature
        .getParameters()
        .filter((parameter) => OPTIONS_PARAMETERS.includes(parameter.getName()));

      for (const parameter of parameters) {
        const parameterType = checker.getTypeOfSymbolAtLocation(parameter, declaration.name);
        const members = parameterType.isUnion() ? parameterType.types : [parameterType];

        for (const member of members) {
          for (const property of member.getProperties()) {
            // Only a property node declares itself: the same parameter also unions
            // string encodings and numeric modes, whose members are String and Number
            // methods from the standard library rather than options.
            const [propertyDeclaration] = property.declarations ?? [];

            if (
              propertyDeclaration !== undefined &&
              ts.isPropertySignature(propertyDeclaration) &&
              propertyDeclaration.getSourceFile().fileName.includes("@types/node")
            ) {
              operationKeys.add(property.getName());
            }
          }
        }
      }
    }

    keys.set(operation.getName(), operationKeys);
  }

  return keys;
}

describe("fs option surface against node's own typings", () => {
  const nodeOptionKeys = readNodeOptionKeys();

  it("reads node's typings rather than trusting the module", () => {
    // A guard on the reader itself: were the typings unreadable, every operation
    // would declare no options and every assertion below would pass vacuously.
    expect(nodeOptionKeys.get("readFile")).toEqual(new Set(["encoding", "flag", "signal"]));
    expect(nodeOptionKeys.get("rm")).toEqual(
      new Set(["force", "maxRetries", "recursive", "retryDelay"])
    );
  });

  for (const [operation, surface] of Object.entries(FS_OPTION_SURFACE)) {
    it(`classifies every option node declares for ${operation}`, () => {
      const declared = nodeOptionKeys.get(operation);
      const classified = new Set<string>([...surface.honoured, ...surface.refused]);
      const unclassified = [...(declared ?? [])].filter((key) => !classified.has(key));

      expect(declared, `node's fs/promises declares no ${operation}`).toBeDefined();
      expect(unclassified).toEqual([]);
    });
  }

  // The mirror of the audit above: an option the module claims to honour that node
  // never declares is one node ignores, so forwarding it drops it silently — the very
  // thing the refusals exist to prevent. A typo in `honoured` is the way in, and it
  // would otherwise read as support.
  //
  // rmdir is the one exemption, and the gap is in the typings rather than in node:
  // @types/node has already dropped rmdir's options argument for a future node that
  // removes it, while the node this runs on still validates maxRetries and retryDelay
  // and still honours recursive. fs.test.ts proves the bag reaches the implementation.
  const HONOURED_WITHOUT_TYPINGS: Record<string, readonly string[]> = {
    rmdir: ["recursive", "maxRetries", "retryDelay"]
  };

  for (const [operation, surface] of Object.entries(FS_OPTION_SURFACE)) {
    it(`honours nothing node does not declare for ${operation}`, () => {
      const declared = nodeOptionKeys.get(operation) ?? new Set<string>();
      const exempt = new Set(HONOURED_WITHOUT_TYPINGS[operation] ?? []);
      const undeclared = surface.honoured.filter(
        (option) => !declared.has(option) && !exempt.has(option)
      );

      expect(undeclared).toEqual([]);
    });
  }

  // An exemption is a standing claim that node's typings are behind node, so it has to
  // stay a claim about an option the typings really do not declare. Once @types/node
  // declares rmdir's options again, this fails and the exemption goes.
  it("exempts only options node's typings genuinely omit", () => {
    for (const [operation, options] of Object.entries(HONOURED_WITHOUT_TYPINGS)) {
      const declared = nodeOptionKeys.get(operation) ?? new Set<string>();
      const nowDeclared = options.filter((option) => declared.has(option));

      expect(nowDeclared, `node's typings now declare ${operation} options`).toEqual([]);
    }
  });

  // The operations the module leaves out of its option surface must be the ones node
  // gives no options bag, not ones whose options were forgotten.
  it("gives an options surface to every operation node declares options for", () => {
    const exposed = [
      "access",
      "appendFile",
      "chmod",
      "copyFile",
      "cp",
      "link",
      "lstat",
      "mkdir",
      "mkdtemp",
      "readFile",
      "readdir",
      "readlink",
      "realpath",
      "rename",
      "rm",
      "rmdir",
      "stat",
      "symlink",
      "truncate",
      "utimes",
      "writeFile"
    ];

    const missing = exposed.filter(
      (operation) =>
        (nodeOptionKeys.get(operation)?.size ?? 0) > 0 && !Object.hasOwn(FS_OPTION_SURFACE, operation)
    );

    expect(missing).toEqual([]);
  });
});
