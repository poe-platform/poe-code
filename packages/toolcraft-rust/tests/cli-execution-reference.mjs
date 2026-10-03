import {readFile} from "node:fs/promises";
import * as definitions from "../../toolcraft/dist/index.js";
import * as design from "../../toolcraft-design/dist/index.js";
import {nativeJsonSchema} from "../../toolcraft-schema/dist/index.js";
import {renderResult} from "../../toolcraft/dist/renderer.js";
import {throwValidationErrors} from "../../toolcraft/dist/validation-errors.js";
import {loadCLIReference} from "./cli-reference.mjs";
import {loadPromptReference} from "./cli-prompts-reference.mjs";
import {loadParamsReference} from "./cli-params-reference.mjs";
import {loadFixtureReference} from "./cli-fixtures-reference.mjs";
import {original as dynamic} from "./cli-dynamic-values-reference.mjs";
export function loadExecutionReference(capabilities={}){
  const prompts=loadPromptReference({...design,...capabilities});
  const params=loadParamsReference({readFile,promptForField:prompts.promptForField,select:design.select,isCancel:design.isCancel,...capabilities});
  return loadCLIReference(["executeCommand","getResolvedFlags","writeCLIDiagnosticEvent","writeRichHeader","isHumanInLoopPending","renderHumanInLoopPending","renderCLIResult","resolveOutput","toDesignSystemOutput"],[],{
    createLogger:design.createLogger,renderTable:design.renderTable,getTheme:design.getTheme,note:design.note,
    confirm:design.confirm,isCancel:design.isCancel,withOutputFormat:design.withOutputFormat,
    createRuntimeLogger:definitions.createRuntimeLogger,assertCommandRequirements:definitions.assertCommandRequirements,
    createManagedStream:definitions.createManagedStream,resolveCommandSecrets:definitions.resolveCommandSecrets,
    resolveFixtureRuntime:loadFixtureReference(capabilities.readFile??readFile).resolveFixtureRuntime,
    resolveParams:params.resolveParams,nativeJsonSchema,throwValidationErrors,
    formatFieldValidationIssue:dynamic.formatFieldValidationIssue,formatResolvedValue:prompts.formatResolvedValue,
    renderResult,...capabilities
  });
}
