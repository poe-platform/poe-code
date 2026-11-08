import {expect,it} from 'vitest';
import {decodeChartContent} from './chart-values.js';
import {parseDocumentXml} from './package-xml.js';
import {DocumentBudget} from './budget.js';
import {chartSpace,series} from '../tests/fixtures/charts.js';
const decode=(source:string)=>decodeChartContent(parseDocumentXml(new TextEncoder().encode(source)).root,'/word/charts/plot.xml',new DocumentBudget());
it.each([false,true])('retains mixed native groups and raw metadata in dialect %s',strict=>{
 const result=decode(chartSpace('<c:barChart>'+series()+'</c:barChart><c:lineChart>'+series('Hill','2e3')+'</c:lineChart><c:barChart/>',strict));
 expect(result.status).toBe('decoded');expect(result.chartTypes).toEqual(['barChart','lineChart','barChart']);expect(result.chartType).toBe(null);
 expect(result.series.map(s=>[s.group,s.indices,s.orders,s.name,s.cachedValues])).toEqual([[0,['0'],['0'],'Coast',['1.00']],[1,['0'],['0'],'Hill',['2e3']]]);
});
it('retains sparse duplicate and malformed points without holes or numeric coercion',()=>{
 const source=series().replace('<c:ptCount val="1"/><c:pt idx="0"><c:v>1.00</c:v></c:pt>','<c:ptCount val="999999999999999999999"/><c:ptCount val="4"/><c:pt idx="2"><c:v>9007199254740993</c:v></c:pt><c:pt idx="0"><c:v/></c:pt><c:pt idx="2"/><c:pt idx="bad"><c:v>1e999</c:v></c:pt>');
 const s=decode(chartSpace('<c:barChart>'+source+'</c:barChart>')).series[0]!;
 expect(s.cachedValues).toEqual(['9007199254740993','',null,'1e999']);
 const cache=s.sources.find(x=>x.role==='value')!.caches[0]!;expect(cache.counts).toEqual(['999999999999999999999','4']);expect(cache.points.map(p=>p.index)).toEqual(['2','0','2','bad']);expect(cache.issues.length+cache.points.reduce((n,p)=>n+p.issues.length,0)).toBeGreaterThan(0);
});
it('projects literal and referenced labels only with exact index-zero cardinality',()=>{
 const label='<c:tx><c:strRef><c:f>Sheet1!A2</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Peak</c:v></c:pt></c:strCache></c:strRef></c:tx>';
 const native=series().replace('<c:tx><c:v>Coast</c:v></c:tx>',label);
 const good=decode(chartSpace('<c:barChart>'+native+'</c:barChart>')).series[0]!;expect(good.name).toBe('Peak');expect(good.label.provenance).toBe('cached');expect(good.sources[0]!.formulas).toEqual(['Sheet1!A2']);
 const bad=decode(chartSpace('<c:barChart>'+native.replace('idx="0"><c:v>Peak','idx="1"><c:v>Peak')+'</c:barChart>')).series[0]!;expect(bad.name).toBe(null);expect(bad.issues.length).toBeGreaterThan(0);
});
it('keeps literal numeric values distinct from reference caches',()=>{
 const literal=series().replace('<c:numRef><c:f>Sheet1!B2</c:f><c:numCache>','<c:numLit>').replace('</c:numCache></c:numRef>','</c:numLit>');
 const s=decode(chartSpace('<c:barChart>'+literal+'</c:barChart>')).series[0]!;
 expect(s.cachedValues).toEqual([]);expect(s.sources[1]!.kind).toBe('literal');expect(s.sources[1]!.caches[0]!).toMatchObject({cached:false,freshness:null});
});
it('uses y values for scatter and bubble and keeps all source roles',()=>{
 const body=series().replace('<c:val>','<c:yVal>').replace('</c:val>','</c:yVal>')+'<c:ser><c:xVal><c:numLit><c:pt idx="0"><c:v>3</c:v></c:pt></c:numLit></c:xVal><c:yVal><c:numRef><c:numCache><c:pt idx="0"><c:v>5</c:v></c:pt></c:numCache></c:numRef></c:yVal><c:bubbleSize><c:numLit><c:pt idx="0"><c:v>7</c:v></c:pt></c:numLit></c:bubbleSize></c:ser>';
 const result=decode(chartSpace('<c:scatterChart>'+body+'</c:scatterChart>'));expect(result.series.map(s=>s.cachedValues)).toEqual([['1.00'],['5']]);expect(result.series[1]!.sources.map(s=>s.role)).toEqual(['x','y','bubble']);
});
it('retains multilevel categories and malformed duplicate values',()=>{
 const body='<c:ser><c:cat><c:multiLvlStrRef><c:f>Sheet1!A2:A3</c:f><c:multiLvlStrCache><c:ptCount val="2"/><c:lvl><c:pt idx="0"><c:v>North</c:v></c:pt></c:lvl><c:lvl><c:pt idx="0"><c:v/><c:v>South</c:v></c:pt></c:lvl></c:multiLvlStrCache></c:multiLvlStrRef></c:cat></c:ser>';
 const s=decode(chartSpace('<c:barChart>'+body+'</c:barChart>')).series[0]!,cache=s.sources[0]!.caches[0]!;expect(cache.kind).toBe('multilevel-string');expect(cache.levels.map(l=>l.points[0]!.values)).toEqual([['North'],['','South']]);
});
it('does not confer chart authority through foreign or native formatting wrappers',()=>{
 for(const wrapper of ['<x:payload xmlns:x="urn:foreign">','<c:spPr>']){const close=wrapper.startsWith('<x:')?'</x:payload>':'</c:spPr>';const result=decode(chartSpace(wrapper+'<c:barChart>'+series()+'</c:barChart>'+close));expect(result.status).toBe('opaque');expect(result.series).toEqual([]);expect(result.issues.length).toBeGreaterThan(0);}
});
it('honors current MCE branch choices without understanding chart extensions',()=>{
 const source=chartSpace('<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="x" xmlns:x="urn:foreign"><c:barChart>'+series('Inactive')+'</c:barChart></mc:Choice><mc:Fallback><c:lineChart>'+series('Active')+'</c:lineChart></mc:Fallback></mc:AlternateContent>');
 const result=decode(source);expect(result.chartTypes).toEqual(['lineChart']);expect(result.series[0]!.name).toBe('Active');
});
it('does not expose inherited object members as stored source roles',()=>{
 const result=decode(chartSpace('<c:barChart><c:ser><c:constructor><c:numRef><c:numCache/></c:numRef></c:constructor></c:ser></c:barChart>'));
 expect(result.series[0]!.sources).toEqual([]);
});
it.each(['areaChart','area3DChart','lineChart','line3DChart','stockChart','radarChart','scatterChart','pieChart','pie3DChart','doughnutChart','barChart','bar3DChart','ofPieChart','surfaceChart','surface3DChart','bubbleChart'])('recognizes the exact bounded native %s group',type=>{
 expect(decode(chartSpace('<c:'+type+'/>')).chartType).toBe(type);
 expect(decode(chartSpace('<c:'+type+'/>',true)).chartType).toBe(type);
});
it('retains absent empty duplicate and foreign values with qualified projection',()=>{
 const source=series().replace('<c:pt idx="0"><c:v>1.00</c:v></c:pt>','<c:pt idx="0"><c:v/></c:pt><c:pt idx="1"/><c:pt idx="2"><c:v>one</c:v><c:v>two</c:v></c:pt><c:pt idx="3"><x:v xmlns:x="urn:foreign">opaque</x:v></c:pt>');
 const s=decode(chartSpace('<c:barChart>'+source+'</c:barChart>')).series[0]!;
 expect(s.cachedValues).toEqual(['',null,null,null]);expect(s.sources[1]!.caches[0]!.points.map(p=>p.values)).toEqual([[''],[],['one','two'],[null]]);
});
it('retains ambiguous primary source and cache declarations instead of projecting the first',()=>{
 for(const body of [series().replace('</c:val>','</c:val><c:val><c:numRef><c:numCache/></c:numRef></c:val>'),series().replace('</c:numRef>','<c:numCache><c:pt idx="0"><c:v>9</c:v></c:pt></c:numCache></c:numRef>')]){const s=decode(chartSpace('<c:barChart>'+body+'</c:barChart>')).series[0]!;expect(s.cachedValues).toEqual([]);expect(s.issues.some(i=>i.code==='ambiguous-primary-cache')).toBe(true);}
});

it.each(['tx','val','yVal'])('retains empty duplicate %s declarations and rejects compact projection',role=>{
 const body=(role==='yVal'?series().replace('<c:val>','<c:yVal>').replace('</c:val>','</c:yVal>'):series()).replace('</c:'+role+'>','</c:'+role+'><c:'+role+'/>');
 const s=decode(chartSpace('<c:'+(role==='yVal'?'scatterChart':'barChart')+'>'+body+'</c:'+(role==='yVal'?'scatterChart':'barChart')+'>')).series[0]!;
 const sources=s.sources.filter(source=>source.role===(role==='tx'?'label':role==='val'?'value':'y'));
 expect(sources).toHaveLength(2);expect(sources[1]!).toMatchObject({localName:role,kind:'opaque',literals:[],formulas:[],caches:[]});expect(sources[1]!.issues.length).toBeGreaterThan(0);
 if(role==='tx'){expect(s.name).toBe(null);expect(s.label.provenance).toBe('ambiguous');expect(s.issues.some(i=>i.code==='ambiguous-label')).toBe(true);}else{expect(s.cachedValues).toEqual([]);expect(s.issues.some(i=>i.code==='ambiguous-primary-cache')).toBe(true);}
});
it('retains missing auto-update scalar with a located bounded issue',()=>{
 const result=decode(chartSpace('<c:barChart/>',false,'<c:externalData><c:autoUpdate/><c:autoUpdate val=""/><c:autoUpdate val="1"/></c:externalData>'));
 expect(result.externalData[0]!.autoUpdate).toEqual([null,'','1']);expect(result.issues.some(i=>i.code==='opaque-value'&&i.path.length>0)).toBe(true);
});
