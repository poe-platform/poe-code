import {expect,it} from "vitest";
import type {PdfDisplayList} from "../ast.js";
import {renderDisplayListWindowSteps} from "./raster.js";

it("renders a highly subdivided round stroke without retaining its generated outline",()=>{
 const list:PdfDisplayList={pageIndex:0,width:16,height:16,rotation:0,glyphs:[],images:[],annotations:[],paths:[{
  segments:[{kind:"move",x:0,y:8},{kind:"line",x:16,y:8}],strokeWidth:1000000,lineCap:1,strokeColor:{r:0,g:0,b:1},
 }]};
 const original=Array.prototype.push;
 Array.prototype.push=function(this:unknown[],...items:unknown[]){if(this.length+items.length>1024)throw Error("collected stroke outline");return original.apply(this,items);};
 let pixels:Uint8Array|undefined;
 try{const work=renderDisplayListWindowSteps(list,{x:2,y:3,width:7,height:9},{scale:1});let next=work.next();while(!next.done)next=work.next();pixels=next.value.data;}finally{Array.prototype.push=original;}
 expect(pixels).toEqual(Uint8Array.from({length:63*4},(_,i)=>i%4>=2?255:0));
});
