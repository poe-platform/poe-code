import {excluded} from './printable-ranges.js';

export function isPythonPrintable(point:number):boolean {let low=0,high=excluded.length/2;while(low<high){const middle=(low+high)>>>1;if(point<excluded[middle*2]!)high=middle;else if(point>excluded[middle*2+1]!)low=middle+1;else return false;}return true;}
