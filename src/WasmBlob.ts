import WasmModule from "./WasmModule"

export class WasmBlob {
	private _module: WasmModule
	private _ptr: number
	private _counter: number
	private _data: Uint8Array

	constructor(module: WasmModule, data: Uint8Array, counter = 1) {
		this._data = data
		this._module = module
		this._counter = counter
		this._ptr = module._malloc(data.length)
		module.HEAPU8.set(data, this._ptr)
	}

	public acquire() {
		this._counter += 1
		return this._ptr
	}

	public release() {
		this._counter -= 1
		if (this._counter <= 0 && this._ptr != 0) {
			this._module._free(this._ptr)
			this._ptr = 0
		}
	}

	public get ptr() {
		return this._ptr
	}

	public get size() {
		return this._data.length
	}

	public get data() {
		return this._data
	}
}

export default WasmBlob
