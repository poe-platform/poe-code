import {unpackCodepage} from "./codepage-table.js";
// Additional fixed character maps from the pinned CPython 3.9 standard library.
// Kept with file decoding so CSVkit does not acquire unused codec tables.
const table0 = unpackCodepage("oQEOoTnb///bA98/Dt8c/P///AM=");
const table1 = unpackCodepage("oP//", table0);
const table2 = unpackCodepage("oQEEoQuuDgSuQfAWIfFRBPEL/acA/l4E/gE=");
const table3 = unpackCodepage("0B4B3TAB3l4B8B8B/TEB/l8B");
const table4 = unpackCodepage("pKwgpmABqGEBtH0BuH4BvFIBvAG+eAE=");
const table5 = unpackCodepage("of//qtcAuvcAv///vx/fFyDg0AXgGvv///sB/Q4g/QH///8=");
const table6 = unpackCodepage("oRggoQGkrCClryCqegOu//+vFSC0hAO0AriIA7gCvIwDvo4DvhPTowPTKw==", table5);
const table7 = unpackCodepage("of//oQKl//+lBqwMBq7//64MuxsGvP//vAK/HwbA///BIQbBGdv//9sE4EAG4BLz///zDA==");
const table8 = unpackCodepage("gKwgghogg5IBhB4ghSYghiAghgGIxgKJMCCKYAGLOSCMUgGNZiaOYyaPZSaQYCaRGCCRAZMcIJMBlSIglhMglgGY3AKZIiGaYQGcUwGfeAE=");
const table9 = unpackCodepage("gf//iv//jf//jQOa//+bOiCd//+dAcMCAcwAA9AQAdIJA9WgAd2vAd4DA+MDAewBA/ARAfIjA/WhAf2wAf6rIA==", table8);
const table10 = unpackCodepage("oQIeoQGkCgGkAaYKHqiAHqqCHqsLHqzyHq94AbAeHrABsiABsgG0QB60AbdWHriBHrlXHrqDHrtgHrzzHr2EHr0Bv2Ee0HQB12oe3nYB8HUB92se/ncB");
const table11 = unpackCodepage("oQQBoQGjQQGlHiCqGAKseQGuegGuAbIMAbNCAbUdILkNAboZAr98AcMCAcUGAdAQAdFDAdVQAddaAdhwAd0YAd4aAuMDAeUHAfARAfFEAfVRAfdbAfhxAf0ZAf4bAg==", table4);
const table12 = unpackCodepage("gAIEgAGDUwSIrCCKCQSMCgSNmgSOugSPDwSQUgSY//+aWQScWgSdmwSeuwSfXwShsAShAaPYBKXoBKgBBKqSBK+uBLIGBLNWBLTpBLhRBLkWIbqTBLzZBL2iBL0Bv68EwBAEwD8=", table9);
const table13 = unpackCodepage("oSYBotgCpf//piQBqTABql4Bqx4BrDQBrv//r3sBsScBtiUBuTEBul8Bux8BvDUBvv//v3wBw///xQoBxggB0P//1SAB2BwB3WwB3lwB4///5QsB5gkB8P//9SEB+B0B/W0B/l0B/9kC");
const table14 = unpackCodepage("gJYEgZIEgu4Eg5MEhrYEh64EiLIEia8EiqAEi+IEjKIEj7gEkJcEmLMEmbcEmqEEm+MEnKMEn7kEoQ4Eol4EowgEpOgEpZgEprAEqtgEre8Er5wEsbEEtJkEtekEutkEvFgEvaoEvQG/nQQ=", table12);
const table15 = unpackCodepage("oQQBohIBoyIBpCoBpSgBpjYBqDsBqRABqmABq2YBrH0BrmoBr0oBsQUBshMBsyMBtCsBtSkBtjcBuDwBuREBumEBu2cBvH4BvRUgvmsBv0sBwAABxy4ByAwByhgBzBYB0UUB0kwB12gB2XIB4AEB5y8B6A0B6hkB7BcB8UYB8k0B92kB+XMB/zgB");
const table16 = unpackCodepage("ojgBo1YBpKQApjsBqKgAqWABqhIBqyIBrGYBrn0Br68AstsCs1cBtLQAtjwBt8cCuLgAuWEBuhMBuyMBvGcBvUoBvn4BzyoB0BAB0zYB19cA3WgB3moB7ysB8BEB8zcB9/cA/WkB/msB/9kC", table15);
const table17 = unpackCodepage("otgCo0EBpT0BploBql4Bq2QBrHkBr3sBs0IBtT4BtlsBul8Bu2UBvHoBvd0Cv3wBwFQBwwIBxTkBxgYBx8cAzBoBzw4B0UMB0kcB09MA1VAB2FgB2W4B23AB3d0A3mIB4FUB4wMB5ToB5gcB5+cA7BsB7w8B8UQB8kgB8/MA9VEB+FkB+W8B+3EB/f0A/mMB", table16);
const table18 = unpackCodepage("gMQAgaAAgscAg8kAhNEAhdYAhtwAh+EAiOAAieIAiuQAi7oGjKsAjecAjukAj+gAkOoAkAGS7QCTJiCU7gCUAZbxAJfzAJi7AJn0AJr2AJoBnPoAnfkAnvsAngGgIACgBKVqBqYmAKYFrS0ArQKwYAawCbo6ALw8ALwCwEon21sA2wTzfgb0eQb1hgb21Qb3pAb4rwb5iAb6kQb7ewD7Av6YBv/SBg==", table7);
const table19 = unpackCodepage("sPAGsAk=", table18);
const table20 = unpackCodepage("gBAEgC+wkSWwArMCJbQkJbVhJbUBt1YluFUluWMlulElu1clvF0lvVwlvlslvxAlwBQlwTQlwiwlwxwlxAAlxTwlxl4lxgHIWiXJVCXKaSXLZiXMYCXNUCXObCXPZyXPAdFkJdEB01kl1Fgl1VIl1QHXayXYaiXZGCXaDCXbiCXchCXdjCXekCXfgCXwAQTykATyAfQEBPVUBPYGBPdWBPgHBPlXBPq3APsaIvwWIf2kAP6gJf+gAA==", table2);
const table21 = unpackCodepage("gIAAgAGC6QCD4gCEhACF4ACGhgCH5wCI6gCIAYroAIvvAIzuAI2NAI0DkVEGkQGT9ACUpACVQAaW+wCX+QCYIQaYA5yjAJ0lBp0QrqsAr7sA4DYG4ATlQQbmtQDnQgbnCPBhIvFLBvEF90gi+LAA+Rki/H8g/bIA", table20);
const table22 = unpackCodepage("gNAFgBqb//+d//+e1wCf//+fCamuAKqsAKu9AKy8AK3//7X//7UCuKkAvaIAvqUAxv//xgHPpADQ///QCN2mAN7//+D//+AF5///5wburwDvtADwrQDxsQDyFyDzvgD0tgD1pwD29wD3uAD5qAD7uQD8swA=", table21);
const table23 = unpackCodepage("gNAFgBqbogCdpQCepyCfkgGg4QCh7QCi8wCj+gCk8QCl0QCmqgCnugCovwCpECOqrACrvQCsvACtoQDgsQPh3wDikwPjwAPkowPlwwPnxAPopgPpmAPqqQPrtAPsHiLtxgPutQPvKSLxsQDyZSLzZCL0ICP0Afb3AA==", table21);
const table24 = unpackCodepage("gP//gAWGhgOH//+ItwCJrACKpgCLGCCLAY2IA44VII+JA48BkaoDkowDk///kwGVjgOWqwOXqQCYjwOZsgCZAZusA52tA50CoMoDoZADoswDogGkkQOkBqyYA6wBtZoDtQO9ngO9AcagA8YBz6MDzwbWsQPWAt20A90B4LYD4AvswwPtwgPuxAPvhAPyxQPyAvbIA/eFA/rJA/vLA/ywA/3OAw==", table22);
const table25 = unpackCodepage("oR0gpR4gqNgAqlYBr8YAtBwguPgAulcBv+YAwAQBwS4BwgABwwYBxhgBxxIByAwBynkByxYBzCIBzTYBzioBzzsB0GAB0UMB0kUB1EwB2HIB2UEB2loB22oB3XsB3n0B4AUB4S8B4gEB4wcB5hkB5xMB6A0B6noB6xcB7CMB7TcB7isB7zwB8GEB8UQB8kYB9E0B+HMB+UIB+lsB+2sB/XwB/n4B/xkg");
const table26 = unpackCodepage("gKwggf//ghogg///hB4ghSYghiAghgGI//+JMCCK//+LOSCM//+NqACOxwKPuACQ//+RGCCRAZMcIJMBlSIglhMglgGY//+ZIiGa//+bOiCc//+drwCe2wKf//+h//+l//+0tAD/2QI=", table25);
const table27 = unpackCodepage("gMcAgfwAgukAg+IAhOQAheAAhuUAh+cAiOoAiAGK6ACL7wCM7gCN7ACOxACOAZDJAJHmAJLGAJP0AJT2AJXyAJb7AJf5AJj/AJnWAJrcAJv4AJ3YAJ+SAaDhAKHtAKLzAKP6AKTxAKXRAKaqAKe6AKi/AK2hALXBALUBt8AAxuMAx8MA0PAA0dAA0soA0gHUyADVrCDWzQDWAt7MAODTAOHfAOLUAOPSAOT1AOXVAOf+AOjeAOnaAOkB69kA7P0A7d0A", table22);
const table28 = unpackCodepage("gAYBgwEBhSMBhwcBiEIBiRMBilYBigGMKwGNeQGTTQGVIgGWogCXWgGXAZ+kAKAAAaEqAaN7AaMBpXoBph0gp6YAqKkArUEBtQQBtgwBtxgBuBYBvS4BvmABxnIBx2oBz30B0AUB0Q0B0hkB0xcB1C8B1WEB1nMB12sB2H4B3Ywl3pAl4kwB40MB50QB6DYB6AHqOwHqAexGAe0SAe5FAe8ZIPIcIPceIPkZIg==", table27);
const table29 = unpackCodepage("gJsEgZMEg5IEirMEjLIEjbcEjrYEj///kJoEnf//nQGg//+h7wSi7gSjUQSl4wSo//+oAq///7MBBLT//7XiBLj//7kWIbr//7z//7wCv6kAwE4EwTAEwQHDRgTENATEAcZEBMczBMhFBMk4BMkH0U8E0kAE0gPWNgTXMgTYTATZSwTaNwTbSATcTQTdSQTeRwTfSgTgLgThEAThAeMmBOQUBOQB5iQE5xME6CUE6RgE6QfxLwTyIATyA/YWBPcSBPgsBPkrBPoXBPsoBPwtBP0pBP4nBP8qBA==", table26);
const table30 = unpackCodepage("gAAlgQIlggwlgxAlhBQlhRglhhwlhyQliCwliTQlijwli4AljIQljYgljowlj5AljwOTICOUoCWVGSKVAZdIIphkIpgBmqAAmyEjnLAAnbIAnrcAn/cAoFAloAKkUyWkDrRiJbQK", table29);
const table31 = unpackCodepage("pFQEplYEpgGtkQS0BAS2BgS2Ab2QBA==", table30);
const table32 = unpackCodepage("ofAGoQmrDAasGwauHwavgf6wjf6wAbKO/rIBtJH+tVb7tlj7t5P+uJX+uZf+umb7u2j7vJn+vZv+vp3+v5/+wHr7wXz7wqH+w6P+xKX+xaf+xqn+x4T7yKv+ya3+yoz7y6/+zIr7zbH+zrP+z7X+0Lf+0bn+0rv+073+1L/+1cH+1sX+18n+1wjg0/7h1f7i1/7j2f7k2/7lkvvmlPvn3f7o3/7oAuvj/uye++3l/u7n/u+F/vDt/vGm+/Ko+/IC9YD+9on+9gL58f75Avyw+/2u+/58/v4B");
const table33 = unpackCodepage("gcUAi+MAjOUAk+wAmPIAm/UAoCAgobAAoqIAogGkpwClIiCmtgCn3wCorgCpqQCqIiGrtACsqACtYCKuxgCv2ACwHiKxsQCyZCKyAbSlALW1ALYCIrcRIrgPIrnAA7orIruqALy6AL2pA77mAL/4AMC/AMGhAMKsAMMaIsSSAcVIIsYGIserAMi7AMkmIMqgAMvAAMzDAM3VAM5SAc4B0BMg0AHSHCDSAdQYINQB1vcA18ol2P8A2XgB2h4B2gHcMAHcAd5eAd4B4CEg4bcA4hog4x4g5DAg5cIA5soA58EA6MsA6cgA6s0A6gLtzADu0wDuAfD/+PHSAPLaAPIB9NkA9aD49sYC99wC+K8A+dgC+QL8uAD93QL+2wL/xwI=", table18);
const table34 = unpackCodepage("oN0A2kQg26wg3NAA3fAA3t4A3/4A4P0A9TEB", table33);
const table35 = unpackCodepage("oCAgrgIBrxgCvgMBvxkC3Dkg3AHeGgLeAeAhIA==", table34);
const table36 = unpackCodepage("oCAgqWABrn0BtAYiuWEBvn4BxgYByAwB0BAB2P/42akA3Dkg3AHexgDfuwDgEyDmBwHoDQHwEQH5wAP6ywD9ygD+5gA=", table34);
const table37 = unpackCodepage("ocAAosIAo8gApMoApAGmzgCmAai0AKnLAqrGAquoAKzcAq3ZAK7bAK+kILCvALHdALL9ALOwALTHALXnALbRALfxALihALm/ALqkALujALylAL2nAL6SAb+iAMDiAMHqAML0AMP7AMThAMXpAMbzAMf6AMjgAMnoAMryAMv5AMzkAM3rAM72AM/8ANDFANHuANLYANPGANTlANXtANb4ANfmANjEANnsANrWANvcANzJAN3vAN7fAN/UAODBAOHDAOLjAOPQAOTwAOXNAObMAOfTAOjSAOnVAOr1AOtgAesB7doA7ngB7/8A8N4A8f4A8rcA87UA8wH1vgD2FCD3vAD3AfmqAPq6APurAPygJf27AP6xAA==", table0);
const table38 = unpackCodepage("gFIEgQIEglMEgwMEhFEEhQEEhlQEhwQEiFUEiQUEilYEiwYEjFcEjQcEjlgEjwgEkFkEkQkEkloEkwoElFsElQsEllwElwwEmF4EmQ4Eml8Emw8EnE4EnS4EnkoEnyoEoDAEoRAEojEEoxEEpEYEpSYEpjQEpxQEqDUEqRUEqkQEqyQErDMErRMEtUUEtiUEtzgEuBgEvTkEvhkExjoExxoE0DsE0RsE0jwE0xwE1D0E1R0E1j4E1x4E2D8E3R8E3k8E4C8E4UAE4iAE40EE5CEE5UIE5iIE50ME6CME6TYE6hYE6zIE7BIE7UwE7iwE7xYh8UsE8isE8zcE9BcE9UgE9igE900E+C0E+UkE+ikE+0cE/CcE/acA", table22);
const table39 = unpackCodepage("JWoGgLAAgbcAghkiggGEkiWFACWGAiWHPCWIJCWJLCWKHCWLNCWMECWNDCWOFCWPGCWQsgORHiKSxgOTsQCUvQCVvACWSCKXqwCYuwCZ9/6ZAZv//5sBnfv+nQGf//+hrQCigv6jowClhP6ojv6oAaqV/quZ/q2d/q6h/q+l/rBgBrAJutH+vLH+vbX+vrn+wKIAwYD+wQHDg/7Ehf7Fyv7Gi/7Hjf7Ikf7Jk/7Kl/7Lm/7Mn/7No/7Op/7Pqf7Qq/7Rrf7Sr/7Ts/7Ut/7Vu/7Wv/7Xwf7Yxf7Zy/7az/7bpgDcrADd9wDe1wDfyf7h0/7i1/7j2/7k3/7l4/7m5/7n6/7o7f7p7/7q8/7rvf7szP7tzv7uzf7v4f7wff7y5f7z6f707P718P728v730P741f759f75Afvd/vzZ/v3x/v6gJQ==", table7);
const table40 = unpackCodepage("BJwABQkABoYAB38ACJcACY0ACQEUnQAVhQAWCAAXhwAakgAbjwAggAAgBCUKACYXACcbACiIACgELQUALQIwkAAwATIWADOTADMDNwQAOJgAOAM8FAA8AT6eAD8aAEAgAEHQBUEISqIASy4ATDwATSgATisAT3wAUCYAUdkFUQhaIQBbJABcKgBdKQBeOwBfrABgLQBhLwBi4gViB2qmAGssAGwlAG1fAG4+AG4BcP//ceoFcv//cgF0oAB1//91AngXIHlgAHo6AHsjAHxAAH0nAH49AH8iAID//4FhAIEIiqsAi7sAjP//jAKPsQCQsACRagCRCJr//5oCnbgAnv//n6QAoLUAoX4AonMAogeq//+qBK+uALBeALGjALKlALO3ALSpALWnALe8ALcCulsAu10AvK8AvagAvrQAv9cAwHsAwUEAwQjKrQDQfQDRSgDRCNq5AN///+BcAOH3AOJTAOIH6rIA6///6wTwMADwCfqzAP3///0B/58A", table5);
const table41 = unpackCodepage("QaAAQuIAQ+QAROAARAFG4wBH5QBI5wBJ8QBR6QBRAlToAFXtAFUCWOwAWd8AYsIAY8QAZMAAZAFmwwBnxQBoxwBp0QBw+ABxyQBxAnTIAHXNAHUCeMwAgNgAjPAAjf0AjQGaqgCbugCc5gCexgCqoQCrvwCs0ACt3QCtAcv0AMz2AM3yAM0Bz/UA2/sA2wHd+QDdAd//AOvUAOzWAO3SAO0B79UA+9sA+wH92QD9AQ==", table40);
const table42 = unpackCodepage("n6wg", table41);
const table43 = unpackCodepage("SlsATyEAWl0AX14AsKIAuqwAu3wA", table41);
const table44 = unpackCodepage("Q3sASsQAWX4AWtwAY1sAavYAfKcAod8AtUAAvD4gwOQAzKYA0PwA3H0A4NYA7FwA/F0A", table43);
const table45 = unpackCodepage("SHsASscAWh4BWzABaFsAal8BeTEBe9YAfF4Bf9wAjH0AjWAAjqYAofYArF0ArSQArkAAwOcAzH4A0B8B3FwA4PwA7CMA/CIA", table43);
const table46 = unpackCodepage("QZEDQQhRmgNRB1mjA2KkA2IHanwAcKgAcYYDcogDcgF0oAB1igN2jAN3jgN3AYCFA4qxA4oFmrcDmgWgtACqvQOqBK/DA7CjALGsA7ECtMoDta8DtswDtgG4ywO5zgO6wgO7xAO7BMvJA8yQA82wA84YIM8VINqxANu9ANwaAN2HA94ZIN+mAOEaAOunAOwaAO0aAO6rAO4B+6kA/BoA/RoA/rsA", table43);

export const pythonFileCodepages: Readonly<Record<string, readonly number[]>> = Object.freeze({
  "cp037": table41,
  "cp1006": table32,
  "cp1026": table45,
  "cp1125": table20,
  "cp1140": table42,
  "cp1257": table26,
  "cp1258": table9,
  "cp273": table44,
  "cp424": table40,
  "cp500": table43,
  "cp720": table21,
  "cp775": table28,
  "cp855": table38,
  "cp856": table22,
  "cp858": table27,
  "cp862": table23,
  "cp864": table39,
  "cp869": table24,
  "cp875": table46,
  "hp-roman8": table37,
  "iso8859-10": table15,
  "iso8859-11": table0,
  "iso8859-13": table25,
  "iso8859-14": table10,
  "iso8859-15": table4,
  "iso8859-16": table11,
  "iso8859-2": table17,
  "iso8859-3": table13,
  "iso8859-4": table16,
  "iso8859-5": table2,
  "iso8859-6": table7,
  "iso8859-7": table6,
  "iso8859-8": table5,
  "iso8859-9": table3,
  "koi8-r": table30,
  "koi8-t": table29,
  "koi8-u": table31,
  "kz1048": table12,
  "mac-arabic": table18,
  "mac-croatian": table36,
  "mac-farsi": table19,
  "mac-iceland": table34,
  "mac-romanian": table35,
  "mac-turkish": table33,
  "palmos": table8,
  "ptcp154": table14,
  "tis-620": table1
});
