// Public contracts remain type-only references until standalone declaration packaging is qualified.
import type {Command} from "./index.js";
import type {ErrorReportRenderContext as ReferenceErrorReportRenderContext,ErrorReportRenderResult} from "toolcraft/cli";
export type {CLIHelpDepth,CLIControls,CLIOutputFormatContext,CLIOutputFormatRenderer,CLIOutputFormats,CLIOutputControl,RunCLIOptions,CLICommandTreeSnapshotOption,CLICommandTreeSnapshotCommand,CLICommandTreeSnapshotGroup,CLICommandTreeSnapshotNode,CLICommandTreeSnapshot,CLICommandTreeSnapshotOptions,ErrorReportRenderResult} from "toolcraft/cli";
export type {CLIInvocationRuntime} from "./cli-execution.js";
export {configureTheme} from "./design.js";
export {formatCLIName} from "./cli-policy.js";
export {createCLICommandTreeSnapshot} from "./cli-snapshot.js";
export declare const runCLI:typeof import("toolcraft/cli").runCLI;
export declare const executeCLICommand:typeof import("toolcraft/cli").executeCLICommand;
export type ErrorReportRenderContext=Omit<ReferenceErrorReportRenderContext,"command">&{command?:Command<any,any,any,any>};
export declare function renderErrorReport(context:ErrorReportRenderContext):ErrorReportRenderResult;
