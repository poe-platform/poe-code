// Gnumeric 1.12.61 plugins/excel source tables; GPL-2.0-or-later.
// Jody Goldberg and Michael Meeks, (C) 1998-2005.
export const biffOpcodes: Readonly<Record<number, readonly string[]>> = {
  "0": [
    "DIMENSIONS_v0"
  ],
  "512": [
    "DIMENSIONS_v2"
  ],
  "1": [
    "BLANK_v0"
  ],
  "513": [
    "BLANK_v2"
  ],
  "2": [
    "INTEGER"
  ],
  "3": [
    "NUMBER_v0"
  ],
  "515": [
    "NUMBER_v2"
  ],
  "4": [
    "LABEL_v0"
  ],
  "516": [
    "LABEL_v2"
  ],
  "5": [
    "BOOLERR_v0"
  ],
  "517": [
    "BOOLERR_v2"
  ],
  "6": [
    "FORMULA_v0"
  ],
  "518": [
    "FORMULA_v2"
  ],
  "1030": [
    "FORMULA_v4"
  ],
  "7": [
    "STRING_v0"
  ],
  "519": [
    "STRING_v2"
  ],
  "8": [
    "ROW_v0"
  ],
  "520": [
    "ROW_v2"
  ],
  "9": [
    "BOF_v0"
  ],
  "521": [
    "BOF_v2"
  ],
  "1033": [
    "BOF_v4"
  ],
  "2057": [
    "BOF_v8"
  ],
  "10": [
    "EOF"
  ],
  "11": [
    "INDEX_v0"
  ],
  "523": [
    "INDEX_v2"
  ],
  "12": [
    "CALCCOUNT"
  ],
  "13": [
    "CALCMODE"
  ],
  "14": [
    "PRECISION"
  ],
  "15": [
    "REFMODE"
  ],
  "16": [
    "DELTA"
  ],
  "17": [
    "ITERATION"
  ],
  "18": [
    "PROTECT"
  ],
  "19": [
    "PASSWORD"
  ],
  "20": [
    "HEADER"
  ],
  "21": [
    "FOOTER"
  ],
  "22": [
    "EXTERNCOUNT"
  ],
  "23": [
    "EXTERNSHEET"
  ],
  "24": [
    "NAME_v0"
  ],
  "536": [
    "NAME_v2"
  ],
  "25": [
    "WINDOWPROTECT"
  ],
  "26": [
    "VERTICALPAGEBREAKS"
  ],
  "27": [
    "HORIZONTALPAGEBREAKS"
  ],
  "28": [
    "NOTE"
  ],
  "29": [
    "SELECTION"
  ],
  "30": [
    "FORMAT_v0"
  ],
  "1054": [
    "FORMAT_v4"
  ],
  "31": [
    "FORMATCOUNT"
  ],
  "32": [
    "COLUMNDEFAULT"
  ],
  "33": [
    "ARRAY_v0"
  ],
  "545": [
    "ARRAY_v2"
  ],
  "34": [
    "1904"
  ],
  "35": [
    "EXTERNNAME_v0"
  ],
  "547": [
    "EXTERNNAME_v2"
  ],
  "36": [
    "COLWIDTH"
  ],
  "37": [
    "DEFAULTROWHEIGHT_v0"
  ],
  "549": [
    "DEFAULTROWHEIGHT_v2"
  ],
  "38": [
    "LEFT_MARGIN"
  ],
  "39": [
    "RIGHT_MARGIN"
  ],
  "40": [
    "TOP_MARGIN"
  ],
  "41": [
    "BOTTOM_MARGIN"
  ],
  "42": [
    "PRINTHEADERS"
  ],
  "43": [
    "PRINTGRIDLINES"
  ],
  "47": [
    "FILEPASS"
  ],
  "49": [
    "FONT_v0"
  ],
  "561": [
    "FONT_v2"
  ],
  "50": [
    "FONTCOUNT"
  ],
  "51": [
    "PRINTSIZE"
  ],
  "54": [
    "TABLE_v0"
  ],
  "566": [
    "TABLE_v2"
  ],
  "55": [
    "TABLE2"
  ],
  "56": [
    "WNDESK"
  ],
  "57": [
    "ZOOM"
  ],
  "58": [
    "BEGINPREF"
  ],
  "59": [
    "ENDPREF"
  ],
  "60": [
    "CONTINUE"
  ],
  "61": [
    "WINDOW1"
  ],
  "62": [
    "WINDOW2_v0"
  ],
  "574": [
    "WINDOW2_v2"
  ],
  "63": [
    "PANE_V2"
  ],
  "64": [
    "BACKUP"
  ],
  "65": [
    "PANE"
  ],
  "66": [
    "CODEPAGE"
  ],
  "67": [
    "XF_OLD_v0"
  ],
  "579": [
    "XF_OLD_v2"
  ],
  "1091": [
    "XF_OLD_v4"
  ],
  "68": [
    "XF_INDEX"
  ],
  "69": [
    "FONT_COLOR"
  ],
  "77": [
    "PLS"
  ],
  "80": [
    "DCON"
  ],
  "81": [
    "DCONREF"
  ],
  "82": [
    "DCONNAME"
  ],
  "85": [
    "DEFCOLWIDTH"
  ],
  "89": [
    "XCT"
  ],
  "90": [
    "CRN"
  ],
  "91": [
    "FILESHARING"
  ],
  "92": [
    "WRITEACCESS"
  ],
  "93": [
    "OBJ"
  ],
  "94": [
    "UNCALCED"
  ],
  "95": [
    "SAVERECALC"
  ],
  "96": [
    "TEMPLATE"
  ],
  "97": [
    "INTL"
  ],
  "2146": [
    "TAB_COLOR",
    "SHEETEXT"
  ],
  "99": [
    "OBJPROTECT"
  ],
  "125": [
    "COLINFO"
  ],
  "638": [
    "RK"
  ],
  "127": [
    "IMDATA"
  ],
  "128": [
    "GUTS"
  ],
  "129": [
    "WSBOOL"
  ],
  "130": [
    "GRIDSET"
  ],
  "131": [
    "HCENTER"
  ],
  "132": [
    "VCENTER"
  ],
  "133": [
    "BOUNDSHEET"
  ],
  "134": [
    "WRITEPROT"
  ],
  "135": [
    "ADDIN"
  ],
  "136": [
    "EDG"
  ],
  "137": [
    "PUB"
  ],
  "140": [
    "COUNTRY"
  ],
  "141": [
    "HIDEOBJ"
  ],
  "142": [
    "BUNDLESOFFSET"
  ],
  "143": [
    "BUNDLEHEADER"
  ],
  "144": [
    "SORT"
  ],
  "145": [
    "SUB"
  ],
  "146": [
    "PALETTE"
  ],
  "659": [
    "STYLE"
  ],
  "148": [
    "LHRECORD"
  ],
  "149": [
    "LHNGRAPH"
  ],
  "150": [
    "SOUND"
  ],
  "151": [
    "SYNC"
  ],
  "152": [
    "LPR"
  ],
  "153": [
    "STANDARDWIDTH"
  ],
  "154": [
    "FNGROUPNAME"
  ],
  "155": [
    "FILTERMODE"
  ],
  "156": [
    "FNGROUPCOUNT"
  ],
  "157": [
    "AUTOFILTERINFO"
  ],
  "158": [
    "AUTOFILTER"
  ],
  "160": [
    "SCL"
  ],
  "161": [
    "SETUP"
  ],
  "164": [
    "TOOLBARVER"
  ],
  "169": [
    "COORDLIST"
  ],
  "171": [
    "GCW"
  ],
  "174": [
    "SCENMAN"
  ],
  "175": [
    "SCENARIO"
  ],
  "176": [
    "SXVIEW"
  ],
  "177": [
    "SXVD"
  ],
  "178": [
    "SXVI"
  ],
  "179": [
    "SXSI"
  ],
  "180": [
    "SXIVD"
  ],
  "181": [
    "SXLI"
  ],
  "182": [
    "SXPI"
  ],
  "183": [
    "FACENUM"
  ],
  "184": [
    "DOCROUTE"
  ],
  "185": [
    "RECIPNAME"
  ],
  "186": [
    "SSLIST"
  ],
  "187": [
    "MASKIMDATA"
  ],
  "1212": [
    "SHRFMLA"
  ],
  "189": [
    "MULRK"
  ],
  "190": [
    "MULBLANK"
  ],
  "191": [
    "TOOLBARHDR"
  ],
  "192": [
    "TOOLBAREND"
  ],
  "193": [
    "MMS"
  ],
  "194": [
    "ADDMENU"
  ],
  "195": [
    "DELMENU"
  ],
  "196": [
    "TIPHISTORY"
  ],
  "197": [
    "SXDI"
  ],
  "198": [
    "SXDB"
  ],
  "199": [
    "SXFDB"
  ],
  "200": [
    "SXDDB"
  ],
  "201": [
    "SXNUM"
  ],
  "202": [
    "SXBOOL"
  ],
  "203": [
    "SXERR"
  ],
  "204": [
    "SXINT"
  ],
  "205": [
    "SXSTRING"
  ],
  "206": [
    "SXDTR"
  ],
  "207": [
    "SXNIL"
  ],
  "208": [
    "SXTBL"
  ],
  "209": [
    "SXTBRGIITM"
  ],
  "210": [
    "SXTBPG"
  ],
  "211": [
    "OBPROJ"
  ],
  "213": [
    "SXStreamID"
  ],
  "214": [
    "RSTRING"
  ],
  "215": [
    "DBCELL"
  ],
  "216": [
    "SXNUMGROUP"
  ],
  "218": [
    "BOOKBOOL"
  ],
  "220": [
    "PARAMQRY",
    "SXEXT"
  ],
  "221": [
    "SCENPROTECT"
  ],
  "222": [
    "OLESIZE"
  ],
  "223": [
    "UDDESC"
  ],
  "224": [
    "XF"
  ],
  "225": [
    "INTERFACEHDR"
  ],
  "226": [
    "INTERFACEEND"
  ],
  "227": [
    "SXVS"
  ],
  "229": [
    "MERGECELLS"
  ],
  "233": [
    "BG_PIC"
  ],
  "234": [
    "TABIDCONF"
  ],
  "235": [
    "MS_O_DRAWING_GROUP"
  ],
  "236": [
    "MS_O_DRAWING"
  ],
  "237": [
    "MS_O_DRAWING_SELECTION"
  ],
  "239": [
    "PHONETIC"
  ],
  "240": [
    "SXRULE"
  ],
  "241": [
    "SXEX"
  ],
  "242": [
    "SXFILT"
  ],
  "246": [
    "SXNAME"
  ],
  "247": [
    "SXSELECT"
  ],
  "248": [
    "SXPAIR"
  ],
  "249": [
    "SXFMLA"
  ],
  "251": [
    "SXFORMAT"
  ],
  "252": [
    "SST"
  ],
  "253": [
    "LABELSST"
  ],
  "255": [
    "EXTSST"
  ],
  "256": [
    "SXVDEX"
  ],
  "259": [
    "SXFORMULA"
  ],
  "290": [
    "SXDBEX"
  ],
  "311": [
    "CHTRINSERT"
  ],
  "312": [
    "CHTRINFO"
  ],
  "315": [
    "CHTRCELLCONTENT"
  ],
  "317": [
    "TABID"
  ],
  "320": [
    "CHTRMOVERANGE"
  ],
  "333": [
    "CHTRINSERTTAB"
  ],
  "351": [
    "LABELRANGES"
  ],
  "352": [
    "USESELFS"
  ],
  "353": [
    "DSF"
  ],
  "354": [
    "XL5MODIFY"
  ],
  "406": [
    "CHTRHEADER"
  ],
  "421": [
    "FILESHARING2"
  ],
  "425": [
    "USERDBVIEW"
  ],
  "426": [
    "USERSVIEWBEGIN"
  ],
  "427": [
    "USERSVIEWEND"
  ],
  "429": [
    "QSI"
  ],
  "430": [
    "SUPBOOK"
  ],
  "431": [
    "PROT4REV"
  ],
  "432": [
    "CONDFMT"
  ],
  "433": [
    "CF"
  ],
  "434": [
    "DVAL"
  ],
  "437": [
    "DCONBIN"
  ],
  "438": [
    "TXO"
  ],
  "439": [
    "REFRESHALL"
  ],
  "440": [
    "HLINK"
  ],
  "442": [
    "CODENAME"
  ],
  "443": [
    "SXFDBTYPE"
  ],
  "444": [
    "PROT4REVPASS"
  ],
  "446": [
    "DV"
  ],
  "448": [
    "XL9FILE"
  ],
  "449": [
    "RECALCID"
  ],
  "2048": [
    "LINK_TIP"
  ],
  "2049": [
    "WEBPUB"
  ],
  "2050": [
    "QSISXTAG"
  ],
  "2051": [
    "DBQUERYEXT"
  ],
  "2052": [
    "EXTSTRING"
  ],
  "2053": [
    "TXTQUERY"
  ],
  "2054": [
    "QSIR"
  ],
  "2055": [
    "QSIF"
  ],
  "2058": [
    "OLEDBCONN"
  ],
  "2059": [
    "WOPT"
  ],
  "2060": [
    "SXVIEWEX"
  ],
  "2061": [
    "SXTH"
  ],
  "2062": [
    "SXPIEX"
  ],
  "2063": [
    "SXVDTEX"
  ],
  "2064": [
    "SXVIEWEX9"
  ],
  "2066": [
    "CONTINUEFRT"
  ],
  "2067": [
    "REALTIMEDATA"
  ],
  "2147": [
    "BOOKEXT"
  ],
  "2148": [
    "SXADDL"
  ],
  "2149": [
    "CRASHRECERR"
  ],
  "2150": [
    "HFPICTURE"
  ],
  "2151": [
    "SHEETPROTECTION"
  ],
  "2152": [
    "RANGEPROTECTION"
  ],
  "4097": [
    "CHART_units"
  ],
  "4098": [
    "CHART_chart"
  ],
  "4099": [
    "CHART_series"
  ],
  "4102": [
    "CHART_dataformat"
  ],
  "4103": [
    "CHART_lineformat"
  ],
  "4105": [
    "CHART_markerformat"
  ],
  "4106": [
    "CHART_areaformat"
  ],
  "4107": [
    "CHART_pieformat"
  ],
  "4108": [
    "CHART_attachedlabel"
  ],
  "4109": [
    "CHART_seriestext"
  ],
  "4116": [
    "CHART_chartformat"
  ],
  "4117": [
    "CHART_legend"
  ],
  "4118": [
    "CHART_serieslist"
  ],
  "4119": [
    "CHART_bar"
  ],
  "4120": [
    "CHART_line"
  ],
  "4121": [
    "CHART_pie"
  ],
  "4122": [
    "CHART_area"
  ],
  "4123": [
    "CHART_scatter"
  ],
  "4124": [
    "CHART_chartline"
  ],
  "4125": [
    "CHART_axis"
  ],
  "4126": [
    "CHART_tick"
  ],
  "4127": [
    "CHART_valuerange"
  ],
  "4128": [
    "CHART_catserrange"
  ],
  "4129": [
    "CHART_axislineformat"
  ],
  "4130": [
    "CHART_chartformatlink"
  ],
  "4132": [
    "CHART_defaulttext"
  ],
  "4133": [
    "CHART_text"
  ],
  "4134": [
    "CHART_fontx"
  ],
  "4135": [
    "CHART_objectlink"
  ],
  "4146": [
    "CHART_frame"
  ],
  "4147": [
    "CHART_begin"
  ],
  "4148": [
    "CHART_end"
  ],
  "4149": [
    "CHART_plotarea"
  ],
  "4154": [
    "CHART_3d"
  ],
  "4156": [
    "CHART_picf"
  ],
  "4157": [
    "CHART_dropbar"
  ],
  "4158": [
    "CHART_radar"
  ],
  "4159": [
    "CHART_surf"
  ],
  "4160": [
    "CHART_radararea"
  ],
  "4161": [
    "CHART_axisparent"
  ],
  "4163": [
    "CHART_legendxn"
  ],
  "4164": [
    "CHART_shtprops"
  ],
  "4165": [
    "CHART_sertocrt"
  ],
  "4166": [
    "CHART_axesused"
  ],
  "4168": [
    "CHART_sbaseref"
  ],
  "4170": [
    "CHART_serparent"
  ],
  "4171": [
    "CHART_serauxtrend"
  ],
  "4174": [
    "CHART_ifmt"
  ],
  "4175": [
    "CHART_pos"
  ],
  "4176": [
    "CHART_alruns"
  ],
  "4177": [
    "CHART_ai"
  ],
  "4187": [
    "CHART_serauxerrbar"
  ],
  "4188": [
    "CHART_clrtclient"
  ],
  "4189": [
    "CHART_serfmt"
  ],
  "4191": [
    "CHART_3dbarshape"
  ],
  "4192": [
    "CHART_fbi"
  ],
  "4193": [
    "CHART_boppop"
  ],
  "4194": [
    "CHART_axcext"
  ],
  "4195": [
    "CHART_dat"
  ],
  "4196": [
    "CHART_plotgrowth"
  ],
  "4197": [
    "CHART_siindex"
  ],
  "4198": [
    "CHART_gelframe"
  ],
  "4199": [
    "CHART_boppopcustom"
  ],
  "4288": [
    "CHART_trendlimits"
  ]
};
export const biffFunctions: Readonly<Record<number, readonly [string, number, number]>> = {
  "0": [
    "COUNT",
    0,
    30
  ],
  "1": [
    "IF",
    2,
    3
  ],
  "2": [
    "ISNA",
    1,
    1
  ],
  "3": [
    "ISERROR",
    1,
    1
  ],
  "4": [
    "SUM",
    0,
    30
  ],
  "5": [
    "AVERAGE",
    1,
    30
  ],
  "6": [
    "MIN",
    1,
    30
  ],
  "7": [
    "MAX",
    1,
    30
  ],
  "8": [
    "ROW",
    0,
    1
  ],
  "9": [
    "COLUMN",
    0,
    1
  ],
  "10": [
    "NA",
    0,
    0
  ],
  "11": [
    "NPV",
    2,
    30
  ],
  "12": [
    "STDEV",
    1,
    30
  ],
  "13": [
    "DOLLAR",
    1,
    2
  ],
  "14": [
    "FIXED",
    2,
    3
  ],
  "15": [
    "SIN",
    1,
    1
  ],
  "16": [
    "COS",
    1,
    1
  ],
  "17": [
    "TAN",
    1,
    1
  ],
  "18": [
    "ATAN",
    1,
    1
  ],
  "19": [
    "PI",
    0,
    0
  ],
  "20": [
    "SQRT",
    1,
    1
  ],
  "21": [
    "EXP",
    1,
    1
  ],
  "22": [
    "LN",
    1,
    1
  ],
  "23": [
    "LOG10",
    1,
    1
  ],
  "24": [
    "ABS",
    1,
    1
  ],
  "25": [
    "INT",
    1,
    1
  ],
  "26": [
    "SIGN",
    1,
    1
  ],
  "27": [
    "ROUND",
    2,
    2
  ],
  "28": [
    "LOOKUP",
    2,
    3
  ],
  "29": [
    "INDEX",
    2,
    4
  ],
  "30": [
    "REPT",
    2,
    2
  ],
  "31": [
    "MID",
    3,
    3
  ],
  "32": [
    "LEN",
    1,
    1
  ],
  "33": [
    "VALUE",
    1,
    1
  ],
  "34": [
    "TRUE",
    0,
    0
  ],
  "35": [
    "FALSE",
    0,
    0
  ],
  "36": [
    "AND",
    1,
    30
  ],
  "37": [
    "OR",
    1,
    30
  ],
  "38": [
    "NOT",
    1,
    1
  ],
  "39": [
    "MOD",
    2,
    2
  ],
  "40": [
    "DCOUNT",
    3,
    3
  ],
  "41": [
    "DSUM",
    3,
    3
  ],
  "42": [
    "DAVERAGE",
    3,
    3
  ],
  "43": [
    "DMIN",
    3,
    3
  ],
  "44": [
    "DMAX",
    3,
    3
  ],
  "45": [
    "DSTDEV",
    3,
    3
  ],
  "46": [
    "VAR",
    1,
    30
  ],
  "47": [
    "DVAR",
    3,
    3
  ],
  "48": [
    "TEXT",
    2,
    2
  ],
  "49": [
    "LINEST",
    1,
    4
  ],
  "50": [
    "TREND",
    1,
    4
  ],
  "51": [
    "LOGEST",
    1,
    4
  ],
  "52": [
    "GROWTH",
    1,
    4
  ],
  "53": [
    "GOTO",
    -1,
    -1
  ],
  "54": [
    "HALT",
    -1,
    -1
  ],
  "55": [
    "RETURN",
    -1,
    -1
  ],
  "56": [
    "PV",
    3,
    5
  ],
  "57": [
    "FV",
    3,
    5
  ],
  "58": [
    "NPER",
    3,
    5
  ],
  "59": [
    "PMT",
    3,
    5
  ],
  "60": [
    "RATE",
    3,
    6
  ],
  "61": [
    "MIRR",
    3,
    3
  ],
  "62": [
    "IRR",
    1,
    2
  ],
  "63": [
    "RAND",
    0,
    0
  ],
  "64": [
    "MATCH",
    2,
    3
  ],
  "65": [
    "DATE",
    3,
    3
  ],
  "66": [
    "TIME",
    3,
    3
  ],
  "67": [
    "DAY",
    1,
    1
  ],
  "68": [
    "MONTH",
    1,
    1
  ],
  "69": [
    "YEAR",
    1,
    1
  ],
  "70": [
    "WEEKDAY",
    1,
    2
  ],
  "71": [
    "HOUR",
    1,
    1
  ],
  "72": [
    "MINUTE",
    1,
    1
  ],
  "73": [
    "SECOND",
    1,
    1
  ],
  "74": [
    "NOW",
    0,
    0
  ],
  "75": [
    "AREAS",
    1,
    1
  ],
  "76": [
    "ROWS",
    1,
    1
  ],
  "77": [
    "COLUMNS",
    1,
    1
  ],
  "78": [
    "OFFSET",
    3,
    5
  ],
  "79": [
    "ABSREF",
    -1,
    -1
  ],
  "80": [
    "RELREF",
    -1,
    -1
  ],
  "81": [
    "ARGUMENT",
    -1,
    -1
  ],
  "82": [
    "SEARCH",
    2,
    3
  ],
  "83": [
    "TRANSPOSE",
    1,
    1
  ],
  "84": [
    "ERROR",
    -1,
    -1
  ],
  "85": [
    "STEP",
    -1,
    -1
  ],
  "86": [
    "TYPE",
    1,
    1
  ],
  "87": [
    "ECHO",
    -1,
    -1
  ],
  "88": [
    "SETNAME",
    -1,
    -1
  ],
  "89": [
    "CALLER",
    -1,
    -1
  ],
  "90": [
    "DEREF",
    -1,
    -1
  ],
  "91": [
    "WINDOWS",
    -1,
    -1
  ],
  "92": [
    "SERIES",
    4,
    4
  ],
  "93": [
    "DOCUMENTS",
    -1,
    -1
  ],
  "94": [
    "ACTIVE.CELL",
    -1,
    -1
  ],
  "95": [
    "SELECTION",
    -1,
    -1
  ],
  "96": [
    "RESULT",
    -1,
    -1
  ],
  "97": [
    "ATAN2",
    2,
    2
  ],
  "98": [
    "ASIN",
    1,
    1
  ],
  "99": [
    "ACOS",
    1,
    1
  ],
  "100": [
    "CHOOSE",
    2,
    30
  ],
  "101": [
    "HLOOKUP",
    3,
    4
  ],
  "102": [
    "VLOOKUP",
    3,
    4
  ],
  "103": [
    "LINKS",
    -1,
    -1
  ],
  "104": [
    "INPUT",
    -1,
    -1
  ],
  "105": [
    "ISREF",
    1,
    1
  ],
  "106": [
    "GET.FORMULA",
    1,
    1
  ],
  "107": [
    "GET.NAME",
    1,
    1
  ],
  "108": [
    "SET.VALUE",
    -1,
    -1
  ],
  "109": [
    "LOG",
    1,
    2
  ],
  "110": [
    "EXEC",
    -1,
    -1
  ],
  "111": [
    "CHAR",
    1,
    1
  ],
  "112": [
    "LOWER",
    1,
    1
  ],
  "113": [
    "UPPER",
    1,
    1
  ],
  "114": [
    "PROPER",
    1,
    1
  ],
  "115": [
    "LEFT",
    1,
    2
  ],
  "116": [
    "RIGHT",
    1,
    2
  ],
  "117": [
    "EXACT",
    2,
    2
  ],
  "118": [
    "TRIM",
    1,
    1
  ],
  "119": [
    "REPLACE",
    4,
    4
  ],
  "120": [
    "SUBSTITUTE",
    3,
    4
  ],
  "121": [
    "CODE",
    1,
    1
  ],
  "122": [
    "NAMES",
    -1,
    -1
  ],
  "123": [
    "DIRECTORY",
    -1,
    -1
  ],
  "124": [
    "FIND",
    2,
    3
  ],
  "125": [
    "CELL",
    1,
    2
  ],
  "126": [
    "ISERR",
    1,
    1
  ],
  "127": [
    "ISTEXT",
    1,
    1
  ],
  "128": [
    "ISNUMBER",
    1,
    1
  ],
  "129": [
    "ISBLANK",
    1,
    1
  ],
  "130": [
    "T",
    1,
    1
  ],
  "131": [
    "N",
    1,
    1
  ],
  "132": [
    "FOPEN",
    -1,
    -1
  ],
  "133": [
    "FCLOSE",
    -1,
    -1
  ],
  "134": [
    "FSIZE",
    -1,
    -1
  ],
  "135": [
    "FREADLN",
    -1,
    -1
  ],
  "136": [
    "FREAD",
    -1,
    -1
  ],
  "137": [
    "FWRITELN",
    -1,
    -1
  ],
  "138": [
    "FWRITE",
    -1,
    -1
  ],
  "139": [
    "FPOS",
    -1,
    -1
  ],
  "140": [
    "DATEVALUE",
    1,
    1
  ],
  "141": [
    "TIMEVALUE",
    1,
    1
  ],
  "142": [
    "SLN",
    3,
    3
  ],
  "143": [
    "SYD",
    4,
    4
  ],
  "144": [
    "DDB",
    4,
    5
  ],
  "145": [
    "GET.DEF",
    -1,
    -1
  ],
  "146": [
    "REFTEXT",
    -1,
    -1
  ],
  "147": [
    "TEXTREF",
    -1,
    -1
  ],
  "148": [
    "INDIRECT",
    1,
    2
  ],
  "149": [
    "REGISTER",
    -1,
    -1
  ],
  "150": [
    "CALL",
    -1,
    -1
  ],
  "151": [
    "ADD.BAR",
    -1,
    -1
  ],
  "152": [
    "ADD.MENU",
    -1,
    -1
  ],
  "153": [
    "ADD.COMMAND",
    -1,
    -1
  ],
  "154": [
    "ENABLE.COMMAND",
    -1,
    -1
  ],
  "155": [
    "CHECK.COMMAND",
    -1,
    -1
  ],
  "156": [
    "RENAME.COMMAND",
    -1,
    -1
  ],
  "157": [
    "SHOW.BAR",
    -1,
    -1
  ],
  "158": [
    "DELETE.MENU",
    -1,
    -1
  ],
  "159": [
    "DELETE.COMMAND",
    -1,
    -1
  ],
  "160": [
    "GET.CHART.ITEM",
    -1,
    -1
  ],
  "161": [
    "DIALOG.BOX",
    -1,
    -1
  ],
  "162": [
    "CLEAN",
    1,
    1
  ],
  "163": [
    "MDETERM",
    1,
    1
  ],
  "164": [
    "MINVERSE",
    1,
    1
  ],
  "165": [
    "MMULT",
    2,
    2
  ],
  "166": [
    "FILES",
    -1,
    -1
  ],
  "167": [
    "IPMT",
    4,
    6
  ],
  "168": [
    "PPMT",
    4,
    6
  ],
  "169": [
    "COUNTA",
    0,
    30
  ],
  "170": [
    "CANCELKEY",
    -1,
    -1
  ],
  "171": [
    "FOR",
    -1,
    -1
  ],
  "172": [
    "WHILE",
    -1,
    -1
  ],
  "173": [
    "BREAK",
    -1,
    -1
  ],
  "174": [
    "NEXT",
    -1,
    -1
  ],
  "175": [
    "INITIATE",
    -1,
    -1
  ],
  "176": [
    "REQUEST",
    -1,
    -1
  ],
  "177": [
    "POKE",
    -1,
    -1
  ],
  "178": [
    "EXECUTE",
    -1,
    -1
  ],
  "179": [
    "TERMINATE",
    -1,
    -1
  ],
  "180": [
    "RESTART",
    -1,
    -1
  ],
  "181": [
    "HELP",
    -1,
    -1
  ],
  "182": [
    "GET.BAR",
    -1,
    -1
  ],
  "183": [
    "PRODUCT",
    0,
    30
  ],
  "184": [
    "FACT",
    1,
    1
  ],
  "185": [
    "GET.CELL",
    -1,
    -1
  ],
  "186": [
    "GET.WORKSPACE",
    -1,
    -1
  ],
  "187": [
    "GET.WINDOW",
    -1,
    -1
  ],
  "188": [
    "GET.DOCUMENT",
    -1,
    -1
  ],
  "189": [
    "DPRODUCT",
    3,
    3
  ],
  "190": [
    "ISNONTEXT",
    1,
    1
  ],
  "191": [
    "GET.NOTE",
    -1,
    -1
  ],
  "192": [
    "NOTE",
    -1,
    -1
  ],
  "193": [
    "STDEVP",
    1,
    30
  ],
  "194": [
    "VARP",
    1,
    30
  ],
  "195": [
    "DSTDEVP",
    3,
    3
  ],
  "196": [
    "DVARP",
    3,
    3
  ],
  "197": [
    "TRUNC",
    1,
    2
  ],
  "198": [
    "ISLOGICAL",
    1,
    1
  ],
  "199": [
    "DCOUNTA",
    3,
    3
  ],
  "200": [
    "DELETE.BAR",
    -1,
    -1
  ],
  "201": [
    "UNREGISTER",
    -1,
    -1
  ],
  "202": [
    "EXCELFUNC202",
    -1,
    -1
  ],
  "203": [
    "EXCELFUNC203",
    -1,
    -1
  ],
  "204": [
    "USDOLLAR",
    1,
    2
  ],
  "205": [
    "FINDB",
    2,
    3
  ],
  "206": [
    "SEARCHB",
    2,
    3
  ],
  "207": [
    "REPLACEB",
    4,
    4
  ],
  "208": [
    "LEFTB",
    1,
    2
  ],
  "209": [
    "RIGHTB",
    1,
    2
  ],
  "210": [
    "MIDB",
    3,
    3
  ],
  "211": [
    "LENB",
    1,
    1
  ],
  "212": [
    "ROUNDUP",
    2,
    2
  ],
  "213": [
    "ROUNDDOWN",
    2,
    2
  ],
  "214": [
    "ASC",
    1,
    1
  ],
  "215": [
    "DBCS",
    1,
    1
  ],
  "216": [
    "RANK",
    2,
    3
  ],
  "217": [
    "EXCELFUNC217",
    -1,
    -1
  ],
  "218": [
    "EXCELFUNC218",
    -1,
    -1
  ],
  "219": [
    "ADDRESS",
    2,
    5
  ],
  "220": [
    "DAYS360",
    2,
    3
  ],
  "221": [
    "TODAY",
    0,
    0
  ],
  "222": [
    "VDB",
    5,
    7
  ],
  "223": [
    "ELSE",
    -1,
    -1
  ],
  "224": [
    "ELSE.IF",
    -1,
    -1
  ],
  "225": [
    "END.IF",
    -1,
    -1
  ],
  "226": [
    "FOR.CELL",
    -1,
    -1
  ],
  "227": [
    "MEDIAN",
    1,
    30
  ],
  "228": [
    "SUMPRODUCT",
    1,
    30
  ],
  "229": [
    "SINH",
    1,
    1
  ],
  "230": [
    "COSH",
    1,
    1
  ],
  "231": [
    "TANH",
    1,
    1
  ],
  "232": [
    "ASINH",
    1,
    1
  ],
  "233": [
    "ACOSH",
    1,
    1
  ],
  "234": [
    "ATANH",
    1,
    1
  ],
  "235": [
    "DGET",
    3,
    3
  ],
  "236": [
    "CREATE.OBJECT",
    -1,
    -1
  ],
  "237": [
    "VOLATILE",
    -1,
    -1
  ],
  "238": [
    "LAST.ERROR",
    -1,
    -1
  ],
  "239": [
    "CUSTOM.UNDO",
    -1,
    -1
  ],
  "240": [
    "CUSTOM.REPEAT",
    -1,
    -1
  ],
  "241": [
    "FORMULA.CONVERT",
    -1,
    -1
  ],
  "242": [
    "GET.LINK.INFO",
    -1,
    -1
  ],
  "243": [
    "TEXT.BOX",
    -1,
    -1
  ],
  "244": [
    "INFO",
    1,
    1
  ],
  "245": [
    "GROUP",
    -1,
    -1
  ],
  "246": [
    "GET.OBJECT",
    -1,
    -1
  ],
  "247": [
    "DB",
    4,
    5
  ],
  "248": [
    "PAUSE",
    -1,
    -1
  ],
  "249": [
    "EXCELFUNC249",
    -1,
    -1
  ],
  "250": [
    "EXCELFUNC250",
    -1,
    -1
  ],
  "251": [
    "RESUME",
    -1,
    -1
  ],
  "252": [
    "FREQUENCY",
    2,
    2
  ],
  "253": [
    "ADD.TOOLBAR",
    -1,
    -1
  ],
  "254": [
    "DELETE.TOOLBAR",
    -1,
    -1
  ],
  "255": [
    "extension slot",
    -1,
    -1
  ],
  "256": [
    "RESET.TOOLBAR",
    -1,
    -1
  ],
  "257": [
    "EVALUATE",
    -1,
    -1
  ],
  "258": [
    "GET.TOOLBAR",
    -1,
    -1
  ],
  "259": [
    "GET.TOOL",
    -1,
    -1
  ],
  "260": [
    "SPELLING.CHECK",
    -1,
    -1
  ],
  "261": [
    "ERROR.TYPE",
    1,
    1
  ],
  "262": [
    "APP.TITLE",
    -1,
    -1
  ],
  "263": [
    "WINDOW.TITLE",
    -1,
    -1
  ],
  "264": [
    "SAVE.TOOLBAR",
    -1,
    -1
  ],
  "265": [
    "ENABLE.TOOL",
    -1,
    -1
  ],
  "266": [
    "PRESS.TOOL",
    -1,
    -1
  ],
  "267": [
    "REGISTER.ID",
    -1,
    -1
  ],
  "268": [
    "GET.WORKBOOK",
    -1,
    -1
  ],
  "269": [
    "AVEDEV",
    1,
    30
  ],
  "270": [
    "BETADIST",
    3,
    5
  ],
  "271": [
    "GAMMALN",
    1,
    1
  ],
  "272": [
    "BETAINV",
    3,
    5
  ],
  "273": [
    "BINOMDIST",
    4,
    4
  ],
  "274": [
    "CHIDIST",
    2,
    2
  ],
  "275": [
    "CHIINV",
    2,
    2
  ],
  "276": [
    "COMBIN",
    2,
    2
  ],
  "277": [
    "CONFIDENCE",
    3,
    3
  ],
  "278": [
    "CRITBINOM",
    3,
    3
  ],
  "279": [
    "EVEN",
    1,
    1
  ],
  "280": [
    "EXPONDIST",
    3,
    3
  ],
  "281": [
    "FDIST",
    3,
    3
  ],
  "282": [
    "FINV",
    3,
    3
  ],
  "283": [
    "FISHER",
    1,
    1
  ],
  "284": [
    "FISHERINV",
    1,
    1
  ],
  "285": [
    "FLOOR",
    2,
    2
  ],
  "286": [
    "GAMMADIST",
    4,
    4
  ],
  "287": [
    "GAMMAINV",
    3,
    3
  ],
  "288": [
    "CEILING",
    2,
    2
  ],
  "289": [
    "HYPGEOMDIST",
    4,
    4
  ],
  "290": [
    "LOGNORMDIST",
    3,
    3
  ],
  "291": [
    "LOGINV",
    3,
    3
  ],
  "292": [
    "NEGBINOMDIST",
    3,
    3
  ],
  "293": [
    "NORMDIST",
    4,
    4
  ],
  "294": [
    "NORMSDIST",
    1,
    1
  ],
  "295": [
    "NORMINV",
    3,
    3
  ],
  "296": [
    "NORMSINV",
    1,
    1
  ],
  "297": [
    "STANDARDIZE",
    3,
    3
  ],
  "298": [
    "ODD",
    1,
    1
  ],
  "299": [
    "PERMUT",
    2,
    2
  ],
  "300": [
    "POISSON",
    3,
    3
  ],
  "301": [
    "TDIST",
    3,
    3
  ],
  "302": [
    "WEIBULL",
    4,
    4
  ],
  "303": [
    "SUMXMY2",
    2,
    2
  ],
  "304": [
    "SUMX2MY2",
    2,
    2
  ],
  "305": [
    "SUMX2PY2",
    2,
    2
  ],
  "306": [
    "CHITEST",
    2,
    2
  ],
  "307": [
    "CORREL",
    2,
    2
  ],
  "308": [
    "COVAR",
    2,
    2
  ],
  "309": [
    "FORECAST",
    3,
    3
  ],
  "310": [
    "FTEST",
    2,
    2
  ],
  "311": [
    "INTERCEPT",
    2,
    2
  ],
  "312": [
    "PEARSON",
    2,
    2
  ],
  "313": [
    "RSQ",
    2,
    2
  ],
  "314": [
    "STEYX",
    2,
    2
  ],
  "315": [
    "SLOPE",
    2,
    2
  ],
  "316": [
    "TTEST",
    4,
    4
  ],
  "317": [
    "PROB",
    3,
    4
  ],
  "318": [
    "DEVSQ",
    1,
    30
  ],
  "319": [
    "GEOMEAN",
    1,
    30
  ],
  "320": [
    "HARMEAN",
    1,
    30
  ],
  "321": [
    "SUMSQ",
    0,
    30
  ],
  "322": [
    "KURT",
    1,
    30
  ],
  "323": [
    "SKEW",
    1,
    30
  ],
  "324": [
    "ZTEST",
    2,
    3
  ],
  "325": [
    "LARGE",
    2,
    2
  ],
  "326": [
    "SMALL",
    2,
    2
  ],
  "327": [
    "QUARTILE",
    2,
    2
  ],
  "328": [
    "PERCENTILE",
    2,
    2
  ],
  "329": [
    "PERCENTRANK",
    2,
    3
  ],
  "330": [
    "MODE",
    1,
    30
  ],
  "331": [
    "TRIMMEAN",
    2,
    2
  ],
  "332": [
    "TINV",
    2,
    2
  ],
  "333": [
    "EXCELFUNC333",
    -1,
    -1
  ],
  "334": [
    "MOVIE.COMMAND",
    -1,
    -1
  ],
  "335": [
    "GET.MOVIE",
    -1,
    -1
  ],
  "336": [
    "CONCATENATE",
    0,
    30
  ],
  "337": [
    "POWER",
    2,
    2
  ],
  "338": [
    "PIVOT.ADD.DATA",
    -1,
    -1
  ],
  "339": [
    "GET.PIVOT.TABLE",
    -1,
    -1
  ],
  "340": [
    "GET.PIVOT.FIELD",
    -1,
    -1
  ],
  "341": [
    "GET.PIVOT.ITEM",
    -1,
    -1
  ],
  "342": [
    "RADIANS",
    1,
    1
  ],
  "343": [
    "DEGREES",
    1,
    1
  ],
  "344": [
    "SUBTOTAL",
    2,
    30
  ],
  "345": [
    "SUMIF",
    2,
    3
  ],
  "346": [
    "COUNTIF",
    2,
    2
  ],
  "347": [
    "COUNTBLANK",
    1,
    1
  ],
  "348": [
    "SCENARIO.GET",
    -1,
    -1
  ],
  "349": [
    "OPTIONS.LISTS.GET",
    -1,
    -1
  ],
  "350": [
    "ISPMT",
    4,
    4
  ],
  "351": [
    "DATEDIF",
    3,
    3
  ],
  "352": [
    "DATESTRING",
    1,
    1
  ],
  "353": [
    "NUMBERSTRING",
    2,
    2
  ],
  "354": [
    "ROMAN",
    1,
    2
  ],
  "355": [
    "OPEN.DIALOG",
    -1,
    -1
  ],
  "356": [
    "SAVE.DIALOG",
    -1,
    -1
  ],
  "357": [
    "VIEW.GET",
    -1,
    -1
  ],
  "358": [
    "GETPIVOTDATA",
    2,
    30
  ],
  "359": [
    "HYPERLINK",
    1,
    2
  ],
  "360": [
    "PHONETIC",
    1,
    1
  ],
  "361": [
    "AVERAGEA",
    1,
    30
  ],
  "362": [
    "MAXA",
    1,
    30
  ],
  "363": [
    "MINA",
    1,
    30
  ],
  "364": [
    "STDEVPA",
    1,
    30
  ],
  "365": [
    "VARPA",
    1,
    30
  ],
  "366": [
    "STDEVA",
    1,
    30
  ],
  "367": [
    "VARA",
    1,
    30
  ],
  "368": [
    "BAHTTEXT",
    1,
    1
  ],
  "369": [
    "THAIDAYOFWEEK",
    1,
    1
  ],
  "370": [
    "THAIDIGIT",
    1,
    1
  ],
  "371": [
    "THAIMONTHOFYEAR",
    1,
    1
  ],
  "372": [
    "THAINUMSOUND",
    1,
    1
  ],
  "373": [
    "THAINUMSTRING",
    1,
    1
  ],
  "374": [
    "THAISTRINGLENGTH",
    1,
    1
  ],
  "375": [
    "ISTHAIDIGIT",
    1,
    1
  ],
  "376": [
    "ROUNDBAHTDOWN",
    1,
    1
  ],
  "377": [
    "ROUNDBAHTUP",
    1,
    1
  ],
  "378": [
    "THAIYEAR",
    1,
    1
  ],
  "379": [
    "RTD",
    2,
    5
  ],
  "380": [
    "ISHYPERLINK",
    1,
    1
  ]
};
