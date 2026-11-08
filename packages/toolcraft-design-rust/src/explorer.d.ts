import type {Detail,DetailCtx,Row} from './explorer-state.js';
export {runExplorer} from './explorer-runtime.js';
export {createInitialState,normalizeExplorerConfig} from './explorer-state.js';
export {resolveBindings} from './explorer-keymap.js';
export type {Effect,ExplorerEvent} from './explorer-events.js';
export type {BindingTarget,ExplorerBindingDefaults,ExplorerBuiltinCommand,ResolvedBindings} from './explorer-keymap.js';
export type {Action,ActionContext,ConfirmPromptOptions,Detail,DetailCtx,DetailItem,Dirty,ExplorerConfig,PaneConfig,ListPaneConfig,DetailPaneConfig,PaneRuntimeState,ExplorerLayoutMode,ExplorerSize,ExplorerState,ReorderContext,Row,Tone} from './explorer-state.js';
export declare function singleDetail<R>(fn:(row:Row,ctx:DetailCtx)=>string|Promise<string>):Detail<R>;
