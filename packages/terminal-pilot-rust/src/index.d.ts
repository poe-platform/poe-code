export declare function stripAnsi(input:string):string;
export type TerminalKey='Enter'|'Tab'|'Escape'|'Backspace'|'Delete'|'ArrowUp'|'ArrowDown'|'ArrowRight'|'ArrowLeft'|'Home'|'End'|'PageUp'|'PageDown'|'Space'|`Control+${string}`|`Alt+${string}`;
export declare function keyToSequence(key:TerminalKey):string;
type Cell=([number,string]&{style?:string;width?:number})|null;
export declare class TerminalBuffer{
 readonly displayBuffer:{readonly cursorX:number;readonly cursorY:number;readonly data:Array<Cell[]|undefined>};
 constructor(cols:number,rows:number);write(data:string):void;renderLine(row:number):string;resize(cols:number,rows:number):void;
}
export declare class TerminalScreen{
 readonly lines:readonly string[];readonly rawLines:readonly string[];readonly cursor:{row:number;col:number};readonly size:{rows:number;cols:number};
 constructor(options:{lines:string[];rawLines:string[];cursor:{row:number;col:number};size:{rows:number;cols:number}});
 readonly text:string;contains(substring:string):boolean;line(index:number):string;
}
export interface NewSessionOptions {command:string;args?:string[];cwd?:string;env?:Record<string,string>;cols?:number;rows?:number;observe?:boolean;}
export type WaitForOptions={timeout?:number;scope?:'history'|'screen'};
export type HistoryOptions={last?:number};
export declare class TerminalSession{
 readonly id:string;readonly command:string;readonly pid:number;exitCode:number|null;
 constructor(options:Omit<NewSessionOptions,'env'>&{id:string;env?:Record<string,string|undefined>});
 type(text:string):Promise<void>;fill(text:string):Promise<void>;press(key:TerminalKey):Promise<void>;send(raw:string):Promise<void>;signal(sig:string):Promise<void>;
 waitFor(pattern:string|RegExp,opts?:WaitForOptions):Promise<string>;waitForQuiet(ms:number):Promise<void>;
 screen():Promise<TerminalScreen>;history(opts?:HistoryOptions):Promise<string[]>;resize(cols:number,rows:number):Promise<void>;
 waitForExit(opts?:{timeout?:number}):Promise<number>;close():Promise<number>;on(event:'exit',cb:(code:number)=>void):void;
}
export declare class TerminalPilot{
 static launch():Promise<TerminalPilot>;newSession(opts:NewSessionOptions):Promise<TerminalSession>;
 getSession(id:string):TerminalSession;deleteSession(id:string):void;sessions():TerminalSession[];close():Promise<void>;
}
