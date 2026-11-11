#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_BBOX_H
#include <stdlib.h>

static FT_Library library;
static FT_Face face;
static int values[11];

int font_open(unsigned char *bytes, int length, double size, int xdpi, int ydpi) {
  if (FT_Init_FreeType(&library) || FT_New_Memory_Face(library, bytes, length, 0, &face)) return 1;
  return FT_Set_Char_Size(face, (FT_F26Dot6)(size * 64), (FT_F26Dot6)(size * 64), xdpi, ydpi);
}
int *font_metrics(void) {
  values[0] = face->size->metrics.ascender;
  values[1] = face->size->metrics.descender;
  values[2] = face->size->metrics.height;
  values[3] = face->underline_position * face->size->metrics.x_ppem * 64 / face->units_per_EM;
  return values;
}
int *font_glyph(unsigned int code) {
  FT_UInt id = FT_Get_Char_Index(face, code);
  if (FT_Load_Glyph(face, id, FT_LOAD_TARGET_LIGHT | FT_LOAD_RENDER)) return NULL;
  FT_GlyphSlot glyph = face->glyph;
  values[0] = glyph->bitmap.width;
  values[1] = glyph->bitmap.rows;
  values[2] = glyph->bitmap.pitch;
  values[3] = (int)glyph->bitmap.buffer;
  values[4] = glyph->bitmap_left;
  values[5] = glyph->bitmap_top;
  values[6] = glyph->advance.x;
  values[7] = id;
  FT_BBox bounds = {0};
  FT_Outline_Get_BBox(&glyph->outline, &bounds);
  values[8] = bounds.xMin;
  values[9] = bounds.xMax;
  values[10] = glyph->linearHoriAdvance;
  return values;
}
int font_kerning(unsigned int left, unsigned int right, int unfitted) {
  FT_Vector delta = {0, 0};
  FT_Get_Kerning(face, left, right, unfitted ? FT_KERNING_UNFITTED : FT_KERNING_DEFAULT, &delta);
  return delta.x;
}
void font_close(void) {
  if (face) FT_Done_Face(face);
  if (library) FT_Done_FreeType(library);
  face = NULL;
  library = NULL;
}
