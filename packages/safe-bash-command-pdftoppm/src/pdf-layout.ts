import type {PdfRect} from '@poe-code/pdf-ast';
import type {PdftocairoPlan} from './parse.js';

export function cairoPdfLayout(plan:PdftocairoPlan,mediaBox:PdfRect,rotation:number){
 const width=Math.abs(mediaBox[2]-mediaBox[0]),height=Math.abs(mediaBox[3]-mediaBox[1]);
 const paper=!plan.origPageSizes&&plan.paperW>0&&plan.paperH>0;
 if(!paper&&!plan.hasCrop)return undefined;
 const pageW=paper?(width>height?plan.paperH:plan.paperW):width;
 const pageH=paper?(width>height?plan.paperW:plan.paperH):height;
 const sideways=rotation===90||rotation===270;
 const displayW=sideways?height:width,displayH=sideways?width:height;
 // Cairo's vector crop is in points, independent of raster resolution.
 const cropW=plan.cropW||Math.max(1,displayW-plan.cropX),cropH=plan.cropH||Math.max(1,displayH-plan.cropY);
 const w=sideways?cropH:cropW,h=sideways?cropW:cropH;
 let x=plan.cropX,y=height-plan.cropY-h;
 if(rotation===90){x=plan.cropY;y=plan.cropX;}
 else if(rotation===180){x=width-plan.cropX-w;y=plan.cropY;}
 else if(rotation===270){x=width-plan.cropY-w;y=height-plan.cropX-h;}
 x+=mediaBox[0];y+=mediaBox[1];
 const scale=Math.min(1,pageW/w,pageH/h),tx=(pageW-w*scale)/2-x*scale,ty=(pageH-h*scale)/2-y*scale;
 const box:PdfRect=[0,0,pageW,pageH];
 const contentWrapper:readonly[string,string]=[`q\n${scale} 0 0 ${scale} ${tx} ${ty} cm\n${x} ${y} ${w} ${h} re W n\n`,'\nQ\n'];
 return {mediaBox:box,cropBox:box,contentWrapper};
}
