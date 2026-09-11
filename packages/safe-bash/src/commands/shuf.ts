import { FsError, getCommandArguments, writeBytes, type ByteSource, type CommandContext, type CommandDefinition, type FileReadHandle, type FileStat } from "../contracts/index.js";
import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { createOutputOperation, type OutputOperation } from "../contracts/output.js";
import { shellValueByteLength } from "../contracts/value.js";
import { yieldTurn } from "../contracts/yield.js";
import { PublicDiagnostic } from "../diagnostics.js";
import { ByteInputBudget } from "./bytes/input-budget.js";
import { bufferLimit, diagnostic, pathOf } from "./internal.js";
import { textOutputRequirements } from "./portable-requirements.js";
import { RecordBuffer } from "./record-buffer.js";

const maximumLines = 1024 * 1024;
const reservoirThreshold = 8 * 1024 * 1024;
const unsignedMaximum = (1n << 64n) - 1n;

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

class ShufDiagnostic extends Error {
  constructor(readonly detail: string, readonly usage = false) { super(detail); }
}

function unicodeLocale(context: CommandContext): boolean {
  const locale = (context.env.LC_ALL || context.env.LC_CTYPE || context.env.LANG || "C").toLowerCase();
  return locale.endsWith("utf-8") || locale.endsWith("utf8");
}

function quote(text: string, filename = false, unicode = false): string {
  const controls: Readonly<Record<string, string>> = { "\u0007": "\\a", "\b": "\\b", "\t": "\\t", "\n": "\\n", "\v": "\\v", "\f": "\\f", "\r": "\\r" };
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const units: { text: string; printable: boolean; shellSpecial: boolean; cAndShellCompatible: boolean }[] = [];
  for (let offset = 0; offset < text.length;) {
    const first = text.charCodeAt(offset);
    let length = 1;
    let point = first;
    let valid = first < 128;
    if (unicode && first >= 0xc2 && first <= 0xf4) {
      const size = first < 0xe0 ? 2 : first < 0xf0 ? 3 : 4;
      try {
        point = decoder.decode(Uint8Array.from(text.slice(offset, offset + size), character => character.charCodeAt(0))).codePointAt(0)!;
        length = size;
        valid = true;
      } catch { valid = false; }
    }
    let printable = valid && point >= 32 && point < 127;
    if (valid && point >= 128) {
      let low = 0, high = glibc231PrintableRanges.length / 2;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (point < glibc231PrintableRanges[middle * 2]!) high = middle;
        else if (point > glibc231PrintableRanges[middle * 2 + 1]!) low = middle + 1;
        else { printable = true; break; }
      }
    }
    const unit = text.slice(offset, offset + length);
    const shellSpecial = '!"$&()*;<=>?[\\^`|'.includes(unit);
    const positional = "#~".includes(unit) ? offset === 0 : "{}".includes(unit) && text.length === 1;
    units.push({ text: unit, printable, shellSpecial: shellSpecial || positional,
      cAndShellCompatible: printable && !shellSpecial && (!"#~{}".includes(unit) || positional) });
    offset += length;
  }
  if (filename && text && units.every(unit => unit.printable && !unit.shellSpecial && !" ':".includes(unit.text))) return text;
  if (filename && text.includes("'") && units.every(unit => unit.cAndShellCompatible)) return `"${text}"`;
  const left = !filename && unicode ? "\xe2\x80\x98" : "'";
  const right = !filename && unicode ? "\xe2\x80\x99" : "'";
  let result = left;
  let escaping = filename && text.includes("'") && units.length > 0 && !units[units.length - 1]!.printable;
  for (const unit of units) {
    if (filename && unit.text === "'") { result += "'\\''"; escaping = false; }
    else if (!unit.printable) {
      if (filename && !escaping) result += "'$'";
      escaping = true;
      result += controls[unit.text] ?? Array.from(unit.text, character => `\\${character.charCodeAt(0).toString(8).padStart(3, "0")}`).join("");
    } else {
      if (filename && escaping) result += "''";
      escaping = false;
      if (!filename && (unit.text === right || unit.text === "\\")) result += "\\";
      result += unit.text;
    }
  }
  return result + right;
}

function decimal(text: string, count: boolean, unicode: boolean): bigint {
  let offset = 0;
  while (text.charCodeAt(offset) === 32 || text.charCodeAt(offset) >= 9 && text.charCodeAt(offset) <= 13) offset++;
  if (text[offset] === "+") offset++;
  const start = offset;
  let value = 0n;
  while (text.charCodeAt(offset) >= 48 && text.charCodeAt(offset) <= 57) {
    value = value > unsignedMaximum ? unsignedMaximum + 1n : value * 10n + BigInt(text.charCodeAt(offset) - 48);
    offset++;
  }
  if (offset === start || !count && offset !== text.length || !count && value > unsignedMaximum) {
    throw new ShufDiagnostic(`invalid ${count ? "line count" : "input range"}: ${quote(text, false, unicode)}${!count && offset === text.length && value > unsignedMaximum ? ": Value too large for defined data type" : ""}`);
  }
  return value;
}

interface Settings {
  echo: boolean;
  repeat: boolean;
  separator: number;
  count: bigint;
  operands: string[];
  range?: { low: bigint; length: bigint };
  output?: string;
  random?: string;
  information?: string;
}

function parse(context: CommandContext): Settings {
  const unicode = unicodeLocale(context);
  if (context.args.length > 4096) throw new PublicDiagnostic("argument limit exceeded");
  let total = 0;
  for (const argument of context.args) { total += context.argumentValues === undefined ? Buffer.byteLength(argument) : argument.length; if (total > 65536) throw new PublicDiagnostic("argument limit exceeded"); }
  const carrier = getCommandArguments(context);
  total = 0;
  for (const value of carrier.values) { total += shellValueByteLength(value); if (total > 65536) throw new PublicDiagnostic("argument limit exceeded"); }
  const args = context.args.map((_argument, index) => Array.from(carrier.bytes(index)!, byte => String.fromCharCode(byte)).join(""));
  const settings: Settings = { echo: false, repeat: false, separator: 10, count: unsignedMaximum, operands: [] };
  const long: Readonly<Record<string, string>> = { echo: "e", "input-range": "i", "head-count": "n", output: "o", "random-source": "random", repeat: "r", "zero-terminated": "z", help: "help", version: "version" };
  const apply = (key: string, value = ""): void => {
    if (key === "e") settings.echo = true;
    else if (key === "r") settings.repeat = true;
    else if (key === "z") settings.separator = 0;
    else if (key === "help" || key === "version") settings.information = key;
    else if (key === "n") { const number = decimal(value, true, unicode); if (number < settings.count) settings.count = number; }
    else if (key === "i") {
      if (settings.range) throw new ShufDiagnostic("multiple -i options specified");
      const dash = value.indexOf("-");
      const low = dash < 0 ? unsignedMaximum : decimal(value.slice(0, dash), false, unicode);
      const high = decimal(value.slice(dash + 1), false, unicode);
      const length = high - low + 1n;
      if (dash < 0 || length < 0n || length > unsignedMaximum) throw new ShufDiagnostic(`invalid input range: ${quote(value, false, unicode)}`);
      settings.range = { low, length };
    } else {
      const property = key === "o" ? "output" : "random";
      if (settings[property] !== undefined && settings[property] !== value) throw new ShufDiagnostic(`multiple ${property === "output" ? "output files" : "random sources"} specified`);
      settings[property] = value;
    }
  };
  let stopped = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (stopped || argument === "-" || !argument.startsWith("-")) {
      settings.operands.push(argument);
      if (context.env.POSIXLY_CORRECT !== undefined) stopped = true;
    } else if (argument === "--") stopped = true;
    else if (argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const name = argument.slice(2, equals < 0 ? undefined : equals);
      const matches = Object.keys(long).filter(candidate => candidate.startsWith(name));
      const selected = Object.hasOwn(long, name) ? name : matches.length === 1 ? matches[0] : undefined;
      if (!selected) throw new ShufDiagnostic(matches.length > 1 ? `option '${argument}' is ambiguous; possibilities: ${matches.map(candidate => `'--${candidate}'`).join(" ")}` : `unrecognized option '${argument}'`, true);
      const key = long[selected]!;
      const required = ["i", "n", "o", "random"].includes(key);
      if (!required && equals >= 0) throw new ShufDiagnostic(`option '--${selected}' doesn't allow an argument`, true);
      const value = required ? equals < 0 ? args[++index] : argument.slice(equals + 1) : "";
      if (value === undefined) throw new ShufDiagnostic(`option '--${selected}' requires an argument`, true);
      apply(key, value);
    } else {
      for (let position = 1; position < argument.length; position++) {
        const key = argument[position]!;
        if (!"einorz".includes(key)) throw new ShufDiagnostic(`invalid option -- '${key}'`, true);
        let value = "";
        if ("ino".includes(key)) {
          const supplied = argument.slice(position + 1) || args[++index];
          if (supplied === undefined) throw new ShufDiagnostic(`option requires an argument -- '${key}'`, true);
          value = supplied;
          position = argument.length;
        }
        apply(key, value);
      }
    }
    if (settings.information) return settings;
  }
  if (settings.echo && settings.range) throw new ShufDiagnostic("cannot combine -e and -i options", true);
  const maximum = settings.range ? 0 : settings.echo ? Infinity : 1;
  if (settings.operands.length > maximum) throw new ShufDiagnostic(`extra operand ${quote(settings.operands[maximum]!, false, unicode)}`, true);
  return settings;
}

function filePath(context: CommandContext, name: string): string {
  let decoded: string;
  try { decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(name, character => character.charCodeAt(0))); }
  catch { throw new FsError("ENOENT"); }
  return pathOf(context, decoded);
}

function ioError(error: unknown, label: string): unknown {
  if (!(error instanceof FsError)) return error;
  const descriptions: Partial<Record<FsError["code"], string>> = { ENOENT: "No such file or directory", EACCES: "Permission denied", EPERM: "Operation not permitted", EISDIR: "Is a directory", ENOTDIR: "Not a directory", EBADF: "Bad file descriptor", EIO: "Input/output error", ENOSPC: "No space left on device", EPIPE: "Broken pipe", ELOOP: "Too many levels of symbolic links", ENAMETOOLONG: "File name too long", ENOTSUP: "Operation not supported" };
  return descriptions[error.code] ? new ShufDiagnostic(`${label}: ${descriptions[error.code]}`) : error;
}

class Input {
  stat: FileStat | undefined;
  position = 0;
  seekable = false;
  private iterator: AsyncIterator<Uint8Array> | undefined;
  private reader: AsyncIterator<Uint8Array> | undefined;
  private handle: FileReadHandle | undefined;
  private pending: Promise<unknown> | undefined;
  private rawRead: Promise<IteratorResult<Uint8Array>> | undefined;
  private closing: Promise<void> | undefined;
  private ended = false;
  private retired: Promise<void> | undefined;
  private controller = new AbortController();
  readonly signal: AbortSignal;
  private empty = 0;
  private chunks = 0;

  constructor(private context: CommandContext, operation: OutputOperation, private budget: ByteInputBudget, private label: string) {
    this.signal = AbortSignal.any([operation.signal, this.controller.signal]);
    operation.registerCleanup(() => this.close());
  }

  async open(name?: string): Promise<void> {
    const { context, signal } = this;
    signal.throwIfAborted();
    let file: { path: string; capabilities: CommandContext["fs"]["capabilities"]; retained: boolean } | undefined;
    if (name !== undefined) {
      try {
        const path = filePath(context, name);
        const capabilities = await context.fs.capabilitiesFor?.(path, { signal }) ?? context.fs.capabilities;
        signal.throwIfAborted();
        assertCommandRequirements(context, textOutputRequirements, ["file"], capabilities);
        const retained = Boolean(context.fs.openReadFile && capabilities.retainedRead !== false);
        if (!retained) {
          this.stat = capabilities.stat !== false ? await context.fs.stat(path, { signal }) : undefined;
          signal.throwIfAborted();
        }
        file = { path, capabilities, retained };
      } catch (error) { signal.throwIfAborted(); throw ioError(error, quote(name, true, unicodeLocale(context))); }
    }
    const pending = Promise.resolve().then(async () => {
      signal.throwIfAborted();
      let source: ByteSource;
      if (name === undefined) {
        this.stat = context.stdinInput?.stat;
        this.position = context.stdinInput?.position ?? 0;
        this.seekable = typeof context.stdinInput?.seek === "function";
        source = context.stdinInput ? { [Symbol.asyncIterator]: () => ({ next: () => context.stdinInput!.read(65536, signal) }) } : context.stdin;
      } else {
        try {
          const { path, capabilities, retained } = file!;
          if (retained) {
            this.handle = await context.fs.openReadFile!(path, { signal });
            signal.throwIfAborted();
          }
          if (this.handle) {
            this.stat = await this.handle.stat({ signal });
            signal.throwIfAborted();
            this.seekable = this.stat.type === "file";
            source = { [Symbol.asyncIterator]: () => ({ next: async () => {
              const bytes = await this.handle!.read(this.position, 65536, { signal });
              return bytes.length ? { done: false, value: bytes } : { done: true, value: undefined };
            } }) };
          } else if (context.fs.readStream && capabilities.streamingRead !== false) {
            source = context.fs.readStream(path, { signal, chunkSize: 65536 });
          } else {
            if (capabilities.read === false) throw new FsError("ENOTSUP");
            source = { async *[Symbol.asyncIterator]() { yield await context.fs.readFile(path, { signal, maxBytes: bufferLimit }); } };
          }
        } catch (error) { signal.throwIfAborted(); throw ioError(error, quote(name, true, unicodeLocale(context))); }
      }
      signal.throwIfAborted();
      this.iterator = source[Symbol.asyncIterator]();
      this.reader = this.budget.read({ [Symbol.asyncIterator]: () => ({
        next: async () => {
          this.rawRead = Promise.resolve().then(() => this.iterator!.next());
          const item = await this.rawRead;
          this.ended = Boolean(item.done);
          return item;
        },
        return: async () => { await this.retire(); return { done: true, value: undefined }; },
      }) }, signal)[Symbol.asyncIterator]();
    });
    this.pending = pending;
    return pending;
  }

  next(): Promise<Uint8Array | null> {
    const pending = (async () => {
      this.signal.throwIfAborted();
      while (true) {
        let item: IteratorResult<Uint8Array>;
        try { item = await this.reader!.next(); }
        catch (error) {
          this.signal.throwIfAborted();
          if (error instanceof FsError && error.code === "EFBIG") throw new PublicDiagnostic("byte command input limit exceeded");
          throw ioError(error, this.label);
        }
        this.signal.throwIfAborted();
        if (item.done) return null;
        const owned = new Uint8Array(item.value);
        this.position += owned.length;
        if (++this.chunks % 256 === 0) await yieldTurn(this.signal);
        if (owned.length) { this.empty = 0; return owned; }
        if (++this.empty > 4096) throw new PublicDiagnostic("empty input chunk limit exceeded");
      }
    })();
    this.pending = pending;
    return pending;
  }

  private retire(): Promise<void> {
    this.retired ??= Promise.resolve().then(async () => { if (!this.ended) await this.iterator?.return?.(); });
    return this.retired;
  }

  close(): Promise<void> {
    this.closing ??= Promise.resolve().then(async () => {
      await this.pending?.catch(() => undefined);
      const results = await Promise.allSettled([this.retire(), this.reader?.return?.()]);
      await this.rawRead?.catch(() => undefined);
      try { for (const result of results) if (result.status === "rejected") throw result.reason; }
      finally { await this.handle?.close(); }
    });
    this.controller.abort(new Error("shuf input closed"));
    return this.closing;
  }
}

class Random {
  private number = 0;
  private maximum = 0;
  private bytes: Uint8Array = new Uint8Array();
  private offset = 0;
  private consumed = 0;
  private state: Uint32Array | undefined;

  constructor(private input: Input | undefined, private name: string | undefined, private signal: AbortSignal, private unicode: boolean, needsRandom: boolean) {
    if (!input && needsRandom) {
      this.state = crypto.getRandomValues(new Uint32Array(4));
      if (this.state.every(value => value === 0)) this.state[0] = 1;
    }
  }

  private async byte(): Promise<number> {
    this.signal.throwIfAborted();
    if (++this.consumed > 4 * 1024 * 1024) throw new PublicDiagnostic("random byte limit exceeded");
    if (this.offset === this.bytes.length) {
      if (this.input) {
        const bytes = await this.input.next();
        if (!bytes) throw new ShufDiagnostic(`${quote(this.name!, false, this.unicode)}: end of file`);
        this.bytes = bytes;
      } else {
        const state = this.state!;
        const product = Math.imul(state[1]!, 5);
        const result = Math.imul((product << 7) | (product >>> 25), 9) >>> 0;
        const shifted = state[1]! << 9;
        state[2] = state[2]! ^ state[0]!;
        state[3] = state[3]! ^ state[1]!;
        state[1] = state[1]! ^ state[2]!;
        state[0] = state[0]! ^ state[3]!;
        state[2] = state[2]! ^ shifted;
        state[3] = (state[3]! << 11) | (state[3]! >>> 21);
        this.bytes = Uint8Array.of(result & 255, (result >>> 8) & 255, (result >>> 16) & 255, result >>> 24);
      }
      this.offset = 0;
    }
    return this.bytes[this.offset++]!;
  }

  async choose(choices: number): Promise<number> {
    const target = choices - 1;
    for (let attempt = 0; attempt < 4096; attempt++) {
      if (attempt % 256 === 255) await yieldTurn(this.signal);
      while (this.maximum < target) { this.number = this.number * 256 + await this.byte(); this.maximum = this.maximum * 256 + 255; }
      if (this.maximum === target) { const result = this.number; this.number = this.maximum = 0; return result; }
      const excess = this.maximum - target;
      const unusable = excess % choices;
      const reduced = this.number % choices;
      if (this.number <= this.maximum - unusable) {
        this.number = Math.floor(this.number / choices);
        this.maximum = Math.floor(excess / choices);
        return reduced;
      }
      this.number = reduced;
      this.maximum = unusable - 1;
    }
    throw new PublicDiagnostic("random selection work limit exceeded");
  }
}

async function* records(input: Input, separator: number): AsyncGenerator<Uint8Array> {
  const pending = new RecordBuffer(bufferLimit);
  let recordCount = 0;
  try {
    while (true) {
      const bytes = await input.next();
      if (!bytes) break;
      let start = 0;
      for (let offset = 0; offset < bytes.length; offset++) {
        if (offset % 65536 === 65535) await yieldTurn(input.signal);
        if (bytes[offset] !== separator) continue;
        if (++recordCount > maximumLines) throw new PublicDiagnostic("input line limit exceeded");
        yield pending.finish(undefined, bytes, start, offset + 1);
        start = offset + 1;
      }
      pending.append(bytes, start);
    }
    if (pending.size) {
      if (++recordCount > maximumLines) throw new PublicDiagnostic("input line limit exceeded");
      yield pending.finish(undefined, Uint8Array.of(separator));
    }
  } finally { pending.clear(); }
}

async function permutation(random: Random, count: number, length: number, signal: AbortSignal): Promise<Uint32Array> {
  if (count === 0) return new Uint32Array();
  const sparse = count > 1 && length >= 128 * 1024 && Math.floor(length / count) >= 32;
  const indices = new Uint32Array(length);
  for (let index = 0; index < length; index++) {
    indices[index] = index;
    if (index % 65536 === 65535) await yieldTurn(signal);
  }
  for (let index = 0; index < count; index++) {
    const selected = index + await random.choose(length - index);
    if (sparse && index === selected) indices[index] = index;
    else {
      const previous = indices[index]!;
      indices[index] = indices[selected]!;
      indices[selected] = previous;
    }
    if (index % 1024 === 1023) await yieldTurn(signal);
  }
  return indices.subarray(0, count);
}

export function shufCommand(): CommandDefinition {
  return { name: "shuf", filesystemRequirements: textOutputRequirements, async execute(context) {
    context.signal.throwIfAborted();
    const root = createOutputOperation(context, { async write() {} });
    let operation = root;
    let failure = false;
    const run = async () => {
      try {
        const unicode = unicodeLocale(context);
        const settings = parse(context);
        operation = settings.output === undefined || settings.information ? root.child(context.stdout) : root;
        const signal = operation.signal;
        if (settings.information) {
          await writeBytes(operation.output, new TextEncoder().encode(settings.information === "version" ? "shuf (virtual-bash)\n" : "Usage: shuf [OPTION]... [FILE]\n  or: shuf -e [OPTION]... [ARG]...\n  or: shuf -i LO-HI [OPTION]...\n  -e, --echo                 shuffle arguments\n  -i, --input-range=LO-HI    shuffle an inclusive range\n  -n, --head-count=COUNT     output at most COUNT records\n  -o, --output=FILE          write to a VFS file\n      --random-source=FILE   read random bytes from a VFS file\n  -r, --repeat               sample with replacement (requires -n)\n  -z, --zero-terminated      delimit records with NUL\n      --help                 display help\n      --version              display virtual command identity\n"), signal);
          return { exitCode: 0 };
        }
        if (settings.repeat && settings.count === unsignedMaximum) throw new PublicDiagnostic("repeat requires a bounded head count (-n)");
        if (settings.count !== 0n && settings.range && settings.range.length > BigInt(maximumLines)) throw new PublicDiagnostic("input range limit exceeded");
        if (settings.repeat && settings.count > BigInt(maximumLines)) throw new PublicDiagnostic("output line limit exceeded");
        const budget = new ByteInputBudget(bufferLimit);
        let input: Input | undefined;
        let reservoir = false;
        let lines: Uint8Array[] = [];
        if (settings.echo) lines = settings.operands.map(text => Uint8Array.from(text + String.fromCharCode(settings.separator), character => character.charCodeAt(0)));
        else if (!settings.range) {
          input = new Input(context, operation, budget, "read error");
          const name = settings.operands[0];
          await input.open(settings.count === 0n || name === "-" ? undefined : name);
          reservoir = !settings.repeat && settings.count !== unsignedMaximum && (settings.count === 0n || !input.seekable || input.stat!.size - input.position > reservoirThreshold);
          if (!reservoir) for await (const line of records(input, settings.separator)) lines.push(line);
        }
        let length = settings.range ? Number(settings.range.length) : lines.length;
        let count = Number(settings.count > BigInt(maximumLines) ? BigInt(maximumLines) : settings.count);
        if (!settings.repeat && !reservoir) count = Math.min(count, length);
        const needsRandom = reservoir || settings.repeat || count > 0 && length > 1;
        let randomInput: Input | undefined;
        if (settings.random !== undefined && needsRandom) {
          randomInput = new Input(context, operation, new ByteInputBudget(bufferLimit), `${quote(settings.random, false, unicode)}: read error`);
          await randomInput.open(settings.random);
        }
        const random = new Random(randomInput, settings.random, signal, unicode, needsRandom);
        if (reservoir && count > 0) {
          const iterator = records(input!, settings.separator);
          try {
            while (lines.length < count) {
              const item = await iterator.next();
              if (item.done) break;
              lines.push(item.value);
            }
            if (lines.length === count) {
              let seen = count;
              while (true) {
                const selected = await random.choose(seen + 1);
                const item = await iterator.next();
                if (item.done) break;
                if (selected < count) lines[selected] = item.value;
                if (++seen % 1024 === 0) await yieldTurn(signal);
              }
            }
          } finally { await iterator.return(undefined); }
        }
        if (reservoir) { length = lines.length; count = length; }
        await input?.close();
        const indices = settings.repeat ? undefined : await permutation(random, count, length, signal);
        let outputBytes = 0;
        const generated: ByteSource = { async *[Symbol.asyncIterator]() {
          if (settings.repeat && count > 0 && length === 0) throw new ShufDiagnostic("no lines to repeat");
          for (let index = 0; index < count; index++) {
            signal.throwIfAborted();
            const selected = settings.repeat ? await random.choose(length) : indices![index]!;
            const line = settings.range ? new TextEncoder().encode(String(settings.range.low + BigInt(selected)) + String.fromCharCode(settings.separator)) : lines[selected]!;
            outputBytes += line.length;
            if (outputBytes > bufferLimit) throw new PublicDiagnostic("output byte limit exceeded");
            yield line;
            if (index % 1024 === 1023) await yieldTurn(signal);
          }
        } };
        if (settings.output === undefined) {
          for await (const bytes of generated) await writeBytes(operation.output, bytes, signal);
        } else {
          const name = settings.output;
          try {
            const path = filePath(context, name);
            const capabilities = await context.fs.capabilitiesFor?.(path, { signal }) ?? context.fs.capabilities;
            signal.throwIfAborted();
            assertCommandRequirements(context, textOutputRequirements, ["output"], capabilities);
            await operation.acquire(async signal => {
              if (context.fs.writeStream && capabilities.streamingWrite !== false) await context.fs.writeStream(path, generated, { signal });
              else {
                await context.fs.writeFile(path, new Uint8Array(), { signal });
                const parts: Uint8Array[] = [];
                for await (const bytes of generated) parts.push(bytes);
                const bytes = new Uint8Array(outputBytes);
                let offset = 0;
                for (const part of parts) { bytes.set(part, offset); offset += part.length; }
                await context.fs.writeFile(path, bytes, { signal });
              }
            }, () => {});
          } catch (error) { signal.throwIfAborted(); throw ioError(error, quote(name, true, unicode)); }
        }
        return { exitCode: 0 };
      } catch (error) {
        failure = true;
        context.signal.throwIfAborted();
        if (operation.signal.aborted) throw operation.signal.reason;
        if (error instanceof ShufDiagnostic) await writeBytes(context.stderr, Uint8Array.from(`shuf: ${error.detail}\n${error.usage ? "Try 'shuf --help' for more information.\n" : ""}`, character => character.charCodeAt(0)), context.signal);
        else await diagnostic(context, error);
        return { exitCode: 1 };
      }
    };
    const outcome = await run().then(result => ({ ok: true as const, result }), error => ({ ok: false as const, error }));
    try { await root.close(); }
    catch (error) { if (!failure) { context.signal.throwIfAborted(); throw error; } }
    if (!outcome.ok) throw outcome.error;
    return outcome.result;
  } };
}
