// Executed ownership-corrected Gnumeric1.12.61 Perl5.34.1 native loader.
// Receipt: docs/ssconvert/byte-text-cursor-gap-proof.json; outputs are bytes, not replacement-decoded text.
export const byteStringCases = [
  {
    "id": "expanded-9",
    "argumentsHex": [
      "c3a462c3a9",
      "",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4b\u00e9\",\"\",\"$1\\\\n\")",
      "LEN(A1)",
      "LEFT(A1,1)",
      "RIGHT(A1,1)",
      "MID(A1,2,3)",
      "ISTEXT(A1)",
      "ISERROR(A1)",
      "CODE(A1)",
      "CONCATENATE(A1,\"tail\")",
      "PERL_SED(A1,\"a\",\"b\")",
      "LOWER(A1)",
      "UPPER(A1)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "3237",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e7461696c",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c4ec324315c4ea424315c4e4224315c4ec324315c4ea924315c4e"
    ]
  },
  {
    "id": "expanded-119",
    "argumentsHex": [
      "c3a462c3a9",
      "612a",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4b\u00e9\",\"a*\",\"$1\\\\n\")",
      "LEN(A2)",
      "LEFT(A2,1)",
      "RIGHT(A2,1)",
      "MID(A2,2,3)",
      "ISTEXT(A2)",
      "ISERROR(A2)",
      "CODE(A2)",
      "CONCATENATE(A2,\"tail\")",
      "PERL_SED(A2,\"a\",\"b\")",
      "LOWER(A2)",
      "UPPER(A2)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "3237",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e7461696c",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c4ec324315c4ea424315c4e4224315c4ec324315c4ea924315c4e"
    ]
  },
  {
    "id": "expanded-141",
    "argumentsHex": [
      "c3a462c3a9",
      "613f",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4b\u00e9\",\"a?\",\"$1\\\\n\")",
      "LEN(A3)",
      "LEFT(A3,1)",
      "RIGHT(A3,1)",
      "MID(A3,2,3)",
      "ISTEXT(A3)",
      "ISERROR(A3)",
      "CODE(A3)",
      "CONCATENATE(A3,\"tail\")",
      "PERL_SED(A3,\"a\",\"b\")",
      "LOWER(A3)",
      "UPPER(A3)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "3237",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e7461696c",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c4ec324315c4ea424315c4e4224315c4ec324315c4ea924315c4e"
    ]
  },
  {
    "id": "expanded-152",
    "argumentsHex": [
      "c3a462c3a9",
      "612a3f",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4b\u00e9\",\"a*?\",\"$1\\\\n\")",
      "LEN(A4)",
      "LEFT(A4,1)",
      "RIGHT(A4,1)",
      "MID(A4,2,3)",
      "ISTEXT(A4)",
      "ISERROR(A4)",
      "CODE(A4)",
      "CONCATENATE(A4,\"tail\")",
      "PERL_SED(A4,\"a\",\"b\")",
      "LOWER(A4)",
      "UPPER(A4)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "3237",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e7461696c",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c4ec324315c4ea424315c4e4224315c4ec324315c4ea924315c4e"
    ]
  },
  {
    "id": "expanded-174",
    "argumentsHex": [
      "c3a462c3a9",
      "613f3f",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4b\u00e9\",\"a??\",\"$1\\\\n\")",
      "LEN(A5)",
      "LEFT(A5,1)",
      "RIGHT(A5,1)",
      "MID(A5,2,3)",
      "ISTEXT(A5)",
      "ISERROR(A5)",
      "CODE(A5)",
      "CONCATENATE(A5,\"tail\")",
      "PERL_SED(A5,\"a\",\"b\")",
      "LOWER(A5)",
      "UPPER(A5)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "3237",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e7461696c",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c4ec324315c4ea424315c4e4224315c4ec324315c4ea924315c4e"
    ]
  },
  {
    "id": "expanded-196",
    "argumentsHex": [
      "c3a462c3a9",
      "617b302c327d",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4b\u00e9\",\"a{0,2}\",\"$1\\\\n\")",
      "LEN(A6)",
      "LEFT(A6,1)",
      "RIGHT(A6,1)",
      "MID(A6,2,3)",
      "ISTEXT(A6)",
      "ISERROR(A6)",
      "CODE(A6)",
      "CONCATENATE(A6,\"tail\")",
      "PERL_SED(A6,\"a\",\"b\")",
      "LOWER(A6)",
      "UPPER(A6)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "3237",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e7461696c",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c4ec324315c4ea424315c4e4224315c4ec324315c4ea924315c4e"
    ]
  },
  {
    "id": "expanded-240",
    "argumentsHex": [
      "c3a462c3a9",
      "283f3a617c6162292a",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4b\u00e9\",\"(?:a|ab)*\",\"$1\\\\n\")",
      "LEN(A7)",
      "LEFT(A7,1)",
      "RIGHT(A7,1)",
      "MID(A7,2,3)",
      "ISTEXT(A7)",
      "ISERROR(A7)",
      "CODE(A7)",
      "CONCATENATE(A7,\"tail\")",
      "PERL_SED(A7,\"a\",\"b\")",
      "LOWER(A7)",
      "UPPER(A7)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "3237",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e7461696c",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c4ec324315c4ea424315c4e4224315c4ec324315c4ea924315c4e"
    ]
  },
  {
    "id": "expanded-273",
    "argumentsHex": [
      "c3a462c3a9",
      "7c61",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4b\u00e9\",\"|a\",\"$1\\\\n\")",
      "LEN(A8)",
      "LEFT(A8,1)",
      "RIGHT(A8,1)",
      "MID(A8,2,3)",
      "ISTEXT(A8)",
      "ISERROR(A8)",
      "CODE(A8)",
      "CONCATENATE(A8,\"tail\")",
      "PERL_SED(A8,\"a\",\"b\")",
      "LOWER(A8)",
      "UPPER(A8)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "3237",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e7461696c",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c4ec324315c4ea424315c4e4224315c4ec324315c4ea924315c4e"
    ]
  },
  {
    "id": "expanded-284",
    "argumentsHex": [
      "c3a462c3a9",
      "617c",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4b\u00e9\",\"a|\",\"$1\\\\n\")",
      "LEN(A9)",
      "LEFT(A9,1)",
      "RIGHT(A9,1)",
      "MID(A9,2,3)",
      "ISTEXT(A9)",
      "ISERROR(A9)",
      "CODE(A9)",
      "CONCATENATE(A9,\"tail\")",
      "PERL_SED(A9,\"a\",\"b\")",
      "LOWER(A9)",
      "UPPER(A9)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "3237",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e7461696c",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c4ec324315c4ea424315c4e4224315c4ec324315c4ea924315c4e"
    ]
  },
  {
    "id": "expanded-317",
    "argumentsHex": [
      "c3a462c3a9",
      "28613f292a",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4b\u00e9\",\"(a?)*\",\"$1\\\\n\")",
      "LEN(A10)",
      "LEFT(A10,1)",
      "RIGHT(A10,1)",
      "MID(A10,2,3)",
      "ISTEXT(A10)",
      "ISERROR(A10)",
      "CODE(A10)",
      "CONCATENATE(A10,\"tail\")",
      "PERL_SED(A10,\"a\",\"b\")",
      "LOWER(A10)",
      "UPPER(A10)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "3237",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e7461696c",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c4ec324315c4ea424315c4e4224315c4ec324315c4ea924315c4e"
    ]
  },
  {
    "id": "expanded-328",
    "argumentsHex": [
      "c3a462c3a9",
      "28612a292a",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4b\u00e9\",\"(a*)*\",\"$1\\\\n\")",
      "LEN(A11)",
      "LEFT(A11,1)",
      "RIGHT(A11,1)",
      "MID(A11,2,3)",
      "ISTEXT(A11)",
      "ISERROR(A11)",
      "CODE(A11)",
      "CONCATENATE(A11,\"tail\")",
      "PERL_SED(A11,\"a\",\"b\")",
      "LOWER(A11)",
      "UPPER(A11)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "3237",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e7461696c",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c4ec324315c4ea424315c4e4224315c4ec324315c4ea924315c4e"
    ]
  },
  {
    "id": "expanded-493",
    "argumentsHex": [
      "c3a462c3a9",
      "5c42",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea462c324315c6ea924315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4b\u00e9\",\"\\\\B\",\"$1\\\\n\")",
      "LEN(A12)",
      "LEFT(A12,1)",
      "RIGHT(A12,1)",
      "MID(A12,2,3)",
      "ISTEXT(A12)",
      "ISERROR(A12)",
      "CODE(A12)",
      "CONCATENATE(A12,\"tail\")",
      "PERL_SED(A12,\"a\",\"b\")",
      "LOWER(A12)",
      "UPPER(A12)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea462c324315c6ea924315c6e",
      "3139",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea462c324315c6ea924315c6e7461696c",
      "24315c6ec324315c6ea462c324315c6ea924315c6e",
      "24315c6ec324315c6ea462c324315c6ea924315c6e",
      "24315c4ec324315c4ea442c324315c4ea924315c4e"
    ]
  },
  {
    "id": "expanded-603",
    "argumentsHex": [
      "c3a462c3a9",
      "283f216129",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4b\u00e9\",\"(?!a)\",\"$1\\\\n\")",
      "LEN(A13)",
      "LEFT(A13,1)",
      "RIGHT(A13,1)",
      "MID(A13,2,3)",
      "ISTEXT(A13)",
      "ISERROR(A13)",
      "CODE(A13)",
      "CONCATENATE(A13,\"tail\")",
      "PERL_SED(A13,\"a\",\"b\")",
      "LOWER(A13)",
      "UPPER(A13)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "3237",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e7461696c",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c4ec324315c4ea424315c4e4224315c4ec324315c4ea924315c4e"
    ]
  },
  {
    "id": "capture-71",
    "argumentsHex": [
      "c3a461c3a461",
      "28612a295c31",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4a\u00e4a\",\"(a*)\\\\1\",\"$1\\\\n\")",
      "LEN(A14)",
      "LEFT(A14,1)",
      "RIGHT(A14,1)",
      "MID(A14,2,3)",
      "ISTEXT(A14)",
      "ISERROR(A14)",
      "CODE(A14)",
      "CONCATENATE(A14,\"tail\")",
      "PERL_SED(A14,\"a\",\"b\")",
      "LOWER(A14)",
      "UPPER(A14)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "3332",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e7461696c",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea424315c6e6224315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c4ec324315c4ea424315c4e4124315c4ec324315c4ea424315c4e4124315c4e"
    ]
  },
  {
    "id": "capture-83",
    "argumentsHex": [
      "c3a461c3a461",
      "28612a3f295c31",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4a\u00e4a\",\"(a*?)\\\\1\",\"$1\\\\n\")",
      "LEN(A15)",
      "LEFT(A15,1)",
      "RIGHT(A15,1)",
      "MID(A15,2,3)",
      "ISTEXT(A15)",
      "ISERROR(A15)",
      "CODE(A15)",
      "CONCATENATE(A15,\"tail\")",
      "PERL_SED(A15,\"a\",\"b\")",
      "LOWER(A15)",
      "UPPER(A15)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "3332",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e7461696c",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea424315c6e6224315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c4ec324315c4ea424315c4e4124315c4ec324315c4ea424315c4e4124315c4e"
    ]
  },
  {
    "id": "behind-220",
    "argumentsHex": [
      "c3a462",
      "283f3c216129",
      "58"
    ],
    "outputHex": "58c358a4586258",
    "expressions": [
      "PERL_SED(\"\u00e4b\",\"(?<!a)\",\"X\")",
      "LEN(A16)",
      "LEFT(A16,1)",
      "RIGHT(A16,1)",
      "MID(A16,2,3)",
      "ISTEXT(A16)",
      "ISERROR(A16)",
      "CODE(A16)",
      "CONCATENATE(A16,\"tail\")",
      "PERL_SED(A16,\"a\",\"b\")",
      "LOWER(A16)",
      "UPPER(A16)"
    ],
    "downstreamHex": [
      "58c358a4586258",
      "36",
      "58",
      "58",
      "c358a458",
      "54525545",
      "46414c5345",
      "3838",
      "58c358a45862587461696c",
      "58c358a4586258",
      "78c358a4786278",
      "58c358a4584258"
    ]
  },
  {
    "id": "named-119",
    "argumentsHex": [
      "c3a461c3a461",
      "283f3c613e612a295c6b3c613e",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4a\u00e4a\",\"(?<a>a*)\\\\k<a>\",\"$1\\\\n\")",
      "LEN(A17)",
      "LEFT(A17,1)",
      "RIGHT(A17,1)",
      "MID(A17,2,3)",
      "ISTEXT(A17)",
      "ISERROR(A17)",
      "CODE(A17)",
      "CONCATENATE(A17,\"tail\")",
      "PERL_SED(A17,\"a\",\"b\")",
      "LOWER(A17)",
      "UPPER(A17)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "3332",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e7461696c",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea424315c6e6224315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c4ec324315c4ea424315c4e4124315c4ec324315c4ea424315c4e4124315c4e"
    ]
  },
  {
    "id": "named-134",
    "argumentsHex": [
      "c3a461c3a461",
      "283f3c613e612a3f295c6b3c613e",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4a\u00e4a\",\"(?<a>a*?)\\\\k<a>\",\"$1\\\\n\")",
      "LEN(A18)",
      "LEFT(A18,1)",
      "RIGHT(A18,1)",
      "MID(A18,2,3)",
      "ISTEXT(A18)",
      "ISERROR(A18)",
      "CODE(A18)",
      "CONCATENATE(A18,\"tail\")",
      "PERL_SED(A18,\"a\",\"b\")",
      "LOWER(A18)",
      "UPPER(A18)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "3332",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e7461696c",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea424315c6e6224315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c4ec324315c4ea424315c4e4124315c4ec324315c4ea424315c4e4124315c4e"
    ]
  },
  {
    "id": "atomic-251",
    "argumentsHex": [
      "c3a461c3a461",
      "283f3e612a29",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4a\u00e4a\",\"(?>a*)\",\"$1\\\\n\")",
      "LEN(A19)",
      "LEFT(A19,1)",
      "RIGHT(A19,1)",
      "MID(A19,2,3)",
      "ISTEXT(A19)",
      "ISERROR(A19)",
      "CODE(A19)",
      "CONCATENATE(A19,\"tail\")",
      "PERL_SED(A19,\"a\",\"b\")",
      "LOWER(A19)",
      "UPPER(A19)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "3330",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e7461696c",
      "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "24315c4ec324315c4ea424315c4e24315c4ec324315c4ea424315c4e24315c4e"
    ]
  },
  {
    "id": "atomic-269",
    "argumentsHex": [
      "c3a461c3a461",
      "612a2b",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4a\u00e4a\",\"a*+\",\"$1\\\\n\")",
      "LEN(A20)",
      "LEFT(A20,1)",
      "RIGHT(A20,1)",
      "MID(A20,2,3)",
      "ISTEXT(A20)",
      "ISERROR(A20)",
      "CODE(A20)",
      "CONCATENATE(A20,\"tail\")",
      "PERL_SED(A20,\"a\",\"b\")",
      "LOWER(A20)",
      "UPPER(A20)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "3330",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e7461696c",
      "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "24315c4ec324315c4ea424315c4e24315c4ec324315c4ea424315c4e24315c4e"
    ]
  },
  {
    "id": "atomic-323",
    "argumentsHex": [
      "c3a461c3a461",
      "283f3e28612a29295c31",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4a\u00e4a\",\"(?>(a*))\\\\1\",\"$1\\\\n\")",
      "LEN(A21)",
      "LEFT(A21,1)",
      "RIGHT(A21,1)",
      "MID(A21,2,3)",
      "ISTEXT(A21)",
      "ISERROR(A21)",
      "CODE(A21)",
      "CONCATENATE(A21,\"tail\")",
      "PERL_SED(A21,\"a\",\"b\")",
      "LOWER(A21)",
      "UPPER(A21)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e",
      "3234",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e7461696c",
      "24315c6ec324315c6ea46224315c6ec324315c6ea46224315c6e",
      "24315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e",
      "24315c4ec324315c4ea44124315c4ec324315c4ea44124315c4e"
    ]
  },
  {
    "id": "atomic-503",
    "argumentsHex": [
      "c3a461c3a461",
      "283f3a613f292a2b",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4a\u00e4a\",\"(?:a?)*+\",\"$1\\\\n\")",
      "LEN(A22)",
      "LEFT(A22,1)",
      "RIGHT(A22,1)",
      "MID(A22,2,3)",
      "ISTEXT(A22)",
      "ISERROR(A22)",
      "CODE(A22)",
      "CONCATENATE(A22,\"tail\")",
      "PERL_SED(A22,\"a\",\"b\")",
      "LOWER(A22)",
      "UPPER(A22)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "3330",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e7461696c",
      "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "24315c4ec324315c4ea424315c4e24315c4ec324315c4ea424315c4e24315c4e"
    ]
  },
  {
    "id": "atomic-521",
    "argumentsHex": [
      "c3a461c3a461",
      "28612a3f292a2b",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4a\u00e4a\",\"(a*?)*+\",\"$1\\\\n\")",
      "LEN(A23)",
      "LEFT(A23,1)",
      "RIGHT(A23,1)",
      "MID(A23,2,3)",
      "ISTEXT(A23)",
      "ISERROR(A23)",
      "CODE(A23)",
      "CONCATENATE(A23,\"tail\")",
      "PERL_SED(A23,\"a\",\"b\")",
      "LOWER(A23)",
      "UPPER(A23)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "3332",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e7461696c",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea424315c6e6224315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c4ec324315c4ea424315c4e4124315c4ec324315c4ea424315c4e4124315c4e"
    ]
  },
  {
    "id": "variable-behind-527",
    "argumentsHex": [
      "c3a461c3a461",
      "283f3c3d28617b302c327d29295c31",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4a\u00e4a\",\"(?<=(a{0,2}))\\\\1\",\"$1\\\\n\")",
      "LEN(A24)",
      "LEFT(A24,1)",
      "RIGHT(A24,1)",
      "MID(A24,2,3)",
      "ISTEXT(A24)",
      "ISERROR(A24)",
      "CODE(A24)",
      "CONCATENATE(A24,\"tail\")",
      "PERL_SED(A24,\"a\",\"b\")",
      "LOWER(A24)",
      "UPPER(A24)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e",
      "3238",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e7461696c",
      "24315c6ec324315c6ea424315c6e6224315c6ec3a424315c6e6224315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e",
      "24315c4ec324315c4ea424315c4e4124315c4ec38424315c4e4124315c4e"
    ]
  },
  {
    "id": "escape-15",
    "argumentsHex": [
      "c2a0",
      "5c682b",
      "24315c6e"
    ],
    "outputHex": "c224315c6e",
    "expressions": [
      "PERL_SED(\"\u00a0\",\"\\\\h+\",\"$1\\\\n\")",
      "LEN(A25)",
      "LEFT(A25,1)",
      "RIGHT(A25,1)",
      "MID(A25,2,3)",
      "ISTEXT(A25)",
      "ISERROR(A25)",
      "CODE(A25)",
      "CONCATENATE(A25,\"tail\")",
      "PERL_SED(A25,\"a\",\"b\")",
      "LOWER(A25)",
      "UPPER(A25)"
    ],
    "downstreamHex": [
      "c224315c6e",
      "34",
      "c224",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "2356414c554521",
      "c224315c6e7461696c",
      "c224315c6e",
      "c224315c6e",
      "c224315c4e"
    ]
  },
  {
    "id": "escape-32",
    "argumentsHex": [
      "c2a0",
      "5c482b",
      "24315c6e"
    ],
    "outputHex": "24315c6ea0",
    "expressions": [
      "PERL_SED(\"\u00a0\",\"\\\\H+\",\"$1\\\\n\")",
      "LEN(A26)",
      "LEFT(A26,1)",
      "RIGHT(A26,1)",
      "MID(A26,2,3)",
      "ISTEXT(A26)",
      "ISERROR(A26)",
      "CODE(A26)",
      "CONCATENATE(A26,\"tail\")",
      "PERL_SED(A26,\"a\",\"b\")",
      "LOWER(A26)",
      "UPPER(A26)"
    ],
    "downstreamHex": [
      "24315c6ea0",
      "35",
      "24",
      "6ea0",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ea07461696c",
      "24315c6ea0",
      "24315c6ea0",
      "24315c4ea0"
    ]
  },
  {
    "id": "escape-48",
    "argumentsHex": [
      "c285",
      "5c762b",
      "24315c6e"
    ],
    "outputHex": "c224315c6e",
    "expressions": [
      "PERL_SED(\"\u0085\",\"\\\\v+\",\"$1\\\\n\")",
      "LEN(A27)",
      "LEFT(A27,1)",
      "RIGHT(A27,1)",
      "MID(A27,2,3)",
      "ISTEXT(A27)",
      "ISERROR(A27)",
      "CODE(A27)",
      "CONCATENATE(A27,\"tail\")",
      "PERL_SED(A27,\"a\",\"b\")",
      "LOWER(A27)",
      "UPPER(A27)"
    ],
    "downstreamHex": [
      "c224315c6e",
      "34",
      "c224",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "2356414c554521",
      "c224315c6e7461696c",
      "c224315c6e",
      "c224315c6e",
      "c224315c4e"
    ]
  },
  {
    "id": "escape-65",
    "argumentsHex": [
      "c285",
      "5c562b",
      "24315c6e"
    ],
    "outputHex": "24315c6e85",
    "expressions": [
      "PERL_SED(\"\u0085\",\"\\\\V+\",\"$1\\\\n\")",
      "LEN(A28)",
      "LEFT(A28,1)",
      "RIGHT(A28,1)",
      "MID(A28,2,3)",
      "ISTEXT(A28)",
      "ISERROR(A28)",
      "CODE(A28)",
      "CONCATENATE(A28,\"tail\")",
      "PERL_SED(A28,\"a\",\"b\")",
      "LOWER(A28)",
      "UPPER(A28)"
    ],
    "downstreamHex": [
      "24315c6e85",
      "35",
      "24",
      "6e85",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6e857461696c",
      "24315c6e85",
      "24315c6e85",
      "24315c4e85"
    ]
  },
  {
    "id": "escape-82",
    "argumentsHex": [
      "c285",
      "5c52",
      "24315c6e"
    ],
    "outputHex": "c224315c6e",
    "expressions": [
      "PERL_SED(\"\u0085\",\"\\\\R\",\"$1\\\\n\")",
      "LEN(A29)",
      "LEFT(A29,1)",
      "RIGHT(A29,1)",
      "MID(A29,2,3)",
      "ISTEXT(A29)",
      "ISERROR(A29)",
      "CODE(A29)",
      "CONCATENATE(A29,\"tail\")",
      "PERL_SED(A29,\"a\",\"b\")",
      "LOWER(A29)",
      "UPPER(A29)"
    ],
    "downstreamHex": [
      "c224315c6e",
      "34",
      "c224",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "2356414c554521",
      "c224315c6e7461696c",
      "c224315c6e",
      "c224315c6e",
      "c224315c4e"
    ]
  },
  {
    "id": "escape-99",
    "argumentsHex": [
      "c285",
      "5c522b",
      "24315c6e"
    ],
    "outputHex": "c224315c6e",
    "expressions": [
      "PERL_SED(\"\u0085\",\"\\\\R+\",\"$1\\\\n\")",
      "LEN(A30)",
      "LEFT(A30,1)",
      "RIGHT(A30,1)",
      "MID(A30,2,3)",
      "ISTEXT(A30)",
      "ISERROR(A30)",
      "CODE(A30)",
      "CONCATENATE(A30,\"tail\")",
      "PERL_SED(A30,\"a\",\"b\")",
      "LOWER(A30)",
      "UPPER(A30)"
    ],
    "downstreamHex": [
      "c224315c6e",
      "34",
      "c224",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "2356414c554521",
      "c224315c6e7461696c",
      "c224315c6e",
      "c224315c6e",
      "c224315c4e"
    ]
  },
  {
    "id": "escape-168",
    "argumentsHex": [
      "c2a0",
      "5b5c685d2b",
      "24315c6e"
    ],
    "outputHex": "c224315c6e",
    "expressions": [
      "PERL_SED(\"\u00a0\",\"[\\\\h]+\",\"$1\\\\n\")",
      "LEN(A31)",
      "LEFT(A31,1)",
      "RIGHT(A31,1)",
      "MID(A31,2,3)",
      "ISTEXT(A31)",
      "ISERROR(A31)",
      "CODE(A31)",
      "CONCATENATE(A31,\"tail\")",
      "PERL_SED(A31,\"a\",\"b\")",
      "LOWER(A31)",
      "UPPER(A31)"
    ],
    "downstreamHex": [
      "c224315c6e",
      "34",
      "c224",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "2356414c554521",
      "c224315c6e7461696c",
      "c224315c6e",
      "c224315c6e",
      "c224315c4e"
    ]
  },
  {
    "id": "escape-185",
    "argumentsHex": [
      "c2a0",
      "5b5c485d2b",
      "24315c6e"
    ],
    "outputHex": "24315c6ea0",
    "expressions": [
      "PERL_SED(\"\u00a0\",\"[\\\\H]+\",\"$1\\\\n\")",
      "LEN(A32)",
      "LEFT(A32,1)",
      "RIGHT(A32,1)",
      "MID(A32,2,3)",
      "ISTEXT(A32)",
      "ISERROR(A32)",
      "CODE(A32)",
      "CONCATENATE(A32,\"tail\")",
      "PERL_SED(A32,\"a\",\"b\")",
      "LOWER(A32)",
      "UPPER(A32)"
    ],
    "downstreamHex": [
      "24315c6ea0",
      "35",
      "24",
      "6ea0",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ea07461696c",
      "24315c6ea0",
      "24315c6ea0",
      "24315c4ea0"
    ]
  },
  {
    "id": "escape-201",
    "argumentsHex": [
      "c285",
      "5b5c765d2b",
      "24315c6e"
    ],
    "outputHex": "c224315c6e",
    "expressions": [
      "PERL_SED(\"\u0085\",\"[\\\\v]+\",\"$1\\\\n\")",
      "LEN(A33)",
      "LEFT(A33,1)",
      "RIGHT(A33,1)",
      "MID(A33,2,3)",
      "ISTEXT(A33)",
      "ISERROR(A33)",
      "CODE(A33)",
      "CONCATENATE(A33,\"tail\")",
      "PERL_SED(A33,\"a\",\"b\")",
      "LOWER(A33)",
      "UPPER(A33)"
    ],
    "downstreamHex": [
      "c224315c6e",
      "34",
      "c224",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "2356414c554521",
      "c224315c6e7461696c",
      "c224315c6e",
      "c224315c6e",
      "c224315c4e"
    ]
  },
  {
    "id": "escape-218",
    "argumentsHex": [
      "c285",
      "5b5c565d2b",
      "24315c6e"
    ],
    "outputHex": "24315c6e85",
    "expressions": [
      "PERL_SED(\"\u0085\",\"[\\\\V]+\",\"$1\\\\n\")",
      "LEN(A34)",
      "LEFT(A34,1)",
      "RIGHT(A34,1)",
      "MID(A34,2,3)",
      "ISTEXT(A34)",
      "ISERROR(A34)",
      "CODE(A34)",
      "CONCATENATE(A34,\"tail\")",
      "PERL_SED(A34,\"a\",\"b\")",
      "LOWER(A34)",
      "UPPER(A34)"
    ],
    "downstreamHex": [
      "24315c6e85",
      "35",
      "24",
      "6e85",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6e857461696c",
      "24315c6e85",
      "24315c6e85",
      "24315c4e85"
    ]
  },
  {
    "id": "escape-472",
    "argumentsHex": [
      "c3a461c3a461",
      "5c682a3f",
      "24315c6e"
    ],
    "outputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expressions": [
      "PERL_SED(\"\u00e4a\u00e4a\",\"\\\\h*?\",\"$1\\\\n\")",
      "LEN(A35)",
      "LEFT(A35,1)",
      "RIGHT(A35,1)",
      "MID(A35,2,3)",
      "ISTEXT(A35)",
      "ISERROR(A35)",
      "CODE(A35)",
      "CONCATENATE(A35,\"tail\")",
      "PERL_SED(A35,\"a\",\"b\")",
      "LOWER(A35)",
      "UPPER(A35)"
    ],
    "downstreamHex": [
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "3332",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e7461696c",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea424315c6e6224315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c4ec324315c4ea424315c4e4124315c4ec324315c4ea424315c4e4124315c4e"
    ]
  },
  {
    "id": "escape-473",
    "argumentsHex": [
      "c285",
      "5c682a3f",
      "24315c6e"
    ],
    "outputHex": "24315c6ec224315c6e8524315c6e",
    "expressions": [
      "PERL_SED(\"\u0085\",\"\\\\h*?\",\"$1\\\\n\")",
      "LEN(A36)",
      "LEFT(A36,1)",
      "RIGHT(A36,1)",
      "MID(A36,2,3)",
      "ISTEXT(A36)",
      "ISERROR(A36)",
      "CODE(A36)",
      "CONCATENATE(A36,\"tail\")",
      "PERL_SED(A36,\"a\",\"b\")",
      "LOWER(A36)",
      "UPPER(A36)"
    ],
    "downstreamHex": [
      "24315c6ec224315c6e8524315c6e",
      "3133",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec224315c6e8524315c6e7461696c",
      "24315c6ec224315c6e8524315c6e",
      "24315c6ec224315c6e8524315c6e",
      "24315c4ec224315c4e8524315c4e"
    ]
  },
  {
    "id": "escape-474",
    "argumentsHex": [
      "c2a0",
      "5c682a3f",
      "24315c6e"
    ],
    "outputHex": "24315c6ec224315c6e24315c6e24315c6e",
    "expressions": [
      "PERL_SED(\"\u00a0\",\"\\\\h*?\",\"$1\\\\n\")",
      "LEN(A37)",
      "LEFT(A37,1)",
      "RIGHT(A37,1)",
      "MID(A37,2,3)",
      "ISTEXT(A37)",
      "ISERROR(A37)",
      "CODE(A37)",
      "CONCATENATE(A37,\"tail\")",
      "PERL_SED(A37,\"a\",\"b\")",
      "LOWER(A37)",
      "UPPER(A37)"
    ],
    "downstreamHex": [
      "24315c6ec224315c6e24315c6e24315c6e",
      "3136",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ec224315c6e24315c6e24315c6e7461696c",
      "24315c6ec224315c6e24315c6e24315c6e",
      "24315c6ec224315c6e24315c6e24315c6e",
      "24315c4ec224315c4e24315c4e24315c4e"
    ]
  },
  {
    "id": "escape-475",
    "argumentsHex": [
      "e280a8",
      "5c682a3f",
      "24315c6e"
    ],
    "outputHex": "24315c6ee224315c6e8024315c6ea824315c6e",
    "expressions": [
      "PERL_SED(\"\u2028\",\"\\\\h*?\",\"$1\\\\n\")",
      "LEN(A38)",
      "LEFT(A38,1)",
      "RIGHT(A38,1)",
      "MID(A38,2,3)",
      "ISTEXT(A38)",
      "ISERROR(A38)",
      "CODE(A38)",
      "CONCATENATE(A38,\"tail\")",
      "PERL_SED(A38,\"a\",\"b\")",
      "LOWER(A38)",
      "UPPER(A38)"
    ],
    "downstreamHex": [
      "24315c6ee224315c6e8024315c6ea824315c6e",
      "3137",
      "24",
      "6e",
      "315c6e",
      "54525545",
      "46414c5345",
      "3336",
      "24315c6ee224315c6e8024315c6ea824315c6e7461696c",
      "24315c6ee224315c6e8024315c6ea824315c6e",
      "24315c6ee224315c6e8024315c6ea824315c6e",
      "24315c4ee224315c4e8024315c4ea824315c4e"
    ]
  }
] as const;
