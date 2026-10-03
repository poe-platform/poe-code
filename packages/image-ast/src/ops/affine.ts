import type {RgbaColor} from "../ast.js";
export interface AffineSpec {
 readonly matrix:readonly[number,number,number,number];readonly background:RgbaColor;
 readonly idx?:number;readonly idy?:number;readonly odx?:number;readonly ody?:number;readonly interpolator?:string;
}
export function normalizedRotation(angle:number):number {
 const norm=((angle%360)+360)%360;
 for(const right of [0,90,180,270]) if(Math.abs(norm-right)<1e-6) return right;
 return norm;
}

/** A fixed 16-sample footprint shared by buffered and caller-backed transforms. */
export class AffineSampler {
 readonly positions=new Float64Array(16);
 private readonly weights=new Float64Array(16);
 readonly width:number;readonly height:number;readonly identity:boolean;
 private readonly det:number;private readonly minX:number;private readonly minY:number;
 private count=0;private outside=false;private r=0;private g=0;private b=0;private alpha=0;
 constructor(private readonly sourceWidth:number,private readonly sourceHeight:number,private readonly spec:AffineSpec) {
  const [a,b,c,d]=spec.matrix;this.det=a*d-b*c;this.identity=Math.abs(this.det)<1e-8;
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const [cx,cy] of [[0,0],[sourceWidth,0],[0,sourceHeight],[sourceWidth,sourceHeight]]) {
   const x=a*cx!+b*cy!,y=c*cx!+d*cy!;
   minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
  }
  this.width=this.identity?sourceWidth:Math.max(1,Math.round(maxX-minX));
  this.height=this.identity?sourceHeight:Math.max(1,Math.round(maxY-minY));
  this.minX=Math.round(minX);this.minY=Math.round(minY);
  if(!Number.isSafeInteger(this.width*this.height*4) || this.width<=0 || this.height<=0) throw new RangeError("Invalid affine output dimensions");
 }
 prepare(x:number,y:number):number {
  this.count=0;this.r=0;this.g=0;this.b=0;this.alpha=0;
  const [a,b,c,d]=this.spec.matrix,ox=x+this.minX-(this.spec.odx??0),oy=y+this.minY-(this.spec.ody??0);
  const sx=(d*ox-b*oy)/this.det-(this.spec.idx??0),sy=(-c*ox+a*oy)/this.det-(this.spec.idy??0);
  this.outside=sx<=-1 || sx>=this.sourceWidth || sy<=-1 || sy>=this.sourceHeight;
  if(this.outside) return 0;
  const x0=Math.floor(sx),y0=Math.floor(sy);
  if(this.spec.interpolator==="nearest") this.sample(x0,y0,1);
  else if(this.spec.interpolator==="bicubic") {
   const catmull=(v:number):number=>{const av=Math.abs(v);return av<1?1.5*av*av*av-2.5*av*av+1:av<2?-0.5*av*av*av+2.5*av*av-4*av+2:0;};
   for(let ky=-1;ky<=2;ky++) {const wy=catmull(sy-(y0+ky));for(let kx=-1;kx<=2;kx++) this.sample(x0+kx,y0+ky,wy*catmull(sx-(x0+kx)));}
  } else {
   const fx=sx-x0,fy=sy-y0;
   this.sample(x0,y0,(1-fx)*(1-fy));this.sample(x0+1,y0,fx*(1-fy));this.sample(x0,y0+1,(1-fx)*fy);this.sample(x0+1,y0+1,fx*fy);
  }
  return this.count;
 }
 private sample(x:number,y:number,weight:number):void {
  this.positions[this.count]=x<0 || x>=this.sourceWidth || y<0 || y>=this.sourceHeight?-1:y*this.sourceWidth+x;
  this.weights[this.count++]=weight;
 }
 add(pixel:number,index:number):void {
  const background=this.spec.background,missing=this.positions[index]===-1;
  const a=missing?background.a:pixel>>>24,r=missing?background.r:pixel&255,g=missing?background.g:pixel>>>8&255,b=missing?background.b:pixel>>>16&255,w=this.weights[index]!;
  this.r+=(r*a)/255*w;this.g+=(g*a)/255*w;this.b+=(b*a)/255*w;this.alpha+=a*w;
 }
 pixel():number {
  const byte=(value:number)=>Math.max(0,Math.min(255,Math.round(value)));
  if(this.outside) {
   const {r,g,b,a}=this.spec.background;if(a<=0) return 0;
   const factor=Math.fround(255/a),channel=(value:number)=>Math.max(0,Math.min(255,Math.trunc(Math.fround(factor*value))));
   return channel(r)|channel(g)<<8|channel(b)<<16|(a&255)<<24;
  }
  const a=this.alpha;
  return (a>0?byte(this.r*255/a):0)|(a>0?byte(this.g*255/a):0)<<8|(a>0?byte(this.b*255/a):0)<<16|byte(a)<<24;
 }
}
