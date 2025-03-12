export interface WasmModule {
	_malloc: (size: number) => number
	_free: (ptr: number) => void
	_loadFont: (bytes: number, size: number) => number
	_getFontMetrics: (fontMetrics: number) => number
	_getFontWhitespaceWidth: (whitespaceInfo: number) => number
	_getGlyphIndex: (unicode: number) => number
	_getNextKerning: (state: number) => number
	_loadGlyph: (glyphIndex: number, output: number, preprocess: number) => number
	_destroyGlyph: (shape: number) => void
	_generateMSDF: (shape: number, config: number) => number
	_getBitmapPixels: (bitmap: number) => number
	_destroyBitmap: (bitmap: number) => void
	_pngEncoder_convertRaw: (ptr: number, width: number, height: number, compressionLevel: number) => number
	HEAP8: Int8Array
	HEAP16: Int16Array
	HEAP32: Int32Array
	HEAPU8: Uint8Array
	HEAPU16: Uint16Array
	HEAPU32: Uint32Array
	HEAPF32: Float32Array
	HEAPF64: Float64Array
}

export default WasmModule
