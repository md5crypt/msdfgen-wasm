import WasmModule from "./WasmModule"
export default function wasmModuleFactory(options: {wasm: ArrayBufferLike}): Promise<WasmModule>
