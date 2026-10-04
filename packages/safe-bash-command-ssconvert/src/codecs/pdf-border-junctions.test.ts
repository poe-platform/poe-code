import {expect, it} from "vitest";
import {printBorderRow} from "@poe-code/spreadsheet-engine/rendering/print/border-junctions";
const red = (style: number) => ({style, color: [1, 0, 0] as const, alpha: 1});
it("matches independent native double-border corner strokes", () => {
  const border = red(6), vertical = [undefined, border, border, undefined, undefined];
  const lines = printBorderRow({top: [undefined, border], bottom: [undefined, border], vertical, previous: [], widths: [48,48,48,48], y: 20, height: 20}, () => {});
  expect(lines.map(({x1,y1,x2,y2}) => [x1,y1,x2,y2])).toEqual([
    [47,19.5,98,19.5], [49,21.5,96,21.5],
    [47.5,19,47.5,42], [49.5,21,49.5,40],
    [95.5,21,95.5,40], [97.5,19,97.5,42]
  ]);
  const bottom = printBorderRow({top: [undefined,border], bottom: [], vertical: [], previous: vertical, widths: [48,48,48,48], y: 40, height: 0, last: true}, () => {});
  expect(bottom.map(({x1,y1,x2,y2}) => [x1,y1,x2,y2])).toEqual([[49,39.5,96,39.5],[47,41.5,98,41.5]]);
});
it.each([1,2,3,4,5,7,8,9,10,11,12,13])("keeps native junction clearances for border style %s", style => {
  const border=red(style), width=[0,1,2,1,1,3,1,1,2,1,2,1,2,2][style]!;
  const lines=printBorderRow({top:[undefined,border],bottom:[undefined,border],vertical:[undefined,border,border],previous:[],widths:[48,48,48,48],y:20,height:20},()=>{});
  const begin=width>1?1:0,end=width>2?1:0,offset=width%2?0.5:0;
  expect(lines.map(({x1,y1,x2,y2})=>[x1,y1,x2,y2])).toEqual([
    [48-begin,20+offset,97+end,20+offset],
    [48+offset,21+end,48+offset,40-begin],
    [96+offset,21+end,96+offset,40-begin]
  ]);
});

it("retains native recycled terminal margins on the final double-grid row", async () => {
  const {printSharedBorders} = await import("@poe-code/spreadsheet-engine/rendering/print/shared-borders");
  const border = red(6);
  const lines = printSharedBorders({startRow:0,endRow:3,startColumn:0,endColumn:3}, {
    borders: () => (["Top","Bottom","Left","Right"] as const).map(side => ({...border,side})),
    column: index => ({start:index*48,size:48}), row: index => ({start:index*20,size:20}),
    hiddenRows:new Set(),hiddenColumns:new Set(),merges:[],spans:new Map()
  }, () => {});
  expect(lines.at(-1)).toMatchObject({x1:143,y1:81.5,x2:192,y2:81.5});
});
