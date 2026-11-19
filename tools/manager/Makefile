CXX ?= g++
CXXFLAGS = -std=c++20 -O3 -Wall -Wextra -fvisibility=hidden -fdata-sections -ffunction-sections -Iinclude
LDFLAGS = -Wl,--gc-sections -s

# Android NDK Toolchain Configuration
NDK ?= $(HOME)/envs/android-ndk-r29
NDK_BIN = $(NDK)/toolchains/llvm/prebuilt/linux-x86_64/bin
NDK_ARM_CXX = $(NDK_BIN)/armv7a-linux-androideabi21-clang++
NDK_STRIP = $(NDK_BIN)/llvm-strip

TARGET = ../../bin/multiai-mgr
TARGET_ARMHF = ../../bin/multiai-mgr-armhf
TARGET_ARMHF_STATIC = ../../bin/multiai-mgr-armhf-static
SRC = main.cpp
HEADERS = obfuscation.hpp client.hpp tui.hpp

all: $(TARGET)

$(TARGET): $(SRC) $(HEADERS)
	@mkdir -p ../../bin
	$(CXX) $(CXXFLAGS) $(SRC) -o $(TARGET) $(LDFLAGS)
	@strip -s --strip-all $(TARGET) 2>/dev/null || true
	@echo "Host build complete: $(TARGET)"

armhf: $(TARGET_ARMHF)

$(TARGET_ARMHF): $(SRC) $(HEADERS)
	@mkdir -p ../../bin
	$(NDK_ARM_CXX) -std=c++20 -O3 -Wall -Wextra -static-libstdc++ -fvisibility=hidden -fdata-sections -ffunction-sections -Iinclude $(SRC) -o $(TARGET_ARMHF) -Wl,--gc-sections -s
	@echo "NDK ARMHF PIE build complete: $(TARGET_ARMHF)"

armhf-static: $(TARGET_ARMHF_STATIC)

$(TARGET_ARMHF_STATIC): $(SRC) $(HEADERS)
	@mkdir -p ../../bin
	$(NDK_ARM_CXX) -std=c++20 -O3 -Wall -Wextra -static -fvisibility=hidden -fdata-sections -ffunction-sections -Iinclude $(SRC) -o $(TARGET_ARMHF_STATIC) -Wl,--gc-sections -s
	@echo "NDK ARMHF Static build complete: $(TARGET_ARMHF_STATIC)"

both: all armhf armhf-static

clean:
	rm -f $(TARGET) $(TARGET_ARMHF) $(TARGET_ARMHF_STATIC)

.PHONY: all armhf armhf-static both clean
