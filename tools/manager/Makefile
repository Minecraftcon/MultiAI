CXX = g++
CXXFLAGS = -std=c++20 -O3 -Wall -Wextra -fvisibility=hidden -fdata-sections -ffunction-sections
LDFLAGS = -Wl,--gc-sections -s -lcurl -lboost_json

TARGET = ../../bin/multiai-mgr
SRC = main.cpp

all: $(TARGET)

$(TARGET): $(SRC) obfuscation.hpp client.hpp tui.hpp
	@mkdir -p ../../bin
	$(CXX) $(CXXFLAGS) $(SRC) -o $(TARGET) $(LDFLAGS)
	@strip -s --strip-all $(TARGET) 2>/dev/null || true
	@echo "Build complete: $(TARGET)"

clean:
	rm -f $(TARGET)

.PHONY: all clean
