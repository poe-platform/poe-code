import type {ExplorerEvent} from "./explorer-events.js";
import type {Action,ActionContext,ExplorerState,Row,Tone} from "./explorer-types.js";
export type ActionSource = "row" | "detail" | "both";
type ExplorerKeypressEvent = Extract<ExplorerEvent,{type:"key"}>["key"];
export type ActionRuntimeHandles = {
  refresh: () => Promise<void>;
  reloadDetail: (rowId?: string) => void;
  suspendAnd: <T>(fn: () => Promise<T>) => Promise<T>;
  openModal: (content: {title:string;content:string}) => void;
  toast: (msg:string,tone?:Tone) => void;
  confirm: ActionContext<unknown>["confirm"];
  promptText: ActionContext<unknown>["promptText"];
  exit: (after?: () => void | Promise<void>) => void;
};
export declare function resolveAction<R>(state:ExplorerState,keyEvent:ExplorerKeypressEvent):Action<R>|null;
export declare function buildActionContext<R>(state:ExplorerState,_action:Action<R>,source:ActionSource,runtimeHandles:ActionRuntimeHandles,rowsOverride?:Row[]):ActionContext<R>;
