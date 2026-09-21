/** Released 1.12.61 descriptors, authenticated archive; see function-coverage.json. */
export const dateFinanceFunctionDescriptors = {
  "DATE": {
    "signature": "fff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_DATE",
    "group": "fn-date"
  },
  "DATEVALUE": {
    "signature": "f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-date"
  },
  "DATEDIF": {
    "signature": "ffs",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-date"
  },
  "DAY": {
    "signature": "f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-date"
  },
  "DAYS360": {
    "signature": "ff|f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-date"
  },
  "EDATE": {
    "signature": "ff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_DATE",
    "group": "fn-date"
  },
  "EOMONTH": {
    "signature": "f|f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_DATE",
    "group": "fn-date"
  },
  "HOUR": {
    "signature": "f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-date"
  },
  "MINUTE": {
    "signature": "f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-date"
  },
  "MONTH": {
    "signature": "f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-date"
  },
  "NETWORKDAYS": {
    "signature": "ff|?A",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-date"
  },
  "NOW": {
    "signature": "",
    "flags": "GNM_FUNC_VOLATILE + GNM_FUNC_AUTO_TIME",
    "group": "fn-date"
  },
  "ODF.TIME": {
    "signature": "fff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_TIME",
    "group": "fn-date"
  },
  "SECOND": {
    "signature": "f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-date"
  },
  "TIME": {
    "signature": "fff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_TIME",
    "group": "fn-date"
  },
  "TIMEVALUE": {
    "signature": "f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-date"
  },
  "TODAY": {
    "signature": "",
    "flags": "GNM_FUNC_VOLATILE + GNM_FUNC_AUTO_DATE",
    "group": "fn-date"
  },
  "WEEKDAY": {
    "signature": "f|f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-date"
  },
  "WEEKNUM": {
    "signature": "f|f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-date"
  },
  "WORKDAY": {
    "signature": "ff|?A",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_DATE",
    "group": "fn-date"
  },
  "YEAR": {
    "signature": "f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-date"
  },
  "YEARFRAC": {
    "signature": "ff|f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-date"
  },
  "UNIX2DATE": {
    "signature": "f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_DATE",
    "group": "fn-date"
  },
  "DATE2UNIX": {
    "signature": "f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-date"
  },
  "ISOWEEKNUM": {
    "signature": "f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-date"
  },
  "ISOYEAR": {
    "signature": "f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-date"
  },
  "DAYS": {
    "signature": "ff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-date"
  },
  "ACCRINT": {
    "signature": "ffff|fffb",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "ACCRINTM": {
    "signature": "fff|ff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "AMORDEGRC": {
    "signature": "fffffff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "AMORLINC": {
    "signature": "fffffff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "COUPDAYBS": {
    "signature": "fff|fb",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "COUPDAYS": {
    "signature": "fff|fb",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "COUPDAYSNC": {
    "signature": "fff|fb",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "COUPNCD": {
    "signature": "fff|fb",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_DATE",
    "group": "fn-financial"
  },
  "COUPNUM": {
    "signature": "fff|fb",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "COUPPCD": {
    "signature": "fff|fb",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_DATE",
    "group": "fn-financial"
  },
  "CUMIPMT": {
    "signature": "ffffff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "CUMPRINC": {
    "signature": "ffffff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "DB": {
    "signature": "ffff|f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "DDB": {
    "signature": "ffff|f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "DISC": {
    "signature": "ffff|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "DOLLARDE": {
    "signature": "ff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "DOLLARFR": {
    "signature": "ff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "DURATION": {
    "signature": "fffff|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "EFFECT": {
    "signature": "ff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_PERCENT",
    "group": "fn-financial"
  },
  "EURO": {
    "signature": "s",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "EUROCONVERT": {
    "signature": "fss|bf",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "FV": {
    "signature": "fff|ff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "FVSCHEDULE": {
    "signature": "fA",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "G_DURATION": {
    "signature": "fff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "INTRATE": {
    "signature": "ffff|f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_PERCENT",
    "group": "fn-financial"
  },
  "IPMT": {
    "signature": "ffff|ff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "IRR": {
    "signature": "A|f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_PERCENT",
    "group": "fn-financial"
  },
  "ISPMT": {
    "signature": "ffff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "MDURATION": {
    "signature": "fffff|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "MIRR": {
    "signature": "Aff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_PERCENT",
    "group": "fn-financial"
  },
  "NOMINAL": {
    "signature": "ff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_PERCENT",
    "group": "fn-financial"
  },
  "NPER": {
    "signature": "fff|ff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "NPV": {
    "signature": null,
    "flags": "gnumeric_npv",
    "group": "fn-financial"
  },
  "ODDFPRICE": {
    "signature": "fffffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "ODDFYIELD": {
    "signature": "fffffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "ODDLPRICE": {
    "signature": "ffffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "ODDLYIELD": {
    "signature": "ffffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "PMT": {
    "signature": "fff|ff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "PPMT": {
    "signature": "ffff|ff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "PRICE": {
    "signature": "ffffff|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "PRICEDISC": {
    "signature": "ffff|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "PRICEMAT": {
    "signature": "fffff|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "PV": {
    "signature": "fff|ff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "RATE": {
    "signature": "fff|fff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_PERCENT",
    "group": "fn-financial"
  },
  "RRI": {
    "signature": "fff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_PERCENT",
    "group": "fn-financial"
  },
  "RECEIVED": {
    "signature": "ffff|f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "SLN": {
    "signature": "fff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "SYD": {
    "signature": "ffff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "TBILLEQ": {
    "signature": "fff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "TBILLPRICE": {
    "signature": "fff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "TBILLYIELD": {
    "signature": "fff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_PERCENT",
    "group": "fn-financial"
  },
  "VDB": {
    "signature": "fffff|ff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "XIRR": {
    "signature": "AA|f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_PERCENT",
    "group": "fn-financial"
  },
  "XNPV": {
    "signature": "fAA",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_MONETARY",
    "group": "fn-financial"
  },
  "YIELD": {
    "signature": "ffffff|f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_AUTO_PERCENT",
    "group": "fn-financial"
  },
  "YIELDDISC": {
    "signature": "ffff|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "YIELDMAT": {
    "signature": "fffff|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-financial"
  },
  "OPT_BS": {
    "signature": "sfffff|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_BS_DELTA": {
    "signature": "sfffff|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_BS_RHO": {
    "signature": "sfffff|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_BS_THETA": {
    "signature": "sfffff|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_BS_GAMMA": {
    "signature": "fffff|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_BS_VEGA": {
    "signature": "fffff|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_BS_CARRYCOST": {
    "signature": "sfffff|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "CUM_BIV_NORM_DIST": {
    "signature": "fff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_GARMAN_KOHLHAGEN": {
    "signature": "sffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_FRENCH": {
    "signature": "sfffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_JUMP_DIFF": {
    "signature": "sfffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_EXEC": {
    "signature": "sfffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_BJER_STENS": {
    "signature": "sffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_MILTERSEN_SCHWARTZ": {
    "signature": "sfffffffffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_BAW_AMER": {
    "signature": "sffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_RGW": {
    "signature": "fffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_FORWARD_START": {
    "signature": "sfffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_TIME_SWITCH": {
    "signature": "sfffffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_SIMPLE_CHOOSER": {
    "signature": "fffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_COMPLEX_CHOOSER": {
    "signature": "fffffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_ON_OPTIONS": {
    "signature": "sffffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_EXTENDIBLE_WRITER": {
    "signature": "sffffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_2_ASSET_CORRELATION": {
    "signature": "sfffffffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_EURO_EXCHANGE": {
    "signature": "fffffffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_AMER_EXCHANGE": {
    "signature": "fffffffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_SPREAD_APPROX": {
    "signature": "sffffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_FLOAT_STRK_LKBK": {
    "signature": "sfffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_FIXED_STRK_LKBK": {
    "signature": "sffffffff",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "OPT_BINOMIAL": {
    "signature": "ssffffff|f",
    "flags": "GNM_FUNC_SIMPLE",
    "group": "fn-derivatives"
  },
  "ASCENSIONTHURSDAY": {
    "signature": "|f",
    "flags": "GNM_FUNC_VOLATILE + GNM_FUNC_AUTO_DATE",
    "group": "fn-christian-date"
  },
  "ASHWEDNESDAY": {
    "signature": "|f",
    "flags": "GNM_FUNC_VOLATILE + GNM_FUNC_AUTO_DATE",
    "group": "fn-christian-date"
  },
  "EASTERSUNDAY": {
    "signature": "|f",
    "flags": "GNM_FUNC_VOLATILE + GNM_FUNC_AUTO_DATE",
    "group": "fn-christian-date"
  },
  "GOODFRIDAY": {
    "signature": "|f",
    "flags": "GNM_FUNC_VOLATILE + GNM_FUNC_AUTO_DATE",
    "group": "fn-christian-date"
  },
  "PENTECOSTSUNDAY": {
    "signature": "|f",
    "flags": "GNM_FUNC_VOLATILE + GNM_FUNC_AUTO_DATE",
    "group": "fn-christian-date"
  },
  "HDATE": {
    "signature": "|fff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_VOLATILE",
    "group": "fn-hebrew-date"
  },
  "HDATE_HEB": {
    "signature": "|fff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_VOLATILE",
    "group": "fn-hebrew-date"
  },
  "HDATE_DAY": {
    "signature": "|fff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_VOLATILE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-hebrew-date"
  },
  "HDATE_MONTH": {
    "signature": "|fff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_VOLATILE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-hebrew-date"
  },
  "HDATE_YEAR": {
    "signature": "|fff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_VOLATILE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-hebrew-date"
  },
  "HDATE_JULIAN": {
    "signature": "|fff",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_VOLATILE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-hebrew-date"
  },
  "DATE2HDATE": {
    "signature": "|f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_VOLATILE",
    "group": "fn-hebrew-date"
  },
  "DATE2HDATE_HEB": {
    "signature": "|f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_VOLATILE",
    "group": "fn-hebrew-date"
  },
  "DATE2JULIAN": {
    "signature": "|f",
    "flags": "GNM_FUNC_SIMPLE + GNM_FUNC_VOLATILE + GNM_FUNC_AUTO_UNITLESS",
    "group": "fn-hebrew-date"
  }
} as const;
