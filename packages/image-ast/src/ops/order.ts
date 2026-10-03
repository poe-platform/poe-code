import type {ImageAstNode} from "../ast.js";

const postStageRank: Record<string, number> = {
  extend: 10,
  median: 20,
  threshold: 30,
  dilate: 40,
  erode: 50,
  blur: 60,
  unflatten: 70,
  convolve: 80,
  recomb: 90,
  modulate: 100,
  sharpen: 110,
  composite: 120,
  gamma: 130,
  linear: 140,
  normalize: 150,
  clahe: 160,
  negate: 170,
  tint: 180,
  grayscale: 190,
  toColorspace: 200,
  bandbool: 210,
  boolean: 220,
  joinChannel: 230,
  extractChannel: 240,
  withMetadata: 250
};

export function orderImageNodes<Node extends ImageAstNode>(nodes:readonly Node[]):Node[] {
  const pre=nodes.filter(node=>!(node.kind in postStageRank));
  const post=nodes.filter(node=>node.kind in postStageRank).sort((a,b)=>postStageRank[a.kind]!-postStageRank[b.kind]!);
  return [...pre,...post];
}

/** Right-angle transforms after resize run after scaling but before crop/embed. */
export function splitPostScaleNodes<Node extends ImageAstNode>(nodes:readonly Node[]):{nodes:Node[];postScale:Node[]} {
  const resize=nodes.findIndex(node=>node.kind==="resize");
  const before:Node[]=[],postScale:Node[]=[];
  for(let i=0;i<nodes.length;i++) {
    const node=nodes[i]!;
    if(resize!==-1 && i>resize && (node.kind==="flip" || node.kind==="flop" || node.kind==="rotate" && node.angle%90===0)) postScale.push(node);
    else before.push(node);
  }
  return {nodes:before,postScale};
}
