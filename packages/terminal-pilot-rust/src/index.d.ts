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
