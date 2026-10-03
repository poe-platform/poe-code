export function blurKernel(sigma:number,minAmplitude:number,precision:"integer"|"float"|"approximate"):{radius:number;weights:Float64Array|Int32Array;shift:number;half:number} {
  const twoSigmaSq=2*sigma*sigma;
  let rIdx=0;
  while(rIdx<5000 && Math.exp(-(rIdx*rIdx)/twoSigmaSq)>=minAmplitude) rIdx++;
  const radius=Math.max(1,rIdx)-1;
  if(radius<=0) return {radius,weights:new Float64Array(),shift:0,half:0};
  const size=radius*2+1,kernel=new Float64Array(size);let sum=0;
  for(let i=-radius;i<=radius;i++) {const raw=Math.exp(-(i*i)/twoSigmaSq),weight=precision==="float"?raw:Math.round(20*raw);kernel[i+radius]=weight;sum+=weight;}
  if(precision==="float") {for(let i=0;i<size;i++) kernel[i]!/=sum;return {radius,weights:kernel,shift:0,half:0};}
  let max=0;for(const weight of kernel) if(weight>max) max=weight;
  const shift=7-Math.ceil(Math.log2(max/sum)+1),scale=1<<shift,half=1<<(shift-1),weights=new Int32Array(size);
  for(let i=0;i<size;i++) weights[i]=Math.round(kernel[i]!/sum*scale);
  return {radius,weights,shift,half};
}

export function blurFloatPixel(r:number,g:number,b:number,a:number,premultiplied:boolean,useAlpha:boolean):number {
  r=Math.fround(r);g=Math.fround(g);b=Math.fround(b);a=Math.fround(a);
  if(!premultiplied && useAlpha) {
    if(a===0) return 0;
    const factor=Math.fround(255/a);
    r=Math.fround(factor*r);g=Math.fround(factor*g);b=Math.fround(factor*b);
  }
  const byte=(value:number)=>Math.max(0,Math.min(255,Math.trunc(value)));
  return byte(r) | byte(g)<<8 | byte(b)<<16 | (premultiplied || useAlpha?byte(a):255)<<24;
}
