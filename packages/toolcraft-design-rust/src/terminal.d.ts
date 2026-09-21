export declare function graphemes(value:string):string[];
export declare function graphemeWidth(segment:string):number;
export declare function displayWidth(value:string,startColumn?:number):number;
export declare function expandTabs(value:string,startColumn?:number):string;
export declare function truncateToWidth(value:string,width:number):string;
export declare function plainTerminalText(value:string):string;
export declare function formatAgentPlan(entries:readonly {content:string;status:"pending"|"in_progress"|"completed"}[]):{text:string;detail?:string};
