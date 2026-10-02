export const sectionPropertyCases = [
  {
    "row": 877,
    "member": "different_first_page_header_footer",
    "xml": "<w:sectPr/>",
    "expected": false
  },
  {
    "row": 878,
    "member": "different_first_page_header_footer",
    "xml": "<w:sectPr><w:titlePg/></w:sectPr>",
    "expected": true
  },
  {
    "row": 879,
    "member": "different_first_page_header_footer",
    "xml": "<w:sectPr><w:titlePg w:val=\"0\"/></w:sectPr>",
    "expected": false
  },
  {
    "row": 880,
    "member": "different_first_page_header_footer",
    "xml": "<w:sectPr><w:titlePg w:val=\"1\"/></w:sectPr>",
    "expected": true
  },
  {
    "row": 881,
    "member": "different_first_page_header_footer",
    "xml": "<w:sectPr><w:titlePg w:val=\"true\"/></w:sectPr>",
    "expected": true
  },
  {
    "row": 882,
    "member": "different_first_page_header_footer",
    "xml": "<w:sectPr/>",
    "value": true,
    "after": "<w:sectPr><w:titlePg/></w:sectPr>"
  },
  {
    "row": 883,
    "member": "different_first_page_header_footer",
    "xml": "<w:sectPr><w:titlePg/></w:sectPr>",
    "value": false,
    "after": "<w:sectPr/>"
  },
  {
    "row": 884,
    "member": "different_first_page_header_footer",
    "xml": "<w:sectPr><w:titlePg w:val=\"1\"/></w:sectPr>",
    "value": true,
    "after": "<w:sectPr><w:titlePg/></w:sectPr>"
  },
  {
    "row": 885,
    "member": "different_first_page_header_footer",
    "xml": "<w:sectPr><w:titlePg w:val=\"off\"/></w:sectPr>",
    "value": false,
    "after": "<w:sectPr/>"
  },
  {
    "row": 893,
    "member": "start_type",
    "xml": "<w:sectPr/>",
    "expected": {
      "enum": "WD_SECTION_START",
      "name": "NEW_PAGE"
    }
  },
  {
    "row": 894,
    "member": "start_type",
    "xml": "<w:sectPr><w:type/></w:sectPr>",
    "expected": {
      "enum": "WD_SECTION_START",
      "name": "NEW_PAGE"
    }
  },
  {
    "row": 895,
    "member": "start_type",
    "xml": "<w:sectPr><w:type w:val=\"continuous\"/></w:sectPr>",
    "expected": {
      "enum": "WD_SECTION_START",
      "name": "CONTINUOUS"
    }
  },
  {
    "row": 896,
    "member": "start_type",
    "xml": "<w:sectPr><w:type w:val=\"nextPage\"/></w:sectPr>",
    "expected": {
      "enum": "WD_SECTION_START",
      "name": "NEW_PAGE"
    }
  },
  {
    "row": 897,
    "member": "start_type",
    "xml": "<w:sectPr><w:type w:val=\"oddPage\"/></w:sectPr>",
    "expected": {
      "enum": "WD_SECTION_START",
      "name": "ODD_PAGE"
    }
  },
  {
    "row": 898,
    "member": "start_type",
    "xml": "<w:sectPr><w:type w:val=\"evenPage\"/></w:sectPr>",
    "expected": {
      "enum": "WD_SECTION_START",
      "name": "EVEN_PAGE"
    }
  },
  {
    "row": 899,
    "member": "start_type",
    "xml": "<w:sectPr><w:type w:val=\"nextColumn\"/></w:sectPr>",
    "expected": {
      "enum": "WD_SECTION_START",
      "name": "NEW_COLUMN"
    }
  },
  {
    "row": 900,
    "member": "start_type",
    "xml": "<w:sectPr><w:type w:val=\"oddPage\"/></w:sectPr>",
    "value": {
      "enum": "WD_SECTION_START",
      "name": "EVEN_PAGE"
    },
    "after": "<w:sectPr><w:type w:val=\"evenPage\"/></w:sectPr>"
  },
  {
    "row": 901,
    "member": "start_type",
    "xml": "<w:sectPr><w:type w:val=\"nextPage\"/></w:sectPr>",
    "value": null,
    "after": "<w:sectPr/>"
  },
  {
    "row": 902,
    "member": "start_type",
    "xml": "<w:sectPr/>",
    "value": null,
    "after": "<w:sectPr/>"
  },
  {
    "row": 903,
    "member": "start_type",
    "xml": "<w:sectPr><w:type w:val=\"continuous\"/></w:sectPr>",
    "value": {
      "enum": "WD_SECTION_START",
      "name": "NEW_PAGE"
    },
    "after": "<w:sectPr/>"
  },
  {
    "row": 904,
    "member": "start_type",
    "xml": "<w:sectPr><w:type/></w:sectPr>",
    "value": {
      "enum": "WD_SECTION_START",
      "name": "NEW_PAGE"
    },
    "after": "<w:sectPr/>"
  },
  {
    "row": 905,
    "member": "start_type",
    "xml": "<w:sectPr><w:type/></w:sectPr>",
    "value": {
      "enum": "WD_SECTION_START",
      "name": "NEW_COLUMN"
    },
    "after": "<w:sectPr><w:type w:val=\"nextColumn\"/></w:sectPr>"
  },
  {
    "row": 906,
    "member": "page_width",
    "xml": "<w:sectPr><w:pgSz w:w=\"1440\"/></w:sectPr>",
    "expected": {
      "value": 914400,
      "unit": "emu"
    }
  },
  {
    "row": 907,
    "member": "page_width",
    "xml": "<w:sectPr><w:pgSz/></w:sectPr>",
    "expected": null
  },
  {
    "row": 908,
    "member": "page_width",
    "xml": "<w:sectPr/>",
    "expected": null
  },
  {
    "row": 909,
    "member": "page_width",
    "xml": "<w:sectPr/>",
    "value": null,
    "after": "<w:sectPr><w:pgSz/></w:sectPr>"
  },
  {
    "row": 910,
    "member": "page_width",
    "xml": "<w:sectPr/>",
    "value": {
      "value": 3657600,
      "unit": "emu"
    },
    "after": "<w:sectPr><w:pgSz w:w=\"5760\"/></w:sectPr>"
  },
  {
    "row": 911,
    "member": "page_height",
    "xml": "<w:sectPr><w:pgSz w:h=\"2880\"/></w:sectPr>",
    "expected": {
      "value": 1828800,
      "unit": "emu"
    }
  },
  {
    "row": 912,
    "member": "page_height",
    "xml": "<w:sectPr><w:pgSz/></w:sectPr>",
    "expected": null
  },
  {
    "row": 913,
    "member": "page_height",
    "xml": "<w:sectPr/>",
    "expected": null
  },
  {
    "row": 914,
    "member": "page_height",
    "xml": "<w:sectPr/>",
    "value": null,
    "after": "<w:sectPr><w:pgSz/></w:sectPr>"
  },
  {
    "row": 915,
    "member": "page_height",
    "xml": "<w:sectPr/>",
    "value": {
      "value": 1828800,
      "unit": "emu"
    },
    "after": "<w:sectPr><w:pgSz w:h=\"2880\"/></w:sectPr>"
  },
  {
    "row": 916,
    "member": "orientation",
    "xml": "<w:sectPr><w:pgSz w:orient=\"landscape\"/></w:sectPr>",
    "expected": {
      "enum": "WD_ORIENTATION",
      "name": "LANDSCAPE"
    }
  },
  {
    "row": 917,
    "member": "orientation",
    "xml": "<w:sectPr><w:pgSz w:orient=\"portrait\"/></w:sectPr>",
    "expected": {
      "enum": "WD_ORIENTATION",
      "name": "PORTRAIT"
    }
  },
  {
    "row": 918,
    "member": "orientation",
    "xml": "<w:sectPr><w:pgSz/></w:sectPr>",
    "expected": {
      "enum": "WD_ORIENTATION",
      "name": "PORTRAIT"
    }
  },
  {
    "row": 919,
    "member": "orientation",
    "xml": "<w:sectPr/>",
    "expected": {
      "enum": "WD_ORIENTATION",
      "name": "PORTRAIT"
    }
  },
  {
    "row": 920,
    "member": "orientation",
    "xml": "<w:sectPr/>",
    "value": {
      "enum": "WD_ORIENTATION",
      "name": "LANDSCAPE"
    },
    "after": "<w:sectPr><w:pgSz w:orient=\"landscape\"/></w:sectPr>"
  },
  {
    "row": 921,
    "member": "orientation",
    "xml": "<w:sectPr/>",
    "value": {
      "enum": "WD_ORIENTATION",
      "name": "PORTRAIT"
    },
    "after": "<w:sectPr><w:pgSz/></w:sectPr>"
  },
  {
    "row": 922,
    "member": "orientation",
    "xml": "<w:sectPr/>",
    "value": null,
    "after": "<w:sectPr><w:pgSz/></w:sectPr>"
  },
  {
    "row": 923,
    "member": "left_margin",
    "xml": "<w:sectPr><w:pgMar w:left=\"120\"/></w:sectPr>",
    "expected": 76200
  },
  {
    "row": 924,
    "member": "right_margin",
    "xml": "<w:sectPr><w:pgMar w:right=\"240\"/></w:sectPr>",
    "expected": 152400
  },
  {
    "row": 925,
    "member": "top_margin",
    "xml": "<w:sectPr><w:pgMar w:top=\"-360\"/></w:sectPr>",
    "expected": -228600
  },
  {
    "row": 926,
    "member": "bottom_margin",
    "xml": "<w:sectPr><w:pgMar w:bottom=\"480\"/></w:sectPr>",
    "expected": 304800
  },
  {
    "row": 927,
    "member": "gutter",
    "xml": "<w:sectPr><w:pgMar w:gutter=\"600\"/></w:sectPr>",
    "expected": 381000
  },
  {
    "row": 928,
    "member": "header_distance",
    "xml": "<w:sectPr><w:pgMar w:header=\"720\"/></w:sectPr>",
    "expected": 457200
  },
  {
    "row": 929,
    "member": "footer_distance",
    "xml": "<w:sectPr><w:pgMar w:footer=\"840\"/></w:sectPr>",
    "expected": 533400
  },
  {
    "row": 930,
    "member": "left_margin",
    "xml": "<w:sectPr><w:pgMar/></w:sectPr>",
    "expected": null
  },
  {
    "row": 931,
    "member": "top_margin",
    "xml": "<w:sectPr/>",
    "expected": null
  },
  {
    "row": 932,
    "member": "left_margin",
    "xml": "<w:sectPr/>",
    "value": {
      "value": 914400,
      "unit": "emu"
    },
    "after": "<w:sectPr><w:pgMar w:left=\"1440\"/></w:sectPr>"
  },
  {
    "row": 933,
    "member": "right_margin",
    "xml": "<w:sectPr/>",
    "value": {
      "value": 457200,
      "unit": "emu"
    },
    "after": "<w:sectPr><w:pgMar w:right=\"720\"/></w:sectPr>"
  },
  {
    "row": 934,
    "member": "top_margin",
    "xml": "<w:sectPr/>",
    "value": {
      "value": -228600,
      "unit": "emu"
    },
    "after": "<w:sectPr><w:pgMar w:top=\"-360\"/></w:sectPr>"
  },
  {
    "row": 935,
    "member": "bottom_margin",
    "xml": "<w:sectPr/>",
    "value": {
      "value": 685800,
      "unit": "emu"
    },
    "after": "<w:sectPr><w:pgMar w:bottom=\"1080\"/></w:sectPr>"
  },
  {
    "row": 936,
    "member": "gutter",
    "xml": "<w:sectPr/>",
    "value": {
      "value": 228600,
      "unit": "emu"
    },
    "after": "<w:sectPr><w:pgMar w:gutter=\"360\"/></w:sectPr>"
  },
  {
    "row": 937,
    "member": "header_distance",
    "xml": "<w:sectPr/>",
    "value": {
      "value": 1143000,
      "unit": "emu"
    },
    "after": "<w:sectPr><w:pgMar w:header=\"1800\"/></w:sectPr>"
  },
  {
    "row": 938,
    "member": "footer_distance",
    "xml": "<w:sectPr/>",
    "value": {
      "value": 1234440,
      "unit": "emu"
    },
    "after": "<w:sectPr><w:pgMar w:footer=\"1944\"/></w:sectPr>"
  },
  {
    "row": 939,
    "member": "left_margin",
    "xml": "<w:sectPr/>",
    "value": null,
    "after": "<w:sectPr><w:pgMar/></w:sectPr>"
  },
  {
    "row": 940,
    "member": "top_margin",
    "xml": "<w:sectPr><w:pgMar w:top=\"-360\"/></w:sectPr>",
    "value": {
      "value": 548640,
      "unit": "emu"
    },
    "after": "<w:sectPr><w:pgMar w:top=\"864\"/></w:sectPr>"
  }
] as const;
