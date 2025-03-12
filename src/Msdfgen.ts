import WasmModule from "./WasmModule"
import wasmModuleFactory from "./wasmModuleFactory"
import WasmBlob from "./WasmBlob"
import WasmErrorCodes from "./WasmErrorCodes"
import { Bitmap } from "./Bitmap"
import {
	MaxRectsPacker,
	IOption as MaxRectsPackerOptions
} from "maxrects-packer"

export interface MsdfOptions {
	size: number
	range: number
	scanline?: boolean
	edgeColoring?: "simple" | "inktrap" | "distance"
	edgeThresholdAngle?: number
}

export interface AtlasOptions extends MaxRectsPackerOptions {
	maxWidth: number
	maxHeight: number
	padding: number
}

export interface FontMetrics {
	emSize: number
	ascenderY: number
	descenderY: number
	lineHeight: number
	underlineY: number
	underlineThickness: number
	spaceAdvance: number
	tabAdvance: number
}

export interface Glyph {
	unicode: number
	index: number
	advance: number
	left: number
	bottom: number
	right: number
	top: number
	kerning: [Glyph, number][]
	// @internal
	_ptr: number
}

export interface MsdfData {
	scale: number
	xTranslate: number
	yTranslate: number
	range: number
	edgeColoring: "simple" | "inktrap" | "distance"
	edgeThresholdAngle: number
	width: number
	height: number
	scanline: boolean
}

export interface PackedGlyphRectangle {
	x: number
	y: number
	width: number
	height: number
	rot: boolean
	oversized: boolean
	glyph: Glyph
	msdfData: MsdfData
}

export interface PackedGlyphsBin {
	width: number
	height: number
	rects: PackedGlyphRectangle[]
}

enum EdgeColoring {
	simple = 0,
	inktrap = 1,
	distance = 2
}

export class Msdfgen {
	public static create(wasm: ArrayBufferLike) {
		return wasmModuleFactory({wasm}).then(module => new this(module))
	}

	private readonly _module: WasmModule
	private _tmp: number
	private _glyphs: Glyph[] | null
	private _glyphMap: Map<number, Glyph> | null
	private _metrics: FontMetrics | null
	private _font: WasmBlob | null

	private constructor(module: WasmModule) {
		this._module = module
		this._tmp = this._module._malloc(256)
		this._glyphs = null
		this._glyphMap = null
		this._metrics = null
		this._font = null
	}

	private londFontMetrics() {
		let errorCode = this._module._getFontMetrics(this._tmp)
		if (errorCode != 0) {
			throw new Error(WasmErrorCodes[errorCode])
		}
		const dataView = this._module.HEAPF64.subarray(this._tmp / 8)
		const metrics = {
			emSize: dataView[0],
			ascenderY: dataView[1],
			descenderY: dataView[2],
			lineHeight: dataView[3],
			underlineY: dataView[4],
			underlineThickness: dataView[5]
		} as FontMetrics
		errorCode = this._module._getFontWhitespaceWidth(this._tmp)
		if (errorCode != 0) {
			throw new Error(WasmErrorCodes[errorCode])
		}
		metrics.spaceAdvance = dataView[0]
		metrics.tabAdvance = dataView[1]
		return metrics
	}

	private unloadGlyphs() {
		if (this._glyphs) {
			this._glyphs.forEach(x => this._module._destroyGlyph(x._ptr))
			this._glyphs = null
			this._glyphMap = null
		}
	}

	private loadKerningData() {
		const glyphs = this._glyphs!
		const charset = glyphs.map(x => x.index)
		const blob = new WasmBlob(this._module, (new Uint8Array(new Uint32Array(glyphs.map(x => x.index)).buffer)))
		const output = [] as [Glyph, Glyph, number][]
		const intView = this._module.HEAPU32.subarray(this._tmp / 4)
		const floatView = this._module.HEAPF64.subarray((this._tmp + 16) / 8)
		intView[0] = 0
		intView[1] = 0
		intView[2] = charset.length
		intView[3] = blob.ptr
		let errorCode
		while (true) {
			errorCode = this._module._getNextKerning(this._tmp)
			if (errorCode != WasmErrorCodes.ERROR_MORE_DATA) {
				break
			}
			glyphs[intView[0]].kerning.push([glyphs[intView[1]], floatView[0]])
			intView[1] += 1
		}
		blob.release()
		if (errorCode != 0) {
			throw new Error(WasmErrorCodes[errorCode])
		}
		return output
	}

	public loadFont(data: Uint8Array, characters?: number[]) {
		this.unloadGlyphs()
		if (this._font) {
			this._font.release()
		}
		this._font = new WasmBlob(this._module, data)
		const errorCode = this._module._loadFont(this._font.ptr, this._font.size)
		if (errorCode != 0) {
			throw new Error(WasmErrorCodes[errorCode])
		}
		this._metrics = this.londFontMetrics()
		if (characters) {
			this.loadGlyphs(characters)
		}
	}

	public computeGlpyhMsdfData(glyph: Glyph, options: MsdfOptions) {
		const dx = glyph.right - glyph.left
		const dy = glyph.top - glyph.bottom
		const empty = dx == 0 && dy == 0
		const range = options.range
		const size = options.size
		const width = size * dx + range
		const height = size * dy + range
		const msdfData: MsdfData = {
			width: empty ? 0 : Math.round(width),
			height: empty ? 0 : Math.round(height),
			scale: size,
			range: range / size,
			edgeThresholdAngle: options.edgeThresholdAngle || 3,
			edgeColoring: options.edgeColoring || "simple",
			xTranslate: empty ? 0 : -glyph.left + range / size / 2,
			yTranslate: empty ? 0 : -glyph.bottom + range / size / 2 - (height - Math.round(height)) / size,
			scanline: options.scanline || false
		}
		return msdfData
	}

	public loadGlyphs(characters: number[], options?: {preprocess: boolean}) {
		options = {
			preprocess: true,
			...options
		}
		if (this._metrics == null) {
			throw new Error("font not loaded")
		}
		this.unloadGlyphs()
		this._glyphs = []
		this._glyphMap = new Map()
		const floatView = this._module.HEAPF64.subarray((this._tmp + 8) / 8)
		for (const unicode of characters) {
			const index = this._module._getGlyphIndex(unicode)
			if (index == 0) {
				continue
			}
			const errorCode = this._module._loadGlyph(index, this._tmp, options.preprocess ? 1 : 0)
			if (errorCode != 0) {
				throw new Error(WasmErrorCodes[errorCode])
			}
			const glyph: Glyph = {
				index,
				unicode,
				advance: floatView[0],
				left: floatView[1],
				bottom: floatView[2],
				right: floatView[3],
				top: floatView[4],
				kerning: [],
				_ptr: this._module.HEAPU32[this._tmp / 4],
			}
			this._glyphs.push(glyph)
			this._glyphMap.set(glyph.unicode, glyph)
		}
		this.loadKerningData()
	}

	public generateBitmap(glyph: Glyph, config: MsdfData) {
		const dataView = this._module.HEAPF64.subarray(this._tmp / 8)
		dataView[0] = config.scale
		dataView[1] = config.xTranslate
		dataView[2] = config.yTranslate
		dataView[3] = config.range
		dataView[4] = EdgeColoring[config.edgeColoring]
		dataView[5] = config.edgeThresholdAngle
		dataView[6] = config.width
		dataView[7] = config.height
		dataView[8] = config.scanline ? 1 : 0
		const bitmap = this._module._generateMSDF(glyph._ptr, this._tmp)
		const data = this._module.HEAPF32.subarray(this._module._getBitmapPixels(bitmap) / 4)
		const output = new Bitmap(config.width, config.height)
		const clampedView = new Uint8ClampedArray(output.buffer)
		let outOffset = 0
		for (let y = 0; y < config.height; y += 1) {
			let inOffset = config.width * (config.height - (y + 1)) * 3
			for (let x = 0; x < config.width; x += 1) {
				clampedView[outOffset + 0] = data[inOffset + 0] * 256
				clampedView[outOffset + 1] = data[inOffset + 1] * 256
				clampedView[outOffset + 2] = data[inOffset + 2] * 256
				clampedView[outOffset + 3] = 255
				inOffset += 3
				outOffset += 4
			}
		}
		this._module._destroyBitmap(bitmap)
		return output
	}

	public createPng(bitmap: Bitmap, compressionLevel = 6) {
		const blob = new WasmBlob(this._module, new Uint8Array(bitmap.buffer))
		const result = this._module._pngEncoder_convertRaw(blob.ptr, bitmap.width, bitmap.height, compressionLevel)
		blob.release()
		if (!result) {
			throw new Error("failed to create png")
		}
		const output = new Uint8Array(this._module.HEAPU32[result / 4])
		output.set(this._module.HEAPU8.subarray(result + 4, result + 4 + output.length))
		this._module._free(result)
		return output
	}

	public packGlyphs(msdfOptions: MsdfOptions, atlasOptions: AtlasOptions, glyphs?: Glyph[]): PackedGlyphsBin[] {
		if (this._glyphs == null) {
			throw new Error("glyphs not loaded")
		}

		const packer = new MaxRectsPacker<PackedGlyphRectangle>(
			atlasOptions.maxWidth,
			atlasOptions.maxHeight,
			atlasOptions.padding,
			atlasOptions
		)

		packer.addArray((glyphs || this._glyphs).map(glyph => {
			const msdfData = this.computeGlpyhMsdfData(glyph, msdfOptions)
			return {
				width: msdfData.width,
				height: msdfData.height,
				msdfData,
				glyph
			} as PackedGlyphRectangle
		}))

		return packer.bins.map(bin => ({
			width: bin.width,
			height: bin.height,
			rects: bin.rects
		}))
	}

	public createAtlasImage(bin: PackedGlyphsBin) {
		const texture = new Bitmap(bin.width, bin.height)
		for (let i = 0; i < bin.rects.length; i += 1) {
			const rect = bin.rects[i]
			if (rect.oversized) {
				throw new Error("glyph too big")
			}
			if (rect.width && rect.height) {
				const bitmap = this.generateBitmap(rect.glyph, rect.msdfData)
				texture.blit(bitmap, rect.x, rect.y, rect.rot)
			}
		}
		return this.createPng(texture, 9)
	}

	public createGlyphImage(glyph: Glyph, msdfOptions: MsdfOptions) {
		return this.createPng(this.generateBitmap(glyph, this.computeGlpyhMsdfData(glyph, msdfOptions)), 9)
	}

	public getGlyph(unicode: number) {
		if (this._glyphMap == null) {
			throw new Error("glyphs not loaded")
		}
		const glyph = this._glyphMap.get(unicode)
		if (!glyph) {
			throw new Error("glyph not found")
		}
		return glyph
	}

	public get glyphs() {
		if (this._glyphs == null) {
			throw new Error("glyphs not loaded")
		}
		return this._glyphs as Readonly<Glyph[]>
	}

	public get metrics() {
		if (this._metrics == null) {
			throw new Error("font not loaded")
		}
		return this._metrics
	}
}

export default Msdfgen
