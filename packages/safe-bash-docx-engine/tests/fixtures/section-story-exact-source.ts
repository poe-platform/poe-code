export type SectionStorySourceCase = Readonly<{
 row:number; kind:"header"|"footer"; variant:"default"|"first"|"even";
 existing:boolean; action:"link"|"set"|"part"|"element"|"prior"|"initial";
 value?:boolean; id?:string;
}>;
export const sectionStorySourceCases:readonly SectionStorySourceCase[]=[
 {row:941,kind:"header",variant:"default",existing:false,action:"link"},
 {row:942,kind:"header",variant:"default",existing:true,action:"link"},
 {row:943,kind:"header",variant:"default",existing:false,action:"set",value:true},
 {row:944,kind:"header",variant:"default",existing:true,action:"set",value:false},
 {row:945,kind:"header",variant:"default",existing:true,action:"set",value:true},
 {row:946,kind:"header",variant:"default",existing:false,action:"set",value:false},
 {row:947,kind:"header",variant:"default",existing:false,action:"part"},
 {row:948,kind:"header",variant:"default",existing:false,action:"element"},
 {row:949,kind:"header",variant:"default",existing:true,action:"part"},
 {row:950,kind:"header",variant:"default",existing:true,action:"prior"},
 {row:951,kind:"header",variant:"default",existing:false,action:"part"},
 {row:952,kind:"footer",variant:"default",existing:false,action:"set",value:false,id:"rId3"},
 {row:953,kind:"footer",variant:"even",existing:true,action:"part",id:"rId3"},
 {row:954,kind:"footer",variant:"first",existing:true,action:"set",value:true,id:"rId42"},
 {row:955,kind:"footer",variant:"default",existing:false,action:"link"},
 {row:956,kind:"footer",variant:"default",existing:true,action:"link",id:"rId3"},
 {row:957,kind:"footer",variant:"even",existing:true,action:"prior"},
 {row:958,kind:"footer",variant:"default",existing:false,action:"initial"},
 {row:959,kind:"header",variant:"first",existing:false,action:"set",value:false,id:"rId3"},
 {row:960,kind:"header",variant:"default",existing:true,action:"part",id:"rId8"},
 {row:961,kind:"header",variant:"even",existing:true,action:"set",value:true,id:"rId42"},
 {row:962,kind:"header",variant:"first",existing:false,action:"link"},
 {row:963,kind:"header",variant:"first",existing:true,action:"link",id:"rId3"},
 {row:964,kind:"header",variant:"default",existing:true,action:"prior"},
 {row:965,kind:"header",variant:"default",existing:false,action:"initial"}
];
