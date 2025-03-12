export class Bitmap {
	readonly width: number
	readonly height: number
	readonly data: Uint32Array

	constructor(width: number, height: number, data?: ArrayBuffer) {
		this.width = width
		this.height = height
		if (data) {
			this.data = new Uint32Array(data)
		} else {
			this.data = new Uint32Array(width * height)
		}
	}

	blit(source: Bitmap, dx: number, dy: number, rotated: boolean) {
		const src = source.data
		const dst = this.data
		const sw = source.width
		const sh = source.height
		if (rotated) {
			for (let y = 0; y < sw; y += 1) {
				let srcPos = y
				let dstPos = (y + dy) * this.width + dx + sh
				for (let x = 0; x < sh; x += 1) {
					dstPos -= 1
					dst[dstPos] = src[srcPos]
					srcPos += sw
				}
			}
		} else {
			for (let y = 0; y < sh; y += 1) {
				let srcPos = y * sw
				let dstPos = (y + dy) * this.width + dx
				for (let x = 0; x < sw; x += 1) {
					dst[dstPos] = src[srcPos]
					srcPos += 1
					dstPos += 1
				}
			}
		}
	}

	public get buffer() {
		return this.data.buffer
	}
}
