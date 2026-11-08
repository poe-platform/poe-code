import {expect,test} from "vitest";
import * as renderer from "./svg-renderer.js";

test("rasterizes caller-owned polygon points through bounded requests",()=>{
 const steps=renderer.rasterSvgElement({tag:'polygon',attrs:{fill:'red'},matrix:[1,0,0,1,0,0],pointCount:3,closed:false,textLength:0},{width:4,height:4,vbW:4,vbH:4});
 const points:readonly (readonly [number,number])[]=[[0,0],[4,0],[0,4]],pixels:unknown[]=[];let next=steps.next(),reads=0;
 while(!next.done){const event=next.value;if(event&&'kind'in event){expect(event.kind).toBe('point');reads++;next=steps.next(points[event.index]);}else{if(event)pixels.push(event);next=steps.next();}}
 expect(reads).toBeGreaterThan(3);expect(pixels).toEqual([[0,0,255,0,0,255],[1,0,255,0,0,255],[2,0,255,0,0,255],[0,1,255,0,0,255],[1,1,255,0,0,255],[0,2,255,0,0,255]]);
});

test("reads text characters only as they are drawn",()=>{
 const steps=renderer.rasterSvgElement({tag:'text',attrs:{fill:'black',y:'8'},matrix:[1,0,0,1,0,0],pointCount:0,closed:false,textLength:1000000},{width:4,height:8,vbW:4,vbH:8});
 expect(steps.next()).toEqual({done:false,value:{kind:'character',index:0}});
 expect(steps.next(65).done).toBe(false);steps.return();
});
