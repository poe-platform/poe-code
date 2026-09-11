import { FsError, getCommandArguments, readBytes, writeBytes, type CommandContext, type CommandDefinition } from "../contracts/index.js";
import { createOutputOperation, type OutputOperation } from "../contracts/output.js";
import { shellValueByteLength } from "../contracts/value.js";
import { yieldTurn } from "../contracts/yield.js";
import { PublicDiagnostic, publicDiagnosticMessage } from "../diagnostics.js";
import { bufferLimit, encoder } from "./internal.js";
import { RecordBuffer } from "./record-buffer.js";

const glibc231PrintableRanges = [
  0x20, 0x7e, 0xa0, 0x377, 0x37a, 0x37f, 0x384, 0x38a, 0x38c, 0x38c, 0x38e, 0x3a1, 0x3a3, 0x52f, 0x531, 0x556,
  0x559, 0x55f, 0x561, 0x587, 0x589, 0x58a, 0x58d, 0x58f, 0x591, 0x5c7, 0x5d0, 0x5ea, 0x5f0, 0x5f4, 0x600, 0x61c,
  0x61e, 0x70d, 0x70f, 0x74a, 0x74d, 0x7b1, 0x7c0, 0x7fa, 0x800, 0x82d, 0x830, 0x83e, 0x840, 0x85b, 0x85e, 0x85e,
  0x8a0, 0x8b4, 0x8b6, 0x8bd, 0x8d4, 0x983, 0x985, 0x98c, 0x98f, 0x990, 0x993, 0x9a8, 0x9aa, 0x9b0, 0x9b2, 0x9b2,
  0x9b6, 0x9b9, 0x9bc, 0x9c4, 0x9c7, 0x9c8, 0x9cb, 0x9ce, 0x9d7, 0x9d7, 0x9dc, 0x9dd, 0x9df, 0x9e3, 0x9e6, 0x9fb,
  0xa01, 0xa03, 0xa05, 0xa0a, 0xa0f, 0xa10, 0xa13, 0xa28, 0xa2a, 0xa30, 0xa32, 0xa33, 0xa35, 0xa36, 0xa38, 0xa39,
  0xa3c, 0xa3c, 0xa3e, 0xa42, 0xa47, 0xa48, 0xa4b, 0xa4d, 0xa51, 0xa51, 0xa59, 0xa5c, 0xa5e, 0xa5e, 0xa66, 0xa75,
  0xa81, 0xa83, 0xa85, 0xa8d, 0xa8f, 0xa91, 0xa93, 0xaa8, 0xaaa, 0xab0, 0xab2, 0xab3, 0xab5, 0xab9, 0xabc, 0xac5,
  0xac7, 0xac9, 0xacb, 0xacd, 0xad0, 0xad0, 0xae0, 0xae3, 0xae6, 0xaf1, 0xaf9, 0xaf9, 0xb01, 0xb03, 0xb05, 0xb0c,
  0xb0f, 0xb10, 0xb13, 0xb28, 0xb2a, 0xb30, 0xb32, 0xb33, 0xb35, 0xb39, 0xb3c, 0xb44, 0xb47, 0xb48, 0xb4b, 0xb4d,
  0xb56, 0xb57, 0xb5c, 0xb5d, 0xb5f, 0xb63, 0xb66, 0xb77, 0xb82, 0xb83, 0xb85, 0xb8a, 0xb8e, 0xb90, 0xb92, 0xb95,
  0xb99, 0xb9a, 0xb9c, 0xb9c, 0xb9e, 0xb9f, 0xba3, 0xba4, 0xba8, 0xbaa, 0xbae, 0xbb9, 0xbbe, 0xbc2, 0xbc6, 0xbc8,
  0xbca, 0xbcd, 0xbd0, 0xbd0, 0xbd7, 0xbd7, 0xbe6, 0xbfa, 0xc00, 0xc03, 0xc05, 0xc0c, 0xc0e, 0xc10, 0xc12, 0xc28,
  0xc2a, 0xc39, 0xc3d, 0xc44, 0xc46, 0xc48, 0xc4a, 0xc4d, 0xc55, 0xc56, 0xc58, 0xc5a, 0xc60, 0xc63, 0xc66, 0xc6f,
  0xc78, 0xc83, 0xc85, 0xc8c, 0xc8e, 0xc90, 0xc92, 0xca8, 0xcaa, 0xcb3, 0xcb5, 0xcb9, 0xcbc, 0xcc4, 0xcc6, 0xcc8,
  0xcca, 0xccd, 0xcd5, 0xcd6, 0xcde, 0xcde, 0xce0, 0xce3, 0xce6, 0xcef, 0xcf1, 0xcf2, 0xd01, 0xd03, 0xd05, 0xd0c,
  0xd0e, 0xd10, 0xd12, 0xd3a, 0xd3d, 0xd44, 0xd46, 0xd48, 0xd4a, 0xd4f, 0xd54, 0xd63, 0xd66, 0xd7f, 0xd82, 0xd83,
  0xd85, 0xd96, 0xd9a, 0xdb1, 0xdb3, 0xdbb, 0xdbd, 0xdbd, 0xdc0, 0xdc6, 0xdca, 0xdca, 0xdcf, 0xdd4, 0xdd6, 0xdd6,
  0xdd8, 0xddf, 0xde6, 0xdef, 0xdf2, 0xdf4, 0xe01, 0xe3a, 0xe3f, 0xe5b, 0xe81, 0xe82, 0xe84, 0xe84, 0xe87, 0xe88,
  0xe8a, 0xe8a, 0xe8d, 0xe8d, 0xe94, 0xe97, 0xe99, 0xe9f, 0xea1, 0xea3, 0xea5, 0xea5, 0xea7, 0xea7, 0xeaa, 0xeab,
  0xead, 0xeb9, 0xebb, 0xebd, 0xec0, 0xec4, 0xec6, 0xec6, 0xec8, 0xecd, 0xed0, 0xed9, 0xedc, 0xedf, 0xf00, 0xf47,
  0xf49, 0xf6c, 0xf71, 0xf97, 0xf99, 0xfbc, 0xfbe, 0xfcc, 0xfce, 0xfda, 0x1000, 0x10c5, 0x10c7, 0x10c7, 0x10cd, 0x10cd,
  0x10d0, 0x1248, 0x124a, 0x124d, 0x1250, 0x1256, 0x1258, 0x1258, 0x125a, 0x125d, 0x1260, 0x1288, 0x128a, 0x128d, 0x1290, 0x12b0,
  0x12b2, 0x12b5, 0x12b8, 0x12be, 0x12c0, 0x12c0, 0x12c2, 0x12c5, 0x12c8, 0x12d6, 0x12d8, 0x1310, 0x1312, 0x1315, 0x1318, 0x135a,
  0x135d, 0x137c, 0x1380, 0x1399, 0x13a0, 0x13f5, 0x13f8, 0x13fd, 0x1400, 0x169c, 0x16a0, 0x16f8, 0x1700, 0x170c, 0x170e, 0x1714,
  0x1720, 0x1736, 0x1740, 0x1753, 0x1760, 0x176c, 0x176e, 0x1770, 0x1772, 0x1773, 0x1780, 0x17dd, 0x17e0, 0x17e9, 0x17f0, 0x17f9,
  0x1800, 0x180e, 0x1810, 0x1819, 0x1820, 0x1877, 0x1880, 0x18aa, 0x18b0, 0x18f5, 0x1900, 0x191e, 0x1920, 0x192b, 0x1930, 0x193b,
  0x1940, 0x1940, 0x1944, 0x196d, 0x1970, 0x1974, 0x1980, 0x19ab, 0x19b0, 0x19c9, 0x19d0, 0x19da, 0x19de, 0x1a1b, 0x1a1e, 0x1a5e,
  0x1a60, 0x1a7c, 0x1a7f, 0x1a89, 0x1a90, 0x1a99, 0x1aa0, 0x1aad, 0x1ab0, 0x1abe, 0x1b00, 0x1b4b, 0x1b50, 0x1b7c, 0x1b80, 0x1bf3,
  0x1bfc, 0x1c37, 0x1c3b, 0x1c49, 0x1c4d, 0x1c88, 0x1cc0, 0x1cc7, 0x1cd0, 0x1cf6, 0x1cf8, 0x1cf9, 0x1d00, 0x1df5, 0x1dfb, 0x1f15,
  0x1f18, 0x1f1d, 0x1f20, 0x1f45, 0x1f48, 0x1f4d, 0x1f50, 0x1f57, 0x1f59, 0x1f59, 0x1f5b, 0x1f5b, 0x1f5d, 0x1f5d, 0x1f5f, 0x1f7d,
  0x1f80, 0x1fb4, 0x1fb6, 0x1fc4, 0x1fc6, 0x1fd3, 0x1fd6, 0x1fdb, 0x1fdd, 0x1fef, 0x1ff2, 0x1ff4, 0x1ff6, 0x1ffe, 0x2000, 0x2027,
  0x202a, 0x2064, 0x2066, 0x2071, 0x2074, 0x208e, 0x2090, 0x209c, 0x20a0, 0x20be, 0x20d0, 0x20f0, 0x2100, 0x218b, 0x2190, 0x23fe,
  0x2400, 0x2426, 0x2440, 0x244a, 0x2460, 0x2b73, 0x2b76, 0x2b95, 0x2b98, 0x2bb9, 0x2bbd, 0x2bc8, 0x2bca, 0x2bd1, 0x2bec, 0x2bef,
  0x2c00, 0x2c2e, 0x2c30, 0x2c5e, 0x2c60, 0x2cf3, 0x2cf9, 0x2d25, 0x2d27, 0x2d27, 0x2d2d, 0x2d2d, 0x2d30, 0x2d67, 0x2d6f, 0x2d70,
  0x2d7f, 0x2d96, 0x2da0, 0x2da6, 0x2da8, 0x2dae, 0x2db0, 0x2db6, 0x2db8, 0x2dbe, 0x2dc0, 0x2dc6, 0x2dc8, 0x2dce, 0x2dd0, 0x2dd6,
  0x2dd8, 0x2dde, 0x2de0, 0x2e44, 0x2e80, 0x2e99, 0x2e9b, 0x2ef3, 0x2f00, 0x2fd5, 0x2ff0, 0x2ffb, 0x3000, 0x303f, 0x3041, 0x3096,
  0x3099, 0x30ff, 0x3105, 0x312d, 0x3131, 0x318e, 0x3190, 0x31ba, 0x31c0, 0x31e3, 0x31f0, 0x321e, 0x3220, 0x32fe, 0x3300, 0x4db5,
  0x4dc0, 0x9fd5, 0xa000, 0xa48c, 0xa490, 0xa4c6, 0xa4d0, 0xa62b, 0xa640, 0xa6f7, 0xa700, 0xa7ae, 0xa7b0, 0xa7b7, 0xa7f7, 0xa82b,
  0xa830, 0xa839, 0xa840, 0xa877, 0xa880, 0xa8c5, 0xa8ce, 0xa8d9, 0xa8e0, 0xa8fd, 0xa900, 0xa953, 0xa95f, 0xa97c, 0xa980, 0xa9cd,
  0xa9cf, 0xa9d9, 0xa9de, 0xa9fe, 0xaa00, 0xaa36, 0xaa40, 0xaa4d, 0xaa50, 0xaa59, 0xaa5c, 0xaac2, 0xaadb, 0xaaf6, 0xab01, 0xab06,
  0xab09, 0xab0e, 0xab11, 0xab16, 0xab20, 0xab26, 0xab28, 0xab2e, 0xab30, 0xab65, 0xab70, 0xabed, 0xabf0, 0xabf9, 0xac00, 0xd7a3,
  0xd7b0, 0xd7c6, 0xd7cb, 0xd7fb, 0xe000, 0xfa6d, 0xfa70, 0xfad9, 0xfb00, 0xfb06, 0xfb13, 0xfb17, 0xfb1d, 0xfb36, 0xfb38, 0xfb3c,
  0xfb3e, 0xfb3e, 0xfb40, 0xfb41, 0xfb43, 0xfb44, 0xfb46, 0xfbc1, 0xfbd3, 0xfd3f, 0xfd50, 0xfd8f, 0xfd92, 0xfdc7, 0xfdf0, 0xfdfd,
  0xfe00, 0xfe19, 0xfe20, 0xfe52, 0xfe54, 0xfe66, 0xfe68, 0xfe6b, 0xfe70, 0xfe74, 0xfe76, 0xfefc, 0xfeff, 0xfeff, 0xff01, 0xffbe,
  0xffc2, 0xffc7, 0xffca, 0xffcf, 0xffd2, 0xffd7, 0xffda, 0xffdc, 0xffe0, 0xffe6, 0xffe8, 0xffee, 0xfff9, 0xfffd, 0x10000, 0x1000b,
  0x1000d, 0x10026, 0x10028, 0x1003a, 0x1003c, 0x1003d, 0x1003f, 0x1004d, 0x10050, 0x1005d, 0x10080, 0x100fa, 0x10100, 0x10102, 0x10107, 0x10133,
  0x10137, 0x1018e, 0x10190, 0x1019b, 0x101a0, 0x101a0, 0x101d0, 0x101fd, 0x10280, 0x1029c, 0x102a0, 0x102d0, 0x102e0, 0x102fb, 0x10300, 0x10323,
  0x10330, 0x1034a, 0x10350, 0x1037a, 0x10380, 0x1039d, 0x1039f, 0x103c3, 0x103c8, 0x103d5, 0x10400, 0x1049d, 0x104a0, 0x104a9, 0x104b0, 0x104d3,
  0x104d8, 0x104fb, 0x10500, 0x10527, 0x10530, 0x10563, 0x1056f, 0x1056f, 0x10600, 0x10736, 0x10740, 0x10755, 0x10760, 0x10767, 0x10800, 0x10805,
  0x10808, 0x10808, 0x1080a, 0x10835, 0x10837, 0x10838, 0x1083c, 0x1083c, 0x1083f, 0x10855, 0x10857, 0x1089e, 0x108a7, 0x108af, 0x108e0, 0x108f2,
  0x108f4, 0x108f5, 0x108fb, 0x1091b, 0x1091f, 0x10939, 0x1093f, 0x1093f, 0x10980, 0x109b7, 0x109bc, 0x109cf, 0x109d2, 0x10a03, 0x10a05, 0x10a06,
  0x10a0c, 0x10a13, 0x10a15, 0x10a17, 0x10a19, 0x10a33, 0x10a38, 0x10a3a, 0x10a3f, 0x10a47, 0x10a50, 0x10a58, 0x10a60, 0x10a9f, 0x10ac0, 0x10ae6,
  0x10aeb, 0x10af6, 0x10b00, 0x10b35, 0x10b39, 0x10b55, 0x10b58, 0x10b72, 0x10b78, 0x10b91, 0x10b99, 0x10b9c, 0x10ba9, 0x10baf, 0x10c00, 0x10c48,
  0x10c80, 0x10cb2, 0x10cc0, 0x10cf2, 0x10cfa, 0x10cff, 0x10e60, 0x10e7e, 0x11000, 0x1104d, 0x11052, 0x1106f, 0x1107f, 0x110c1, 0x110d0, 0x110e8,
  0x110f0, 0x110f9, 0x11100, 0x11134, 0x11136, 0x11143, 0x11150, 0x11176, 0x11180, 0x111cd, 0x111d0, 0x111df, 0x111e1, 0x111f4, 0x11200, 0x11211,
  0x11213, 0x1123e, 0x11280, 0x11286, 0x11288, 0x11288, 0x1128a, 0x1128d, 0x1128f, 0x1129d, 0x1129f, 0x112a9, 0x112b0, 0x112ea, 0x112f0, 0x112f9,
  0x11300, 0x11303, 0x11305, 0x1130c, 0x1130f, 0x11310, 0x11313, 0x11328, 0x1132a, 0x11330, 0x11332, 0x11333, 0x11335, 0x11339, 0x1133c, 0x11344,
  0x11347, 0x11348, 0x1134b, 0x1134d, 0x11350, 0x11350, 0x11357, 0x11357, 0x1135d, 0x11363, 0x11366, 0x1136c, 0x11370, 0x11374, 0x11400, 0x11459,
  0x1145b, 0x1145b, 0x1145d, 0x1145d, 0x11480, 0x114c7, 0x114d0, 0x114d9, 0x11580, 0x115b5, 0x115b8, 0x115dd, 0x11600, 0x11644, 0x11650, 0x11659,
  0x11660, 0x1166c, 0x11680, 0x116b7, 0x116c0, 0x116c9, 0x11700, 0x11719, 0x1171d, 0x1172b, 0x11730, 0x1173f, 0x118a0, 0x118f2, 0x118ff, 0x118ff,
  0x11ac0, 0x11af8, 0x11c00, 0x11c08, 0x11c0a, 0x11c36, 0x11c38, 0x11c45, 0x11c50, 0x11c6c, 0x11c70, 0x11c8f, 0x11c92, 0x11ca7, 0x11ca9, 0x11cb6,
  0x12000, 0x12399, 0x12400, 0x1246e, 0x12470, 0x12474, 0x12480, 0x12543, 0x13000, 0x1342e, 0x14400, 0x14646, 0x16800, 0x16a38, 0x16a40, 0x16a5e,
  0x16a60, 0x16a69, 0x16a6e, 0x16a6f, 0x16ad0, 0x16aed, 0x16af0, 0x16af5, 0x16b00, 0x16b45, 0x16b50, 0x16b59, 0x16b5b, 0x16b61, 0x16b63, 0x16b77,
  0x16b7d, 0x16b8f, 0x16f00, 0x16f44, 0x16f50, 0x16f7e, 0x16f8f, 0x16f9f, 0x16fe0, 0x16fe0, 0x17000, 0x187ec, 0x18800, 0x18af2, 0x1b000, 0x1b001,
  0x1bc00, 0x1bc6a, 0x1bc70, 0x1bc7c, 0x1bc80, 0x1bc88, 0x1bc90, 0x1bc99, 0x1bc9c, 0x1bca3, 0x1d000, 0x1d0f5, 0x1d100, 0x1d126, 0x1d129, 0x1d1e8,
  0x1d200, 0x1d245, 0x1d300, 0x1d356, 0x1d360, 0x1d371, 0x1d400, 0x1d454, 0x1d456, 0x1d49c, 0x1d49e, 0x1d49f, 0x1d4a2, 0x1d4a2, 0x1d4a5, 0x1d4a6,
  0x1d4a9, 0x1d4ac, 0x1d4ae, 0x1d4b9, 0x1d4bb, 0x1d4bb, 0x1d4bd, 0x1d4c3, 0x1d4c5, 0x1d505, 0x1d507, 0x1d50a, 0x1d50d, 0x1d514, 0x1d516, 0x1d51c,
  0x1d51e, 0x1d539, 0x1d53b, 0x1d53e, 0x1d540, 0x1d544, 0x1d546, 0x1d546, 0x1d54a, 0x1d550, 0x1d552, 0x1d6a5, 0x1d6a8, 0x1d7cb, 0x1d7ce, 0x1da8b,
  0x1da9b, 0x1da9f, 0x1daa1, 0x1daaf, 0x1e000, 0x1e006, 0x1e008, 0x1e018, 0x1e01b, 0x1e021, 0x1e023, 0x1e024, 0x1e026, 0x1e02a, 0x1e800, 0x1e8c4,
  0x1e8c7, 0x1e8d6, 0x1e900, 0x1e94a, 0x1e950, 0x1e959, 0x1e95e, 0x1e95f, 0x1ee00, 0x1ee03, 0x1ee05, 0x1ee1f, 0x1ee21, 0x1ee22, 0x1ee24, 0x1ee24,
  0x1ee27, 0x1ee27, 0x1ee29, 0x1ee32, 0x1ee34, 0x1ee37, 0x1ee39, 0x1ee39, 0x1ee3b, 0x1ee3b, 0x1ee42, 0x1ee42, 0x1ee47, 0x1ee47, 0x1ee49, 0x1ee49,
  0x1ee4b, 0x1ee4b, 0x1ee4d, 0x1ee4f, 0x1ee51, 0x1ee52, 0x1ee54, 0x1ee54, 0x1ee57, 0x1ee57, 0x1ee59, 0x1ee59, 0x1ee5b, 0x1ee5b, 0x1ee5d, 0x1ee5d,
  0x1ee5f, 0x1ee5f, 0x1ee61, 0x1ee62, 0x1ee64, 0x1ee64, 0x1ee67, 0x1ee6a, 0x1ee6c, 0x1ee72, 0x1ee74, 0x1ee77, 0x1ee79, 0x1ee7c, 0x1ee7e, 0x1ee7e,
  0x1ee80, 0x1ee89, 0x1ee8b, 0x1ee9b, 0x1eea1, 0x1eea3, 0x1eea5, 0x1eea9, 0x1eeab, 0x1eebb, 0x1eef0, 0x1eef1, 0x1f000, 0x1f02b, 0x1f030, 0x1f093,
  0x1f0a0, 0x1f0ae, 0x1f0b1, 0x1f0bf, 0x1f0c1, 0x1f0cf, 0x1f0d1, 0x1f0f5, 0x1f100, 0x1f10c, 0x1f110, 0x1f12e, 0x1f130, 0x1f16b, 0x1f170, 0x1f1ac,
  0x1f1e6, 0x1f202, 0x1f210, 0x1f23b, 0x1f240, 0x1f248, 0x1f250, 0x1f251, 0x1f300, 0x1f6d2, 0x1f6e0, 0x1f6ec, 0x1f6f0, 0x1f6f6, 0x1f700, 0x1f773,
  0x1f780, 0x1f7d4, 0x1f800, 0x1f80b, 0x1f810, 0x1f847, 0x1f850, 0x1f859, 0x1f860, 0x1f887, 0x1f890, 0x1f8ad, 0x1f910, 0x1f91e, 0x1f920, 0x1f927,
  0x1f930, 0x1f930, 0x1f933, 0x1f93e, 0x1f940, 0x1f94b, 0x1f950, 0x1f95e, 0x1f980, 0x1f991, 0x1f9c0, 0x1f9c0, 0x20000, 0x2a6d6, 0x2a700, 0x2b734,
  0x2b740, 0x2b81d, 0x2b820, 0x2cea1, 0x2f800, 0x2fa1d, 0xe0001, 0xe0001, 0xe0020, 0xe007f, 0xe0100, 0xe01ef, 0xf0000, 0xffffd, 0x100000, 0x10fffd,
];

const helpText = [
  "Usage: numfmt [OPTION]... [NUMBER]...",
  "Reformat NUMBER(s), or the numbers from standard input if none are specified.",
  "",
  "Mandatory arguments to long options are mandatory for short options too.",
  "      --debug          print warnings about invalid input",
  "  -d, --delimiter=X    use X instead of whitespace for field delimiter",
  "      --field=FIELDS   replace the numbers in these input fields (default=1)",
  "                         see FIELDS below",
  "      --format=FORMAT  use printf style floating-point FORMAT;",
  "                         see FORMAT below for details",
  "      --from=UNIT      auto-scale input numbers to UNITs; default is 'none';",
  "                         see UNIT below",
  "      --from-unit=N    specify the input unit size (instead of the default 1)",
  "      --grouping       use locale-defined grouping of digits, e.g. 1,000,000",
  "                         (which means it has no effect in the C/POSIX locale)",
  "      --header[=N]     print (without converting) the first N header lines;",
  "                         N defaults to 1 if not specified",
  "      --invalid=MODE   failure mode for invalid numbers: MODE can be:",
  "                         abort (default), fail, warn, ignore",
  "      --padding=N      pad the output to N characters; positive N will",
  "                         right-align; negative N will left-align;",
  "                         padding is ignored if the output is wider than N;",
  "                         the default is to automatically pad if a whitespace",
  "                         is found",
  "      --round=METHOD   use METHOD for rounding when scaling; METHOD can be:",
  "                         up, down, from-zero (default), towards-zero, nearest",
  "      --suffix=SUFFIX  add SUFFIX to output numbers, and accept optional",
  "                         SUFFIX in input numbers",
  "      --to=UNIT        auto-scale output numbers to UNITs; see UNIT below",
  "      --to-unit=N      the output unit size (instead of the default 1)",
  "  -z, --zero-terminated    line delimiter is NUL, not newline",
  "      --help     display this help and exit",
  "      --version  output version information and exit",
  "",
  "UNIT options:",
  "  none       no auto-scaling is done; suffixes will trigger an error",
  "  auto       accept optional single/two letter suffix:",
  "               1K = 1000,",
  "               1Ki = 1024,",
  "               1M = 1000000,",
  "               1Mi = 1048576,",
  "  si         accept optional single letter suffix:",
  "               1K = 1000,",
  "               1M = 1000000,",
  "               ...",
  "  iec        accept optional single letter suffix:",
  "               1K = 1024,",
  "               1M = 1048576,",
  "               ...",
  "  iec-i      accept optional two-letter suffix:",
  "               1Ki = 1024,",
  "               1Mi = 1048576,",
  "               ...",
  "",
  "FIELDS supports cut(1) style field ranges:",
  "  N    N'th field, counted from 1",
  "  N-   from N'th field, to end of line",
  "  N-M  from N'th to M'th field (inclusive)",
  "  -M   from first to M'th field (inclusive)",
  "  -    all fields",
  "Multiple fields/ranges can be separated with commas",
  "",
  "FORMAT must be suitable for printing one floating-point argument '%f'.",
  "Optional quote (%'f) will enable --grouping (if supported by current locale).",
  "Optional width value (%10f) will pad output. Optional zero (%010f) width",
  "will zero pad the number. Optional negative values (%-10f) will left align.",
  "Optional precision (%.1f) will override the input determined precision.",
  "",
  "Exit status is 0 if all input numbers were successfully converted.",
  "By default, numfmt will stop at the first conversion error with exit status 2.",
  "With --invalid='fail' a warning is printed for each conversion error",
  "and the exit status is 2.  With --invalid='warn' each conversion error is",
  "diagnosed, but the exit status is 0.  With --invalid='ignore' conversion",
  "errors are not diagnosed and the exit status is 0.",
  "",
  "Examples:",
  "  $ numfmt --to=si 1000",
  "            -> \"1.0K\"",
  "  $ numfmt --to=iec 2048",
  "           -> \"2.0K\"",
  "  $ numfmt --to=iec-i 4096",
  "           -> \"4.0Ki\"",
  "  $ echo 1K | numfmt --from=si",
  "           -> \"1000\"",
  "  $ echo 1K | numfmt --from=iec",
  "           -> \"1024\"",
  "  $ df -B1 | numfmt --header --field 2-4 --to=si",
  "  $ ls -l  | numfmt --header --field 5 --to=iec",
  "  $ ls -lh | numfmt --header --field 5 --from=iec --padding=10",
  "  $ ls -lh | numfmt --header --field 5 --from=iec --format %10f",
  "",
  "GNU coreutils online help: <https://www.gnu.org/software/coreutils/>",
  "Report numfmt translation bugs to <https://translationproject.org/team/>",
  "Full documentation at: <https://www.gnu.org/software/coreutils/numfmt>",
  "or available locally via: info '(coreutils) numfmt invocation'",
  "",
].join("\n");

const unsignedMaximum = (1n << 64n) - 1n;
const signedMaximum = (1n << 63n) - 1n;
const scales = ["none", "auto", "si", "iec", "iec-i"] as const;
type Scale = typeof scales[number];
type Rounding = "up" | "down" | "from-zero" | "towards-zero" | "nearest";
type Invalid = "abort" | "fail" | "warn" | "ignore";
interface Binary { coefficient: bigint; exponent: number; negativeZero?: boolean }

function binary(numerator: bigint, denominator = 1n, exponent = 0): Binary {
  if (!numerator) return { coefficient: 0n, exponent: 0 };
  const negative = numerator < 0n !== denominator < 0n;
  numerator = numerator < 0n ? -numerator : numerator;
  denominator = denominator < 0n ? -denominator : denominator;
  let shift = numerator.toString(2).length - denominator.toString(2).length;
  if (shift >= 0 ? numerator < denominator << BigInt(shift) : numerator << BigInt(-shift) < denominator) shift--;
  const target = Math.max(shift + exponent - 63, -16445);
  const adjustment = exponent - target;
  if (adjustment >= 0) numerator <<= BigInt(adjustment);
  else denominator <<= BigInt(-adjustment);
  let rounded = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n > denominator || remainder * 2n === denominator && rounded % 2n !== 0n) rounded++;
  if (target > 16320 || target === 16320 && rounded >= 1n << 64n) return { coefficient: negative ? -1n : 1n, exponent: Infinity };
  return { coefficient: negative ? -rounded : rounded, exponent: target, negativeZero: negative && rounded === 0n };
}

function add(left: Binary, right: Binary): Binary {
  const exponent = Math.min(left.exponent, right.exponent);
  const result = binary((left.coefficient << BigInt(left.exponent - exponent)) + (right.coefficient << BigInt(right.exponent - exponent)), 1n, exponent);
  if (!result.coefficient) result.negativeZero = left.negativeZero === true && right.negativeZero === true;
  return result;
}

function multiply(left: Binary, right: Binary): Binary {
  if (!left.coefficient || !right.coefficient) return { coefficient: 0n, exponent: 0, negativeZero: (left.coefficient < 0n || left.negativeZero === true) !== (right.coefficient < 0n || right.negativeZero === true) };
  return binary(left.coefficient * right.coefficient, 1n, left.exponent + right.exponent);
}

function divide(left: Binary, right: Binary): Binary {
  if (!left.coefficient || right.exponent === Infinity) return { coefficient: 0n, exponent: 0, negativeZero: (left.coefficient < 0n || left.negativeZero === true) !== (right.coefficient < 0n || right.negativeZero === true) };
  return binary(left.coefficient, right.coefficient, left.exponent - right.exponent);
}

function absolute(value: Binary): Binary {
  return { ...value, coefficient: value.coefficient < 0n ? -value.coefficient : value.coefficient, negativeZero: false };
}

function negate(value: Binary): Binary {
  return { ...value, coefficient: -value.coefficient, negativeZero: value.coefficient === 0n && !value.negativeZero };
}

function integer(value: Binary): bigint {
  const magnitude = value.coefficient < 0n ? -value.coefficient : value.coefficient;
  const result = value.exponent >= 0 ? magnitude << BigInt(value.exponent) : magnitude >> BigInt(-value.exponent);
  return value.coefficient < 0n ? -result : result;
}

function compare(left: Binary, right: Binary): number {
  const difference = add(left, { ...right, coefficient: -right.coefficient }).coefficient;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function power(base: number, exponent: number): Binary {
  if (base === 10 && exponent > 4933) return { coefficient: 1n, exponent: Infinity };
  let result = binary(1n);
  const factor = binary(BigInt(base));
  for (let index = 0; index < exponent; index++) {
    result = multiply(result, factor);
    if (result.exponent === Infinity) break;
  }
  return result;
}

function round(value: Binary, method: Rounding): Binary {
  const maximum = binary(signedMaximum);
  const multiple = integer(divide(value, maximum));
  const high = multiply(maximum, binary(multiple));
  const low = add(value, { ...high, coefficient: -high.coefficient });
  let rounded = integer(low);
  if (method === "nearest") rounded = integer(add(low, binary(low.coefficient < 0n ? -1n : 1n, 2n)));
  else if (compare(low, binary(rounded)) !== 0) {
    if (method === "from-zero") rounded += low.coefficient < 0n ? -1n : 1n;
    else if (method === "up" && low.coefficient > 0n) rounded++;
    else if (method === "down" && low.coefficient < 0n) rounded--;
  }
  return add(high, binary(rounded));
}

function decimalRounded(value: Binary, precision: number): bigint {
  let numerator = absolute(value).coefficient;
  let denominator = 1n;
  if (precision >= 0) numerator *= 10n ** BigInt(precision);
  else denominator *= 10n ** BigInt(-precision);
  if (value.exponent >= 0) numerator <<= BigInt(value.exponent);
  else denominator <<= BigInt(-value.exponent);
  let rounded = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n > denominator || remainder * 2n === denominator && rounded % 2n !== 0n) rounded++;
  return rounded;
}

function fixed(value: Binary, precision: number, grouped = false): string {
  const digits = decimalRounded(value, precision).toString().padStart(precision + 1, "0");
  let integral = precision ? digits.slice(0, -precision) : digits;
  if (grouped) {
    const parts: string[] = [];
    while (integral.length > 3) { parts.unshift(integral.slice(-3)); integral = integral.slice(0, -3); }
    parts.unshift(integral);
    integral = parts.join(",");
  }
  return (value.coefficient < 0n || value.negativeZero ? "-" : "") + integral + (precision ? `.${digits.slice(-precision)}` : "");
}

function general(value: Binary, uppercase = false): string {
  if (!value.coefficient) return value.negativeZero ? "-0" : "0";
  const magnitude = absolute(value);
  let numerator = magnitude.coefficient;
  let denominator = 1n;
  if (value.exponent >= 0) numerator <<= BigInt(value.exponent);
  else denominator <<= BigInt(-value.exponent);
  let decimalExponent = numerator.toString().length - denominator.toString().length;
  if (decimalExponent >= 0 ? numerator < denominator * 10n ** BigInt(decimalExponent) : numerator * 10n ** BigInt(-decimalExponent) < denominator) decimalExponent--;
  let significant = decimalRounded(magnitude, 5 - decimalExponent).toString();
  if (significant.length > 6) { decimalExponent++; significant = decimalRounded(magnitude, 5 - decimalExponent).toString(); }
  let text: string;
  if (decimalExponent < -4 || decimalExponent >= 6) {
    text = significant[0] + "." + significant.slice(1);
    while (text.endsWith("0")) text = text.slice(0, -1);
    if (text.endsWith(".")) text = text.slice(0, -1);
    text += `${uppercase ? "E" : "e"}${decimalExponent < 0 ? "-" : "+"}${Math.abs(decimalExponent).toString().padStart(2, "0")}`;
  } else {
    text = fixed(magnitude, Math.max(0, 5 - decimalExponent));
    if (text.includes(".")) { while (text.endsWith("0")) text = text.slice(0, -1); if (text.endsWith(".")) text = text.slice(0, -1); }
  }
  return (value.coefficient < 0n ? "-" : "") + text;
}

function blank(character: string | undefined): boolean { return character === " " || character === "\t"; }
function digit(character: string | undefined): boolean { return character !== undefined && character >= "0" && character <= "9"; }

function byteText(bytes: Uint8Array): string {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 4096) text += String.fromCharCode(...bytes.subarray(offset, offset + 4096));
  return text;
}

function textBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let offset = 0; offset < text.length; offset++) bytes[offset] = text.charCodeAt(offset);
  return bytes;
}

function utf8Size(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0)!;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function quote(text: string, unicode: boolean): string {
  const right = unicode ? "\xe2\x80\x99" : "'";
  let result = unicode ? "\xe2\x80\x98" : "'";
  const escapes: Readonly<Record<string, string>> = { "\x07": "\\a", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\v": "\\v" };
  for (let index = 0; index < text.length;) {
    if (text.startsWith(right, index)) { result += `\\${right}`; index += right.length; continue; }
    const character = text[index]!;
    const code = character.charCodeAt(0);
    if (character === "\\") result += "\\\\";
    else if (code >= 32 && code < 127) result += character;
    else if (unicode && code >= 194 && code <= 244) {
      const width = code < 224 ? 2 : code < 240 ? 3 : 4;
      const candidate = text.slice(index, index + width);
      let decoded: string | undefined;
      try { decoded = utf8Decoder.decode(textBytes(candidate)); } catch { decoded = undefined; }
      const point = decoded?.codePointAt(0) ?? -1;
      let low = 0;
      let high = glibc231PrintableRanges.length / 2;
      let printable = false;
      while (low < high) {
        const middle = Math.trunc((low + high) / 2);
        if (point < glibc231PrintableRanges[middle * 2]!) high = middle;
        else if (point > glibc231PrintableRanges[middle * 2 + 1]!) low = middle + 1;
        else { printable = true; break; }
      }
      if (decoded !== undefined && printable) { result += candidate; index += width; continue; }
      result += `\\${code.toString(8).padStart(3, "0")}`;
    } else result += escapes[character] ?? `\\${code.toString(8).padStart(3, "0")}`;
    index++;
  }
  return result + right;
}

class NumfmtDiagnostic extends Error {
  constructor(message: string, readonly status = 1, readonly help = false, readonly extra = "") { super(message); }
}

interface Settings {
  from: Scale;
  to: Scale;
  fromUnit: bigint;
  toUnit: bigint;
  rounding: Rounding;
  invalid: Invalid;
  padding: bigint;
  left: boolean;
  zeroPadding: bigint;
  precision: bigint | undefined;
  grouping: boolean;
  delimiter: string | undefined;
  separator: string;
  suffix: string;
  header: bigint;
  fields: [bigint, bigint][] | undefined;
  format: string | undefined;
  prefix: string;
  postfix: string;
  debug: boolean;
  developer: boolean;
  unicode: boolean;
  thousands: boolean;
  localeValid: boolean;
  operands: string[];
  information?: string;
}

function decimal(text: string, offset = 0): { value: bigint; end: number; found: boolean; overflow: boolean } {
  const start = offset;
  while (text[offset] === " " || (text.charCodeAt(offset) >= 9 && text.charCodeAt(offset) <= 13)) offset++;
  const negative = text[offset] === "-";
  if (negative || text[offset] === "+") offset++;
  const digits = offset;
  let value = 0n;
  while (digit(text[offset])) { if (value <= unsignedMaximum) value = value * 10n + BigInt(text.charCodeAt(offset) - 48); offset++; }
  return { value: negative ? -value : value, end: offset === digits ? start : offset, found: offset !== digits, overflow: value > unsignedMaximum };
}

function fields(text: string, unicode: boolean): [bigint, bigint][] {
  const result: [bigint, bigint][] = [];
  let initial = 1n;
  let value = 0n;
  let dash = false;
  let left = false;
  let right = false;
  let digitsStart = 0;
  for (let offset = 0; ; offset++) {
    const character = text[offset];
    if (character === "-") {
      if (dash) throw new NumfmtDiagnostic("invalid field range", 1, true);
      if (left && value === 0n) throw new NumfmtDiagnostic("fields are numbered from 1", 1, true);
      dash = true;
      initial = left ? value : 1n;
      value = 0n;
    } else if (character === undefined || character === "," || blank(character)) {
      if (dash) {
        if (right && value < initial) throw new NumfmtDiagnostic("invalid decreasing range", 1, true);
        result.push([initial, right ? value : unsignedMaximum]);
      } else {
        if (!value) throw new NumfmtDiagnostic("fields are numbered from 1", 1, true);
        result.push([value, value]);
      }
      if (result.length > 4096) throw new PublicDiagnostic("field range limit exceeded");
      if (character === undefined) break;
      value = 0n; dash = false; left = false; right = false;
    } else if (digit(character)) {
      if (!digit(text[offset - 1])) digitsStart = offset;
      if (dash) right = true; else left = true;
      value = value * 10n + BigInt(character.charCodeAt(0) - 48);
      if (value >= unsignedMaximum) {
        let end = offset + 1;
        while (digit(text[end])) end++;
        throw new NumfmtDiagnostic(`field number ${quote(text.slice(digitsStart, end), unicode)} is too large`, 1, true);
      }
    } else throw new NumfmtDiagnostic(`invalid field value ${quote(text.slice(offset), unicode)}`, 1, true);
  }
  result.sort(([left], [right]) => Number(BigInt.asIntN(32, left)) - Number(BigInt.asIntN(32, right)));
  const merged: [bigint, bigint][] = [];
  for (const range of result) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) { if (range[1] > previous[1]) previous[1] = range[1]; }
    else merged.push(range);
  }
  return merged;
}

function unit(text: string, unicode: boolean): bigint {
  const parsed = decimal(text);
  let value = parsed.value;
  let tail = text.slice(parsed.end);
  if (!parsed.found && "KMGTPEZY".includes(text[0] ?? "\0")) { value = 1n; tail = text; }
  let valid = parsed.found || value === 1n;
  if (tail) {
    const power = "KMGTPEZY".indexOf(tail[0]!) + 1;
    valid &&= power > 0 && (tail.length === 1 || tail.length === 2 && tail[1] === "i");
    if (valid) value *= BigInt(tail.length === 2 ? 1024 : 1000) ** BigInt(power);
  }
  if (!valid || parsed.overflow || value <= 0n || value > unsignedMaximum) throw new NumfmtDiagnostic(`invalid unit size: ${quote(text, unicode)}`);
  return value;
}

function parse(context: CommandContext): Settings {
  const locale = context.env.LC_ALL || context.env.LC_MESSAGES || context.env.LANG || "C";
  const numericLocale = context.env.LC_ALL || context.env.LC_NUMERIC || context.env.LANG || "C";
  const settings: Settings = { from: "none", to: "none", fromUnit: 1n, toUnit: 1n, rounding: "from-zero", invalid: "abort", padding: 0n, left: false, zeroPadding: 0n, precision: undefined, grouping: false, delimiter: undefined, separator: "\n", suffix: "", header: 0n, fields: undefined, format: undefined, prefix: "", postfix: "", debug: false, developer: false, unicode: locale.toLowerCase().includes("utf"), thousands: numericLocale.toLowerCase().startsWith("en_us."), localeValid: ["c", "posix", "c.utf-8", "c.utf8", "en_us.utf8", "en_us.utf-8"].includes(locale.toLowerCase()), operands: [] };
  if (context.args.length > 4096) throw new PublicDiagnostic("argument limit exceeded");
  let bytes = 0;
  for (const argument of context.args) {
    if (argument.length > 65536 - bytes) throw new PublicDiagnostic("argument limit exceeded");
    bytes += context.argumentValues === undefined ? utf8Size(argument) : argument.length;
    if (bytes > 65536) throw new PublicDiagnostic("argument limit exceeded");
  }
  const argumentsCarrier = getCommandArguments(context);
  bytes = 0;
  for (const value of argumentsCarrier.values) { bytes += typeof value === "string" ? utf8Size(value) : shellValueByteLength(value); if (bytes > 65536) throw new PublicDiagnostic("argument limit exceeded"); }
  const args = argumentsCarrier.values.map((value, index) => byteText(typeof value === "string" ? encoder.encode(value) : argumentsCarrier.bytes(index)!));
  const options: Readonly<Record<string, number>> = { from: 1, "from-unit": 1, to: 1, "to-unit": 1, round: 1, padding: 1, suffix: 1, grouping: 0, delimiter: 1, field: 1, debug: 0, "-debug": 0, header: 2, format: 1, invalid: 1, "zero-terminated": 0, help: 0, version: 0 };
  const match = (name: string, value: string, choices: readonly string[]): string => {
    const matches = choices.filter(choice => choice.startsWith(value));
    if (choices.includes(value)) return value;
    if (matches.length === 1) return matches[0]!;
    throw new NumfmtDiagnostic(`${matches.length ? "ambiguous" : "invalid"} argument ${quote(value, settings.unicode)} for ${quote(`--${name}`, settings.unicode)}`, 1, true, `Valid arguments are:\n${choices.map(choice => `  - ${quote(choice, settings.unicode)}\n`).join("")}`);
  };
  const apply = (name: string, value?: string): void => {
    if (name === "from") settings.from = match(name, value!, scales) as Scale;
    else if (name === "to") settings.to = match(name, value!, scales.filter(scale => scale !== "auto")) as Scale;
    else if (name === "round") settings.rounding = match(name, value!, ["up", "down", "from-zero", "towards-zero", "nearest"]) as Rounding;
    else if (name === "invalid") settings.invalid = match(name, value!, ["abort", "fail", "warn", "ignore"]) as Invalid;
    else if (name === "from-unit") settings.fromUnit = unit(value!, settings.unicode);
    else if (name === "to-unit") settings.toUnit = unit(value!, settings.unicode);
    else if (name === "padding" || name === "header") {
      const parsed = decimal(value ?? "1");
      if (!parsed.found || parsed.end !== (value ?? "1").length || parsed.overflow || parsed.value === 0n || (name === "header" ? parsed.value < 0n : parsed.value > signedMaximum || parsed.value < -signedMaximum - 1n)) throw new NumfmtDiagnostic(`invalid ${name} value ${quote(value!, settings.unicode)}`);
      if (name === "header") settings.header = parsed.value;
      else { if (parsed.value < 0n) settings.left = true; settings.padding = parsed.value < 0n ? -parsed.value : parsed.value; }
    } else if (name === "delimiter") {
      if (value!.length > 1) throw new NumfmtDiagnostic("the delimiter must be a single character");
      settings.delimiter = value || "\0";
    } else if (name === "field") {
      if (settings.fields) throw new NumfmtDiagnostic("multiple field specifications");
      settings.fields = fields(value!, settings.unicode);
    } else if (name === "suffix") settings.suffix = value!;
    else if (name === "format") settings.format = value!;
    else if (name === "grouping") settings.grouping = true;
    else if (name === "debug" || name === "-debug") { settings.debug = true; if (name === "-debug") settings.developer = true; }
    else if (name === "zero-terminated") settings.separator = "\0";
    else settings.information = name;
  };
  let stopped = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (stopped || argument === "-" || !argument.startsWith("-")) { settings.operands.push(argument); if (context.env.POSIXLY_CORRECT !== undefined) stopped = true; }
    else if (argument === "--") stopped = true;
    else if (argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const name = argument.slice(2, equals < 0 ? undefined : equals);
      const matches = Object.keys(options).filter(option => option.startsWith(name));
      const selected = Object.hasOwn(options, name) ? name : matches.length === 1 ? matches[0] : undefined;
      if (!selected) throw new NumfmtDiagnostic(matches.length > 1 ? `option '${argument}' is ambiguous; possibilities: ${matches.map(option => `'--${option}'`).join(" ")}` : `unrecognized option '${argument}'`, 1, true);
      if (!options[selected] && equals >= 0) throw new NumfmtDiagnostic(`option '--${selected}' doesn't allow an argument`, 1, true);
      const value = equals >= 0 ? argument.slice(equals + 1) : options[selected] === 1 ? args[++index] : undefined;
      if (options[selected] === 1 && value === undefined) throw new NumfmtDiagnostic(`option '--${selected}' requires an argument`, 1, true);
      apply(selected, value);
    } else for (let offset = 1; offset < argument.length; offset++) {
      const option = argument[offset]!;
      if (option === "z") apply("zero-terminated");
      else if (option === "d") {
        const value = offset + 1 < argument.length ? argument.slice(offset + 1) : args[++index];
        if (value === undefined) throw new NumfmtDiagnostic("option requires an argument -- 'd'", 1, true);
        apply("delimiter", value);
        break;
      } else throw new NumfmtDiagnostic(`invalid option -- '${option}'`, 1, true);
    }
    if (settings.information) break;
  }
  return settings;
}

class Converter {
  invalid = false;
  private autoPadding = false;
  private work = 0;
  constructor(readonly settings: Settings, private context: CommandContext, private output: { readonly remaining: number; emit(text: string, error?: boolean): Promise<void> }) {}

  async tick(amount = 1): Promise<void> {
    this.work += amount;
    if (this.work > 16 * 1024 * 1024) throw new PublicDiagnostic("numfmt work limit exceeded");
    if (this.work % 256 < amount) await yieldTurn(this.context.signal);
    this.context.signal.throwIfAborted();
  }

  async warning(message: string): Promise<void> { await this.output.emit(`numfmt: ${message}\n`, true); }

  async failure(message: string): Promise<false> {
    this.invalid = true;
    if (this.settings.invalid === "abort") throw new NumfmtDiagnostic(message, 2);
    if (this.settings.invalid !== "ignore") await this.warning(message);
    return false;
  }

  async initialize(): Promise<void> {
    const settings = this.settings;
    if (settings.format !== undefined && settings.grouping) throw new NumfmtDiagnostic("--grouping cannot be combined with --format");
    if (settings.debug && !settings.localeValid) await this.warning("failed to set locale");
    if (settings.debug && settings.from === "none" && settings.to === "none" && !settings.grouping && !settings.padding && settings.format === undefined) await this.warning("no conversion option specified");
    if (settings.format !== undefined) await this.parseFormat(settings.format);
    if (settings.grouping) {
      if (settings.to !== "none") throw new NumfmtDiagnostic("grouping cannot be combined with --to");
      if (settings.debug && !settings.thousands) await this.warning("grouping has no effect in this locale");
    }
    this.autoPadding = !settings.padding && settings.delimiter === undefined;
    if (settings.debug && settings.header && settings.operands.length) await this.warning("--header ignored with command-line input");
  }

  private async parseFormat(text: string): Promise<void> {
    const settings = this.settings;
    const quoted = quote(text, settings.unicode);
    let offset = 0;
    let prefix = 0;
    while (!(text[offset] === "%" && text[offset + 1] !== "%")) {
      if (text[offset] === undefined) throw new NumfmtDiagnostic(`format ${quoted} has no % directive`);
      offset += text[offset] === "%" ? 2 : 1;
      prefix++;
    }
    offset++;
    let zero = false;
    while (true) {
      if (text[offset] === " ") offset++;
      else if (text[offset] === "'") { settings.grouping = true; offset++; }
      else if (text[offset] === "0") { zero = true; offset++; }
      else break;
    }
    const width = decimal(text, offset);
    if (width.overflow || width.value > signedMaximum || width.value < -signedMaximum - 1n) throw new NumfmtDiagnostic(`invalid format ${quoted} (width overflow)`);
    if (width.found && width.value !== 0n) {
      if (settings.debug && settings.padding && !(zero && width.value > 0n)) await this.warning("--format padding overriding --padding");
      if (width.value < 0n) { settings.padding = -width.value; settings.left = true; }
      else if (zero) settings.zeroPadding = width.value;
      else settings.padding = width.value;
    }
    offset = width.end;
    if (text[offset] === undefined) throw new NumfmtDiagnostic(`format ${quoted} ends in %`);
    if (text[offset] === ".") {
      offset++;
      const precision = decimal(text, offset);
      if (precision.overflow || precision.value > signedMaximum || precision.value < 0n || blank(text[offset]) || text[offset] === "+") throw new NumfmtDiagnostic(`invalid precision in format ${quoted}`);
      settings.precision = precision.value;
      offset = precision.end;
    }
    if (text[offset] !== "f") throw new NumfmtDiagnostic(`invalid format ${quoted}, directive must be %[0]['][-][N][.][N]f`);
    const suffix = ++offset;
    while (offset < text.length) {
      if (text[offset] === "%" && text[offset + 1] !== "%") throw new NumfmtDiagnostic(`format ${quoted} has too many % directives`);
      offset += text[offset] === "%" ? 2 : 1;
    }
    settings.prefix = text.slice(0, prefix);
    settings.postfix = text.slice(suffix);
    if (settings.developer) await this.output.emit(`format String:\n  input: ${quoted}\n  grouping: ${settings.grouping ? "yes" : "no"}\n  padding width: ${settings.padding}\n  alignment: ${settings.left ? "Left" : "Right"}\n  prefix: ${quote(settings.prefix, settings.unicode)}\n  suffix: ${quote(settings.postfix, settings.unicode)}\n`, true);
  }

  private async number(text: string, backing: Uint8Array, start: number): Promise<{ value: Binary; precision: number } | false> {
    const settings = this.settings;
    const quoted = quote(text, settings.unicode);
    if (settings.developer) await this.output.emit(`simple_strtod_human:\n  input string: ${quoted}\n  locale decimal-point: ${quote(".", settings.unicode)}\n  MAX_UNSCALED_DIGITS: 18\n`, true);
    let offset = 0;
    let loss = false;
    let error = "";
    const integral = async (): Promise<{ value: Binary; negative: boolean }> => {
      const negative = text[offset] === "-";
      if (negative) offset++;
      const start = offset;
      let value = binary(0n);
      let digits = 0;
      while (digit(text[offset])) {
        if (value.coefficient || text[offset] !== "0") digits++;
        if (digits > 18) loss = true;
        if (digits > 27) { error = "overflow"; break; }
        value = add(multiply(value, binary(10n)), binary(BigInt(text.charCodeAt(offset) - 48)));
        offset++;
        await this.tick();
      }
      if (offset === start && text[offset] !== ".") error = "number";
      return { value: negative ? negate(value) : value, negative };
    };
    const main = await integral();
    let value = main.value;
    let precision = 0;
    if (!error && text[offset] === ".") {
      const start = ++offset;
      const fraction = await integral();
      precision = offset - start;
      if (fraction.negative) error = "number";
      if (!error) {
        const part = divide(fraction.value, power(10, precision));
        value = add(value, main.negative ? negate(part) : part);
      }
    }
    if (error) return this.failure(error === "overflow" ? `value too large to be converted: ${quoted}` : `invalid number: ${quoted}`);
    if (settings.developer) await this.output.emit(`  parsed numeric value: ${fixed(value, 6)}\n  input precision = ${precision}\n`, true);
    let exponent = 0;
    let base = settings.from === "iec" || settings.from === "iec-i" ? 1024 : 1000;
    if (offset < text.length) {
      while (blank(text[offset])) offset++;
      const suffix = text[offset];
      if (suffix !== undefined && !"KMGTPEZY".includes(suffix)) return this.failure(`invalid suffix in input: ${quoted}`);
      if (settings.from === "none") return this.failure(`rejecting suffix in input: ${quoted} (consider using --from)`);
      exponent = suffix === undefined ? 0 : "KMGTPEZY".indexOf(suffix) + 1;
      offset++;
      if (settings.from === "auto" && backing[start + offset] === 105) {
        base = 1024; offset++;
        if (settings.developer) await this.output.emit("  Auto-scaling, found 'i', switching to base 1024\n", true);
      }
      precision = 0;
    }
    if (settings.from === "iec-i") {
      if (backing[start + offset] !== 105) return this.failure(`missing 'i' suffix in input: ${quoted} (e.g Ki/Mi/Gi)`);
      offset++;
    }
    const multiplier = power(base, exponent);
    value = multiply(value, multiplier);
    if (settings.developer) await this.output.emit(`  suffix power=${base}^${exponent} = ${fixed(multiplier, 6)}\n  returning value: ${fixed(value, 6)} (${general(value, true)})\n`, true);
    let tail = text.slice(offset);
    if (offset > text.length && backing[start + offset]) {
      if (settings.invalid === "ignore") return this.failure("");
      const tailStart = start + offset;
      let tailEnd = tailStart;
      while (tailEnd < backing.length && backing[tailEnd]) {
        tailEnd++;
        if ((tailEnd - tailStart) % 4096 === 0) await this.tick(4096);
      }
      await this.tick((tailEnd - tailStart) % 4096);
      tail = byteText(backing.subarray(tailStart, tailEnd));
    }
    if (tail) return this.failure(`invalid suffix in input ${quoted}: ${quote(tail, settings.unicode)}`);
    if (loss && settings.debug) await this.warning(`large input value ${quoted}: possible precision loss`);
    if (settings.fromUnit !== 1n || settings.toUnit !== 1n) value = divide(multiply(value, binary(settings.fromUnit)), binary(settings.toUnit));
    return { value, precision };
  }

  private async human(value: Binary, inputPrecision: number): Promise<string | false> {
    const settings = this.settings;
    const precision = settings.precision ?? BigInt(inputPrecision);
    let decimalPower = 0;
    let reduced = absolute(value);
    while (compare(reduced, binary(10n)) >= 0) { reduced = divide(reduced, binary(10n)); decimalPower++; }
    if (settings.to === "none" && BigInt(decimalPower) + precision > 18n) return this.failure(precision ? `value/precision too large to be printed: '${general(value)}/${precision}' (consider using --to)` : `value too large to be printed: '${general(value)}' (consider using --to)`);
    if (decimalPower > 26) return this.failure(`value too large to be printed: '${general(value)}' (cannot handle values > 999Y)`);
    if (settings.developer) await this.output.emit("double_to_human:\n", true);
    let rendered: string;
    let powerIndex = 0;
    let printedValue = value;
    if (settings.to === "none") {
      const factor = power(10, Number(precision));
      printedValue = divide(round(multiply(value, factor), settings.rounding), factor);
      rendered = fixed(printedValue, Number(precision), settings.grouping && settings.thousands);
      if (settings.developer) await this.output.emit(`  no scaling, returning ${settings.grouping ? "(grouped) " : ""}value: ${rendered}\n`, true);
    } else {
      const base = settings.to === "si" ? 1000 : 1024;
      while (compare(absolute(printedValue), binary(BigInt(base))) >= 0) { printedValue = divide(printedValue, binary(BigInt(base))); powerIndex++; }
      if (settings.developer) await this.output.emit(`  scaled value to ${fixed(printedValue, 6)} * ${base} ^ ${powerIndex}\n`, true);
      const adjustment = settings.precision === undefined ? compare(absolute(printedValue), binary(10n)) < 0 ? 1 : 0 : Number(settings.precision < BigInt(powerIndex * 3) ? settings.precision : BigInt(powerIndex * 3));
      const factor = power(10, adjustment);
      printedValue = divide(round(multiply(printedValue, factor), settings.rounding), factor);
      if (compare(absolute(printedValue), binary(BigInt(base))) >= 0) { printedValue = divide(printedValue, binary(BigInt(base))); powerIndex++; }
      if (settings.developer) await this.output.emit(`  after rounding, value=${fixed(printedValue, 6)} * ${base} ^ ${powerIndex}\n`, true);
      let outputPrecision = settings.precision === undefined ? (printedValue.coefficient !== 0n && compare(absolute(printedValue), binary(10n)) < 0 && powerIndex > 0 ? 1n : 0n) : BigInt.asIntN(32, settings.precision);
      if (outputPrecision < 0n) outputPrecision = 6n;
      if (outputPrecision > 126n) throw new NumfmtDiagnostic(`failed to prepare value '${fixed(printedValue, 6)}' for printing`);
      rendered = fixed(printedValue, Number(outputPrecision));
    }
    if (settings.zeroPadding > 0n) {
      if (settings.zeroPadding > 127n) throw new NumfmtDiagnostic(`failed to prepare value '${fixed(printedValue, 6)}' for printing`);
      const negative = rendered.startsWith("-");
      rendered = (negative ? "-" : "") + (negative ? rendered.slice(1) : rendered).padStart(Number(settings.zeroPadding) - Number(negative), "0");
    }
    if (settings.to !== "none") rendered += powerIndex ? "KMGTPEZY"[powerIndex - 1] ?? "(error)" : "";
    if (rendered.length >= (settings.to === "none" ? 128 : 127)) throw new NumfmtDiagnostic(`failed to prepare value '${fixed(printedValue, 6)}' for printing`);
    if (settings.to === "iec-i" && powerIndex) rendered += "i";
    if (settings.developer && settings.to !== "none") await this.output.emit(`  returning value: ${quote(rendered, settings.unicode)}\n`, true);
    rendered += settings.suffix.slice(0, 127 - rendered.length);
    if (settings.developer) await this.output.emit(`formatting output:\n  value: ${fixed(value, 6)}\n  humanized: ${quote(rendered, settings.unicode)}\n`, true);
    if (settings.padding > BigInt(rendered.length)) {
      if (settings.padding > BigInt(this.output.remaining - settings.prefix.length - settings.postfix.length)) throw new PublicDiagnostic("numfmt output limit exceeded");
      rendered = settings.left ? rendered.padEnd(Number(settings.padding)) : rendered.padStart(Number(settings.padding));
      if (settings.developer) await this.output.emit(`  After padding: ${quote(rendered, settings.unicode)}\n`, true);
    }
    return rendered;
  }

  async line(line: string, newline: boolean, backing = textBytes(line + "\0")): Promise<void> {
    const settings = this.settings;
    const nul = line.indexOf("\0");
    if (nul >= 0) line = line.slice(0, nul);
    let start = 0;
    let field = 0n;
    while (true) {
      field++;
      let end = start;
      if (settings.delimiter !== undefined) { while (end < line.length && line[end] !== settings.delimiter) end++; }
      else {
        while (blank(line[end]) || line[end] === "\n") end++;
        while (end < line.length && !blank(line[end]) && line[end] !== "\n") end++;
      }
      backing[end] = 0;
      let text = line.slice(start, end);
      await this.tick((settings.fields?.length ?? 0) + 1);
      if (settings.fields ? settings.fields.some(([low, high]) => low <= field && field <= high) : field === 1n) {
        if (settings.suffix && text.length > settings.suffix.length) {
          if (text.endsWith(settings.suffix)) { text = text.slice(0, -settings.suffix.length); backing[start + text.length] = 0; if (settings.developer) await this.output.emit(`trimming suffix ${quote(settings.suffix, settings.unicode)}\n`, true); }
          else if (settings.developer) await this.output.emit("no valid suffix found\n", true);
        }
        let skipped = 0;
        while (blank(text[skipped])) skipped++;
        if (this.autoPadding) {
          settings.padding = skipped > 0 || field > 1n ? BigInt(text.length) : 0n;
          if (settings.developer) await this.output.emit(`setting Auto-Padding to ${settings.padding} characters\n`, true);
        }
        const parsed = await this.number(text.slice(skipped), backing, start + skipped);
        const converted = parsed && await this.human(parsed.value, parsed.precision);
        await this.output.emit(converted === false ? text : settings.prefix + converted + settings.postfix);
      } else await this.output.emit(text);
      if (end >= line.length) break;
      await this.output.emit(settings.delimiter ?? " ");
      start = end + 1;
    }
    if (newline) await this.output.emit(settings.separator);
  }
}

export function numfmtCommand(): CommandDefinition {
  return { name: "numfmt", filesystemRequirements: [{ id: "stdin", description: "Format operands or standard input", capabilities: [] }], async execute(context) {
    context.signal.throwIfAborted();
    const controller = new AbortController();
    const local = { ...context, signal: AbortSignal.any([context.signal, controller.signal]) };
    let iterator: AsyncIterator<Uint8Array> | undefined;
    let reader: AsyncIterator<Uint8Array> | undefined;
    let finished = false;
    let retirement: Promise<void> | undefined;
    let closing: Promise<void> | undefined;
    let stdout: OutputOperation | undefined;
    let stderr: OutputOperation | undefined;
    let outputBytes = 0;
    let errorBytes = 0;
    const outputLimit = new PublicDiagnostic("numfmt output limit exceeded");
    const output = {
      get remaining() { return bufferLimit - outputBytes; },
      async emit(text: string, error = false): Promise<void> {
        const total = error ? errorBytes : outputBytes;
        if (text.length > bufferLimit - total) throw outputLimit;
        if (error) errorBytes += text.length; else outputBytes += text.length;
        const destination = error ? stderr?.output ?? context.stderr : stdout?.output ?? context.stdout;
        for (let offset = 0; offset < text.length; offset += 65536) await writeBytes(destination, textBytes(text.slice(offset, offset + 65536)), local.signal);
      },
    };
    const retire = (): Promise<void> => retirement ??= Promise.resolve().then(async () => { if (!finished) await iterator?.return?.(); });
    const close = (): Promise<void> => {
      closing ??= Promise.resolve().then(async () => {
        controller.abort(new FsError("EPIPE", { message: "numfmt input closed" }));
        const results = await Promise.allSettled([retire(), reader?.return?.(), stdout?.close(), stderr?.close()]);
        for (const result of results) if (result.status === "rejected") throw result.reason;
      });
      return closing;
    };
    context.registerCleanup?.(close);
    let outcome: { exitCode: number } | { error: unknown };
    try {
      stdout = createOutputOperation(local, context.stdout);
      stderr = createOutputOperation(local, context.stderr);
      const settings = parse(context);
      const converter = new Converter(settings, local, output);
      if (settings.information) {
        await output.emit(settings.information === "version" ? "numfmt (virtual-bash)\n" : helpText);
        outcome = { exitCode: 0 };
      } else {
        await converter.initialize();
        if (settings.operands.length) {
          for (const operand of settings.operands) await converter.line(operand, true);
        } else {
          local.signal.throwIfAborted();
          iterator = context.stdin[Symbol.asyncIterator]();
          reader = readBytes({ [Symbol.asyncIterator]: () => ({ next: async () => { const result = await iterator!.next(); if (result.done) finished = true; return result; }, return: async () => { await retire(); return { done: true, value: undefined }; } }) }, local.signal)[Symbol.asyncIterator]();
          const record = new RecordBuffer(1024 * 1024);
          let received = 0;
          let empty = 0;
          let readFailure: string | undefined;
          let backing: Uint8Array = new Uint8Array(0);
          const process = async (bytes: Uint8Array, terminated: boolean): Promise<void> => {
            const initialized = bytes.length + (terminated ? 2 : 1);
            if (backing.length < initialized) backing = new Uint8Array(initialized);
            backing.set(bytes);
            backing[bytes.length] = terminated ? settings.separator.charCodeAt(0) : 0;
            if (terminated) backing[bytes.length + 1] = 0;
            const line = byteText(bytes);
            if (settings.header) {
              settings.header--;
              const header = line + (terminated ? settings.separator : "");
              const nul = header.indexOf("\0");
              await output.emit(nul < 0 ? header : header.slice(0, nul));
            } else {
              backing[bytes.length] = 0;
              await converter.line(line, terminated, backing);
            }
          };
          while (true) {
            await converter.tick();
            let item: IteratorResult<Uint8Array>;
            try { item = await reader.next(); }
            catch (error) {
              local.signal.throwIfAborted();
              const messages: Readonly<Record<string, string>> = { EISDIR: "Is a directory", EIO: "Input/output error", EBADF: "Bad file descriptor", EACCES: "Permission denied", EFBIG: "File too large" };
              if (!(error instanceof FsError) || !messages[error.code]) throw error;
              readFailure = messages[error.code];
              break;
            }
            if (item.done) break;
            if (item.value.length > bufferLimit - received) throw new PublicDiagnostic("byte command input limit exceeded");
            received += item.value.length;
            if (!item.value.length && ++empty > 4096) throw new PublicDiagnostic("empty input chunk limit exceeded");
            const chunk = new Uint8Array(item.value);
            let start = 0;
            for (let offset = 0; offset < chunk.length; offset++) {
              if (offset % 4096 === 0) await converter.tick();
              if (chunk[offset] === settings.separator.charCodeAt(0)) {
                if (offset - start > record.capacity - record.size) throw new PublicDiagnostic("line buffer limit exceeded");
                await process(record.finish(undefined, chunk, start, offset), true);
                start = offset + 1;
              }
            }
            if (chunk.length - start > record.capacity - record.size) throw new PublicDiagnostic("line buffer limit exceeded");
            record.append(chunk, start);
          }
          if (record.size) await process(record.finish(), false);
          if (readFailure) await converter.warning(`error reading input: ${readFailure}`);
        }
        if (settings.debug && converter.invalid) await converter.warning("failed to convert some of the input numbers");
        outcome = { exitCode: converter.invalid && settings.invalid === "fail" ? 2 : 0 };
      }
    } catch (error) {
      try {
        context.signal.throwIfAborted();
        if (error instanceof NumfmtDiagnostic) {
          const text = `numfmt: ${error.message}\n${error.extra}${error.help ? "Try 'numfmt --help' for more information.\n" : ""}`;
          await output.emit(text, true);
          outcome = { exitCode: error.status };
        } else if (error instanceof PublicDiagnostic) {
          await output.emit(byteText(encoder.encode(`${context.command}: ${publicDiagnosticMessage(error, context.onInternalError)}\n`)), true);
          outcome = { exitCode: 1 };
        }
        else outcome = { error };
      } catch (failure) { outcome = failure === outputLimit ? { exitCode: 1 } : { error: failure }; }
    }
    try { await close(); } catch (error) { if (!("error" in outcome)) outcome = { error }; }
    context.signal.throwIfAborted();
    if ("error" in outcome) throw outcome.error;
    return outcome;
  } };
}
