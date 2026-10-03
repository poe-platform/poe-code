import {createHash} from "node:crypto";
import {expect,test} from "vitest";
import * as svg from "./svg-pdf.js";

const picture=`<svg width="48" height="36" viewBox="-2 -3 48 36">
<rect width="40" height="30" fill="blue" opacity="0.4" rx="3"/>
<g transform="translate(3 1) rotate(12 10 10)"><circle cx="12" cy="12" r="8" fill="red" stroke="green" stroke-width="2"/>
<ellipse cx="25" cy="9" rx="6" ry="3" fill="none" stroke="purple"/>
<path d="M 2 20 l 5 -4 h 4 v 8 C 15 20 20 12 22 20 Q 28 28 32 19 z" fill="yellow" opacity="0.6" stroke="black"/>
<polyline points="1,1 12,4 14,8" fill="none" stroke="cyan"/></g>
<polygon points="1 25,8 24,4 32" fill="white"/><line x1="3" y1="2" x2="18" y2="14" stroke="red"/>
<text x="24" y="30" font-size="10" text-anchor="middle">A&amp;g</text></svg>`;

test("preserves established SVG shape, alpha, text and transform pixels",()=>{
 const image=svg.decodeSvgImage(new TextEncoder().encode(picture));
 expect(createHash("sha256").update(image.data).digest("hex")).toMatchInlineSnapshot(`"d1334eea257452b8e9d7604cd3584fab5adebb7529f898cbdc1652a14b8f49bf"`);
});

test("starts and stops a large SVG raster without allocating its canvas",()=>{
 const bytes=new TextEncoder().encode('<svg width="100000" height="100000"><rect width="100000" height="100000" fill="red"/></svg>');
 const steps=svg.svgRasterSteps(bytes);
 expect(steps.next()).toEqual({done:false,value:[0,0,255,0,0,255]});
 expect(steps.next()).toEqual({done:false,value:[1,0,255,0,0,255]});
 expect(steps.return()).toEqual({done:true,value:undefined});
});
