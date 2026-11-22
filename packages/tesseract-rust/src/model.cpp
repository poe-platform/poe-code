#include <tesseract/baseapi.h>

// The C API omits Init's FileReader argument. Keep model loading entirely in
// memory, including failed initialization and implicit sublanguage lookups.
extern "C" int PoeTesseractInit(void *handle, const unsigned char *data,
                                int size, const char *language) {
  return static_cast<tesseract::TessBaseAPI *>(handle)->Init(
      reinterpret_cast<const char *>(data), size, language,
      tesseract::OEM_LSTM_ONLY, nullptr, 0, nullptr, nullptr, true,
      [](const char *, std::vector<char> *) { return false; });
}
