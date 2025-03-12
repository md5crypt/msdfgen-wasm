#include "msdfgen.h"
#include "msdfgen-ext.h"
#include "core/ShapeDistanceFinder.h"

extern "C" {
	typedef enum {
		ERROR_NO_ERROR = 0,
		ERROR_OPERATION_FAILED = 1,
		ERROR_INITIALIZATION_FAILED = 2,
		ERROR_NO_FONT_LOADED = 3,
		ERROR_MORE_DATA = 4,
	} error_t;

	static msdfgen::FreetypeHandle* freetypeHandle = NULL;
	static msdfgen::FontHandle* fontHandle = NULL;
	
	uint32_t loadFont(uint8_t* bytes, uint32_t size) {
		if (freetypeHandle == NULL) {
			freetypeHandle = msdfgen::initializeFreetype();
			if (freetypeHandle == NULL) {
				return ERROR_INITIALIZATION_FAILED;
			}
		}
		if (fontHandle != NULL) {
			msdfgen::destroyFont(fontHandle);
		}
		fontHandle = msdfgen::loadFontData(freetypeHandle, bytes, size);
		if (fontHandle == NULL) {
			return ERROR_OPERATION_FAILED;
		}
		return ERROR_NO_ERROR;
	}

	uint32_t getFontMetrics(msdfgen::FontMetrics* fontMetrics) {
		if (fontHandle == NULL) {
			return ERROR_NO_FONT_LOADED;
		}
		return msdfgen::getFontMetrics(*fontMetrics, fontHandle, msdfgen::FONT_SCALING_EM_NORMALIZED) ? ERROR_NO_ERROR : ERROR_OPERATION_FAILED;
	}

	typedef struct {
		double spaceAdvance;
		double tabAdvance;
	} whitespaceInfo_t;

	uint32_t getFontWhitespaceWidth(whitespaceInfo_t* whitespaceInfo) {
		if (fontHandle == NULL) {
			return ERROR_NO_FONT_LOADED;
		}
		return msdfgen::getFontWhitespaceWidth(whitespaceInfo->spaceAdvance, whitespaceInfo->tabAdvance, fontHandle, msdfgen::FONT_SCALING_EM_NORMALIZED) ? ERROR_NO_ERROR : ERROR_OPERATION_FAILED;
	}

	uint32_t getGlyphIndex(uint32_t unicode) {
		if (fontHandle == NULL) {
			return 0;
		}
		msdfgen::GlyphIndex glyphIndex;
		msdfgen::getGlyphIndex(glyphIndex, fontHandle, unicode);
		return glyphIndex.getIndex();
	}

	typedef struct {
		uint32_t left;
		uint32_t right;
		uint32_t count;
		uint32_t* list;
		double output;
	} kerningSearchState_t;

	uint32_t getNextKerning(kerningSearchState_t* state) {
		if (fontHandle == NULL) {
			return ERROR_NO_FONT_LOADED;
		}
		for (uint32_t i = state->left; i < state->count; i += 1) {
			for (uint32_t j = state->right; j < state->count; j += 1) {
				if (msdfgen::getKerning(state->output, fontHandle, msdfgen::GlyphIndex(state->list[i]), msdfgen::GlyphIndex(state->list[j]), msdfgen::FONT_SCALING_EM_NORMALIZED) && state->output != 0) {
					state->left = i;
					state->right = j;
					return ERROR_MORE_DATA;
				}
			}
			state->right = 0;
		}
		return ERROR_NO_ERROR;
	}

	typedef struct {
		msdfgen::Shape* shape;
		uint32_t _spacer;
		double advance;
		msdfgen::Shape::Bounds bounds;
	} shapeData_t;

	uint32_t loadGlyph(uint32_t glyphIndex, shapeData_t* output, uint32_t preprocess) {
		if (fontHandle == NULL) {
			return ERROR_NO_FONT_LOADED;
		}
		msdfgen::Shape* shape = new msdfgen::Shape;
		if (!msdfgen::loadGlyph(*shape, fontHandle, msdfgen::GlyphIndex(glyphIndex), msdfgen::FONT_SCALING_EM_NORMALIZED, &output->advance)) {
			return ERROR_OPERATION_FAILED;
		}
		shape->normalize();
		if (preprocess) {
			resolveShapeGeometry(*shape);
		}
		output->shape = shape;
		if (shape->contours.size() > 0) {
			output->bounds = shape->getBounds();
			if (!preprocess) {
				msdfgen::Shape::Bounds& bounds = output->bounds;
				msdfgen::Point2 outerPoint(
					bounds.l - (bounds.r - bounds.l) - 1,
					bounds.b - (bounds.t - bounds.b) - 1
				);
				if (msdfgen::SimpleTrueShapeDistanceFinder::oneShotDistance(*shape, outerPoint) > 0) {
					for (msdfgen::Contour& contour : shape->contours) {
						contour.reverse();
					}
				}
			}
		} else {
			output->bounds = {0, 0, 0, 0};
		}
		
		return ERROR_NO_ERROR;
	}

	void destroyGlyph(msdfgen::Shape* shape) {
		delete shape;
	}
	
	typedef struct {
		double scale;
		double xTranslate;
		double yTranslate;
		double range;
		double edgeColoring;
		double angleThreshold;
		double width;
		double height;
		double scanline;
	} generateConfig_t;

	msdfgen::Bitmap<float, 3>* generateMSDF(msdfgen::Shape* shape, generateConfig_t* config) {
		if (config->edgeColoring == 1) {
			msdfgen::edgeColoringInkTrap(*shape, config->angleThreshold);
		} else if (config->edgeColoring == 2) {
			msdfgen::edgeColoringByDistance(*shape, config->angleThreshold);
		} else {
			msdfgen::edgeColoringSimple(*shape, config->angleThreshold);
		}
		msdfgen::Bitmap<float, 3>* bitmap = new msdfgen::Bitmap<float, 3>(config->width, config->height);
		msdfgen::SDFTransformation transformation(msdfgen::Projection(config->scale, msdfgen::Vector2(config->xTranslate, config->yTranslate)), msdfgen::Range(config->range));
		msdfgen::generateMSDF(*bitmap, *shape, transformation);
		if (config->scanline) {
			distanceSignCorrection(*bitmap, *shape, transformation);
			msdfErrorCorrection(*bitmap, *shape, transformation);
		}
		return bitmap;
	}

	float* getBitmapPixels(msdfgen::Bitmap<float, 3>* bitmap) {
		return (*bitmap)(0, 0);
	}

	void destroyBitmap(msdfgen::Bitmap<float, 3>* bitmap) {
		delete bitmap;
	}
}
