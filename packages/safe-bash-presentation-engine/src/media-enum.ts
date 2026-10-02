import { defineEnum } from "./enum-definition.js";

enum PP_MEDIA_TYPEValues {
  MOVIE = 3,
  OTHER = 1,
  SOUND = OTHER,
  MIXED = -2
}
export type PP_MEDIA_TYPE = (typeof PP_MEDIA_TYPEValues)[keyof typeof PP_MEDIA_TYPEValues];
export const PP_MEDIA_TYPE = defineEnum(PP_MEDIA_TYPEValues);
