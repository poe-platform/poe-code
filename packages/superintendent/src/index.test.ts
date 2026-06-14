import { describe, expect, it } from "vitest";
import * as commands from "./commands/index.js";
import * as documentParse from "./document/parse.js";
import * as documentTasks from "./document/tasks.js";
import * as documentWrite from "./document/write.js";
import * as pkg from "./index.js";
import * as runtimeBuilder from "./runtime/run-builder.js";
import * as runtimeInspector from "./runtime/run-inspector.js";
import * as runtimeLoop from "./runtime/loop.js";
import * as runtimeTemplates from "./runtime/templates.js";
import * as stateMachine from "./state/machine.js";

describe("@poe-code/superintendent package exports", () => {
  it("re-exports the public SDK surface", () => {
    expect(pkg.parseSuperintendentDoc).toBe(documentParse.parseSuperintendentDoc);
    expect(pkg.resolveSuperintendentDoc).toBe(documentParse.resolveSuperintendentDoc);
    expect(pkg.superintendentDocumentSchema).toBe(documentParse.superintendentDocumentSchema);
    expect(pkg.superintendentDocumentSchemaId).toBe(documentParse.superintendentDocumentSchemaId);
    expect(pkg.superintendentBaseDocumentSchema).toBe(
      documentParse.superintendentBaseDocumentSchema
    );
    expect(pkg.superintendentBaseDocumentSchemaId).toBe(
      documentParse.superintendentBaseDocumentSchemaId
    );
    expect(pkg.updateStatus).toBe(documentWrite.updateStatus);
    expect(pkg.transitionState).toBe(documentWrite.transitionState);
    expect(pkg.incrementRound).toBe(documentWrite.incrementRound);
    expect(pkg.parseTaskBoard).toBe(documentTasks.parseTaskBoard);
    expect(pkg.hasTaskBoard).toBe(documentTasks.hasTaskBoard);
    expect(pkg.runLoop).toBe(runtimeLoop.runLoop);
    expect(pkg.runBuilder).toBe(runtimeBuilder.runBuilder);
    expect(pkg.runInspector).toBe(runtimeInspector.runInspector);
    expect(pkg.runAllInspectors).toBe(runtimeInspector.runAllInspectors);
    expect(pkg.resolveTemplate).toBe(runtimeTemplates.resolveTemplate);
    expect(pkg.createLoopState).toBe(stateMachine.createLoopState);
    expect(pkg.applyTransition).toBe(stateMachine.applyTransition);
    expect(pkg.isComplete).toBe(stateMachine.isComplete);
    expect(pkg.superintendentGroup).toBe(commands.superintendentGroup);
  });

  it("exports superintendent document schemas", () => {
    expect(pkg.superintendentDocumentSchemaId).toBe(
      "https://poe-platform.github.io/poe-code/schemas/plans/superintendent.schema.json"
    );
    expect(pkg.superintendentDocumentSchema).toMatchObject({
      $id: pkg.superintendentDocumentSchemaId,
      properties: {
        kind: { const: "superintendent" }
      },
      required: ["kind", "version", "builder", "superintendent", "owner", "status"]
    });
    expect(pkg.superintendentBaseDocumentSchemaId).toBe(
      "https://poe-platform.github.io/poe-code/schemas/plans/superintendent-base.schema.json"
    );
    expect(pkg.superintendentBaseDocumentSchema).toMatchObject({
      $id: pkg.superintendentBaseDocumentSchemaId,
      properties: {
        kind: { const: "superintendent-base" }
      },
      required: ["kind", "version"]
    });
  });

  it("does not expose legacy top-level command groups", () => {
    expect("builderGroup" in pkg).toBe(false);
    expect("inspectorGroup" in pkg).toBe(false);
    expect("superintendentMcpGroup" in pkg).toBe(false);
  });
});
