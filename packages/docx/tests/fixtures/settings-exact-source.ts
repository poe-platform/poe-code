export const settingsSourceCases=[
 {row:966,initial:"",expected:false},
 {row:967,initial:"<w:evenAndOddHeaders/>",expected:true},
 {row:968,initial:'<w:evenAndOddHeaders w:val="0"/>',expected:false},
 {row:969,initial:'<w:evenAndOddHeaders w:val="1"/>',expected:true},
 {row:970,initial:'<w:evenAndOddHeaders w:val="true"/>',expected:true},
 {row:971,initial:"",value:true,expected:true},
 {row:972,initial:"<w:evenAndOddHeaders/>",value:false,expected:false},
 {row:973,initial:'<w:evenAndOddHeaders w:val="1"/>',value:true,expected:true},
 {row:974,initial:'<w:evenAndOddHeaders w:val="off"/>',value:false,expected:false}
] as const;
