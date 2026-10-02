import type {ScreenSurface as ScreenBuffer} from './screen.js';
import type {ExplorerLayout} from './explorer-layout.js';
import type {ExplorerState,Row} from './explorer-state.js';
export declare function renderList(state:ExplorerState,screen:ScreenBuffer,layout:ExplorerLayout):void;
export type DisplayLine={kind:'group';label:string}|{kind:'row';rowIndex:number;row:Row;cursor:boolean}|{kind:'subtitle';row:Row;text:string};
export declare function visibleStart(lines:DisplayLine[],height:number,scrolloff?:number):number;
