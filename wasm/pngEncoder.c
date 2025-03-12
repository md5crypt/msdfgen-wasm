#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <png.h>

typedef struct {
	uint32_t size;
	uint8_t data[0];
} pngEncoder_output_t;

static void pngEncoder_errorCallback(png_structp png, png_const_charp msg) {
	(void) msg;
	longjmp(png_jmpbuf(png), 1);
}

static void pngEncoder_writeCallback(png_structp png, png_bytep data, png_size_t length) {
	pngEncoder_output_t* output = (pngEncoder_output_t*)png_get_io_ptr(png);
	memcpy(output->data + output->size, data, length);
	output->size += length;
}

static void pngEncoder_flushCallback(png_structp png) {
	(void) png;
}

pngEncoder_output_t* pngEncoder_convertRaw(uint8_t* data, uint32_t width, uint32_t height, uint32_t compressionLevel) {
	png_structp png = png_create_write_struct(PNG_LIBPNG_VER_STRING, NULL, pngEncoder_errorCallback, NULL);
	if (png == NULL) {
		return NULL;
	}
	png_infop info = png_create_info_struct(png);
	if (info == NULL) {
		png_destroy_write_struct(&png, NULL);
		return NULL;
	}
	pngEncoder_output_t* output = (pngEncoder_output_t*)malloc(sizeof(pngEncoder_output_t) + width * height * 4);
	output->size = 0;
	if (setjmp(png_jmpbuf(png))) {
		free(output);
		png_destroy_write_struct(&png, &info);
		return NULL;
	}
	png_set_write_fn(png, output, pngEncoder_writeCallback, pngEncoder_flushCallback);
	png_set_filter(png, 0, PNG_ALL_FILTERS);
	png_set_compression_level(png, compressionLevel);
	png_set_IHDR(png, info, width, height, 8, PNG_COLOR_TYPE_RGBA, PNG_INTERLACE_NONE, PNG_COMPRESSION_TYPE_DEFAULT, PNG_FILTER_TYPE_DEFAULT);
	png_write_info(png, info);
	for (uint32_t i = 0; i < height; i += 1) {
		uint8_t* row = data + i * width * 4;
		png_write_rows(png, &row, 1);
	}
	png_write_end(png, info);
	png_destroy_write_struct(&png, &info);
	return output;
}