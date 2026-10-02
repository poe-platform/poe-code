import {createRequire} from "node:module";
import {callNative,protect} from "./host-errors.js";
const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){if(depth>=128)throw new RangeError("Maximum call stack size exceeded");depth++;try{return callNative(native.suggestionPolicy,operation,args,host);}finally{depth--;}}
const operations={
  empty:()=>[],zero:()=>0,one:()=>1,three:()=>3,isZero:value=>value===0,
  defaultThreshold:input=>Math.max(1,Math.floor(input.length/4)),
  rank:(input,candidates,max,threshold)=>candidates
    .map(candidate=>({candidate,distance:invoke("distance",[input,candidate])}))
    .filter(({distance})=>distance<=threshold)
    .sort((left,right)=>invoke("compare",[left,right]))
    .slice(0,max)
    .map(({candidate})=>candidate),
  distanceDifference:(left,right)=>left.distance-right.distance,
  compareCandidates:(left,right)=>left.candidate.localeCompare(right.candidate),
  matrix:(left,right)=>Array.from({length:left.length+1},()=>Array.from({length:right.length+1},()=>0)),
  rowMore:(row,left)=>row<=left.length,columnMore:(column,right)=>column<=right.length,
  increment:value=>value+1,
  setRow:(distances,row)=>{distances[row][0]=row;},setColumn:(distances,column)=>{distances[0][column]=column;},
  equalCell:(left,right,row,column)=>left[row-1]===right[column-1],
  deletion:(distances,row,column)=>distances[row-1][column]+1,
  insertion:(distances,row,column)=>distances[row][column-1]+1,
  substitution:(distances,row,column,cost)=>distances[row-1][column-1]+cost,
  assignMinimum:(distances,row,column,deletion,insertion,substitution)=>{distances[row][column]=Math.min(deletion,insertion,substitution);},
  pastOne:value=>value>1,
  transposeFirst:(left,right,row,column)=>left[row-1]===right[column-2],
  transposeSecond:(left,right,row,column)=>left[row-2]===right[column-1],
  transposeMinimum:(distances,row,column)=>{distances[row][column]=Math.min(distances[row][column],distances[row-2][column-2]+1);},
  result:(distances,left,right)=>distances[left.length][right.length],
  invalidOperation(){throw new TypeError("Invalid suggestion operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};
export function suggest(input,candidates,opts={}){return invoke("suggest",[input,candidates,opts]);}
