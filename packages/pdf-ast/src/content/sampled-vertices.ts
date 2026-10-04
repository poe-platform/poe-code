/** Depth-first cube traversal preserves the prior expansion/summation order,
 * while retaining one frame per input axis instead of all cube vertices. */
export function* sampledVertices(size:readonly number[],domain:readonly number[],encode:readonly number[],inputs:readonly number[],sampleCount:number):Generator<{index:number;weight:number}>{
 const dimensions=Math.max(1,size.length),axes:Array<{low:number;fraction:number;stride:number}>=[];
 let stride=1;
 for(let i=0;i<dimensions;i++){
  const d0=domain[i*2]??0,d1=domain[i*2+1]??1,maximum=Math.max(0,(size[i]??2)-1);
  const start=encode[i*2]??0,end=encode[i*2+1]??maximum,x=Math.max(d0,Math.min(d1,inputs[i]??0));
  const u=d1===d0?0:(x-d0)/(d1-d0),e=Math.max(0,Math.min(maximum,start+u*(end-start))),low=Math.floor(e);
  axes.push({low,fraction:e-low,stride});stride*=size[i]??2;
 }
 const choices=new Uint8Array(dimensions),indices=new Float64Array(dimensions+1),weights=new Float64Array(dimensions+1);
 weights[0]=1;let depth=0;
 while(depth>=0){
  if(depth===dimensions){yield {index:indices[depth]!,weight:weights[depth]!};depth--;continue;}
  const axis=axes[depth]!,choice=choices[depth]!;
  if(choice===2){depth--;continue;}
  choices[depth]=choice+1;
  if(choice===1&&!axis.fraction)continue;
  const base=indices[depth]!+axis.low*axis.stride,index=choice?base+axis.stride:base;
  if(!(index<sampleCount))continue;
  indices[depth+1]=index;weights[depth+1]=weights[depth]!*(choice?axis.fraction:1-axis.fraction);
  depth++;if(depth<dimensions)choices[depth]=0;
 }
}
