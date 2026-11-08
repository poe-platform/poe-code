import type {ActionRuntimeHandles} from './explorer-actions.js';
import type {Effect,ExplorerEvent} from './explorer-events.js';
import type {ExplorerState} from './explorer-state.js';
type StepResult={state:ExplorerState;effects:Effect[]};
export declare function step(state:ExplorerState,event:ExplorerEvent,runtimeHandles?:ActionRuntimeHandles):StepResult;
export {};
