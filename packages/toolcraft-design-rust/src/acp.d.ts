export type AgentPlanEntry={content:string;status:"pending"|"in_progress"|"completed"};
export declare function formatAgentPlan(entries:readonly AgentPlanEntry[]):{text:string;detail?:string};
export declare function renderAgentPlan(entries:readonly AgentPlanEntry[]):void;
export type AcpLineWriter=(line:string)=>void;
export declare function getAcpWriter():AcpLineWriter;
export declare function withAcpWriter<T>(writer:AcpLineWriter,operation:()=>Promise<T>):Promise<T>;
