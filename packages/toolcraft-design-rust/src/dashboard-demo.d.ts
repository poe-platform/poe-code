import type {Dashboard} from "./dashboard-runtime.js";
type DemoDashboard=Pick<Dashboard,"appendOutput"|"updateStats">;
type DemoRuntime={
  setInterval:typeof globalThis.setInterval;
  clearInterval:typeof globalThis.clearInterval;
  setTimeout:typeof globalThis.setTimeout;
  clearTimeout:typeof globalThis.clearTimeout;
  now:()=>number;
  random:()=>number;
};
export declare function startDashboardDemo(dashboard:DemoDashboard,runtime?:Partial<DemoRuntime>):()=>void;
export declare function main():Promise<void>;
