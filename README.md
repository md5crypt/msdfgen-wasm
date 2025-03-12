# msdfgen-wasm

A webassembly build of https://github.com/Chlumsky/msdfgen (including skia preprocessing), together with typescript bindings and texture atlas generation.

Allows for generation of msdf fonts from browser with no external services.

# Usage example (nodejs)

```javascript
const fs = require("fs")
const Msdfgen = require("msdfgen-wasm").Msdfgen

async function run() {
	// create the module
	const wasm = fs.readFileSync(require.resolve("msdfgen-wasm/wasm"))
	const msdfgen = await Msdfgen.create(wasm)

	// load font file (supports ttf, otf and woff, woff2 not supported as brotli not included in build)
	msdfgen.loadFont(fs.readFileSync(process.argv[2]))

	// load glyphs by passing a array of unicode codes, only glyphs present in font are loaded
	// preprocess enables skia preprocessing (enabled by default when second argument omitted)
	msdfgen.loadGlyphs(new Array(256).fill(0).map((x, i) => i), {preprocess: true})

	// log amount of loaded glyphs by accessing loaded glyphs array
	console.log(`loaded ${msdfgen.glyphs.length} glyphs`)

	// msdf generation configuration
	const msdfOptions = {
		size: 32,
		range: 4,
		// (optional) edgeColoring: "simple",
		// (optional) edgeThresholdAngle: 3,
		// (optional) scanline: false
	}

	// texture atlas generation configuration
	const atlasOptions = {
		maxWidth: 2048,
		maxHeight: 2048,
		padding: 1,
		pot: true,
		smart: true,
		allowRotation: true,
		// [...] other options from MaxRectsPacker
	}

	// resolve the texture packing
	const bins = msdfgen.packGlyphs(msdfOptions, atlasOptions)

	// generate glyph bitmaps and create packed png images
	// see createAtlasImage implementation if you want to first generate all the
	// glyphs bitmaps and then put them on the atlas (for example to do parallel processing)
	const images = bins.map(bin => msdfgen.createAtlasImage(bin))

	// example for getting a single glyph's bitmap
	//
	// const glyph = msdfdata.getGlyph(0x0042)
	// const glpyhMsdfData = msdfdata.computeGlpyhMsdfData(glyph, msdfOptions)
	// const bitmap = msdfdata.generateBitmap(glyph, glpyhMsdfData)
	// const output = msdfdata.createPng(bitmap, 9)
	// fs.writeFileSync("test.png", output)

	// read loaded font metrics (metrics are in normalized em units)
	const metrics = msdfgen.metrics

	// generate a json in the bmfont format
	const chars = []
	const kernings = []

	const round = x => Math.round(x * 100 * msdfOptions.size) / 100
	for (let i = 0; i < bins.length; i += 1) {
		const bin = bins[i]
		for (const rect of bin.rects) {
			const glyph = rect.glyph
			const range = rect.msdfData.range
			const hasSize = rect.width && rect.height
			chars.push({
				id: glyph.unicode,
				width: rect.width,
				height: rect.height,
				x: rect.x,
				y: rect.y,
				rotated: rect.rot ? true : undefined,
				page: i,
				xadvance: round(glyph.advance),
				xoffset: hasSize ? round(glyph.left - range / 2) : 0,
				yoffset: hasSize ? round(metrics.ascenderY - (glyph.top + range / 2)) : 0
			})
			for (const kerning of glyph.kerning) {
				kernings.push({
					first: glyph.unicode,
					second: kerning[0].unicode,
					amount: round(kerning[1])
				})
			}
		}
	}

	// not all bmfont fields are present in this example
	const bmFontJson = {
		pages: images.map((x, i) => `font_${i}.png`),
		info: {
			size: msdfOptions.size,
			face: "font"
		},
		common: {
			lineHeight: round(metrics.lineHeight),
			base: round(metrics.ascenderY)
		},
		distanceField: {
			distanceRange: msdfOptions.range
		},
		chars,
		kernings
	}

	fs.writeFileSync("font.json", JSON.stringify(bmFontJson))
	images.forEach((x, i) => fs.writeFileSync(`font_${i}.png`, x))
}

run().catch(e => console.error(e))
```

# Building wasm module

module is pre-build in the npm package, but if you want to build it yourself make sure emsdk is installed and run `npm run compile`, no other dependencies are needed.