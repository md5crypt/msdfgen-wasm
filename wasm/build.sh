#!/bin/bash

cd "$(dirname "${BASH_SOURCE[0]}")"

set -e

if ! command -v emcc &> /dev/null; then
	if test -f ~/emsdk/emsdk_env.sh; then
		source ~/emsdk/emsdk_env.sh
	else
		echo "emsdk not found, run \"source ~/emsdk_env.sh\""
		exit 1
	fi
fi

set -x

mkdir -p build
cd build

if ! test -d zlib; then
	git clone git@github.com:madler/zlib.git --branch v1.2.13
	cd zlib

	emconfigure ./configure --static --prefix=/
	emmake make -j$(nproc)
	mkdir build
	make DESTDIR=./build install

	cd ..
fi

if ! test -d libpng; then
	git clone git@github.com:glennrp/libpng.git --branch v1.6.39
	cd libpng

	emcmake cmake \
		-DCMAKE_INSTALL_PREFIX=/ \
		-DCMAKE_INSTALL_LIBDIR=/lib \
		-DCMAKE_INSTALL_INCLUDEDIR=/include \
		-DPNG_STATIC=1 \
		-DPNG_SHARED=0 \
		-DCMAKE_FIND_ROOT_PATH="`realpath ../zlib/build`" \
		-DCMAKE_LIBRARY_PATH="`realpath ../zlib/build/lib`" \
		-DCMAKE_INCLUDE_PATH="`realpath ../zlib/build/include`"
	emmake make -j$(nproc)
	mkdir build
	make DESTDIR=./build install
	cd ..
fi

if ! test -d freetype; then
	git clone https://gitlab.freedesktop.org/freetype/freetype.git --branch VER-2-13-3
	cd freetype
	mkdir tmp
	mkdir build
	cd tmp
	emcmake cmake .. \
		-DCMAKE_INSTALL_PREFIX=/ \
		-DCMAKE_INSTALL_LIBDIR=/lib \
		-DCMAKE_INSTALL_INCLUDEDIR=/include \
		-DCMAKE_FIND_ROOT_PATH="`realpath ../../zlib/build`" \
		-DCMAKE_LIBRARY_PATH="`realpath ../../zlib/build/lib`" \
		-DCMAKE_INCLUDE_PATH="`realpath ../../zlib/build/include`"
	emmake make -j$(nproc)
	make DESTDIR=../build install
	cd ..
	cd ..
fi

if ! test -d skia; then
	mkdir skia
	cd skia
	mkdir -p lib/skia
	cp ../../skia-config.cmake lib/skia/skia-config.cmake
	curl -L "https://github.com/olilarkin/skia-builder/releases/download/chrome%2Fm133/skia-build-wasm.zip" -o skia-build-wasm.zip
	unzip -j skia-build-wasm.zip build/wasm/lib/Release/libskia.a -d lib
	mkdir include
	unzip skia-build-wasm.zip "build/include/include/*" -d tmp
	mv tmp/build/include/include .
	rm -rf tmp
	cd include
	ln -s . skia
	cd ..
	rm skia-build-wasm.zip
	cd ..
fi

if ! test -d msdfgen; then
	git clone https://github.com/Chlumsky/msdfgen.git --branch v1.12
	cd msdfgen
	emcmake cmake . \
		-DCMAKE_INSTALL_PREFIX=/ \
		-DCMAKE_INSTALL_LIBDIR=/lib \
		-DCMAKE_INSTALL_INCLUDEDIR=/include \
		-DMSDFGEN_DISABLE_SVG=1 \
		-DMSDFGEN_DISABLE_PNG=1 \
		-DMSDFGEN_USE_SKIA=1 \
		-DMSDFGEN_USE_VCPKG=0 \
		-DMSDFGEN_BUILD_STANDALONE=0 \
		-DMSDFGEN_INSTALL=1 \
		-DCMAKE_FIND_ROOT_PATH="`realpath ../freetype/build`;`realpath ../skia`"
	emmake make -j$(nproc)
	mkdir build
	make DESTDIR=./build install
	cd ..
fi

emcc \
	-O2 \
	-s ALLOW_MEMORY_GROWTH=1 \
	-s MODULARIZE=1 \
	-s INVOKE_RUN=0 \
	-s FILESYSTEM=0 \
	-s EXPORT_ES6=1 \
	-s MINIMAL_RUNTIME=1 \
	-s USE_ES6_IMPORT_META=0 \
	-s EXPORT_ALL=1 \
	-s POLYFILL=0 \
	-s ENVIRONMENT=web \
	-s EXPORT_NAME=wasmModuleFactory \
	-s EXPORTED_FUNCTIONS="[ \
		_loadFont, _getFontMetrics, _getFontWhitespaceWidth, _getGlyphIndex, _getNextKerning, \
		_loadGlyph, _destroyGlyph, _generateMSDF, _getBitmapPixels, _destroyBitmap, \
		_pngEncoder_convertRaw, \
		_malloc, _free \
	]" \
	-I ./freetype/build/include/freetype2 \
	-I ./msdfgen/build/include/msdfgen \
	-I ./libpng/build/include \
	-o ./wasmModuleFactory.js \
	../main.cpp \
	../pngEncoder.c \
	./msdfgen/build/lib/libmsdfgen-core.a \
	./msdfgen/build/lib/libmsdfgen-ext.a \
	./freetype/build/lib/libfreetype.a \
	./skia/lib/libskia.a \
	./libpng/build/lib/libpng.a \
	./zlib/build/lib/libz.a

mv -f wasmModuleFactory.js ../../src/wasmModuleFactory.js
mv -f wasmModuleFactory.wasm ../msdfgen.wasm

echo "done"
