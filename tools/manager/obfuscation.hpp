#pragma once
#include <array>
#include <cstdint>
#include <string>
#include <utility>

/**
 * Compile-time String Obfuscator
 * ------------------------------
 * Converts plaintext string literals into non-linear bit-rotated and poly-XORed byte arrays
 * at compile time. Uses an inline assembly optimization barrier (`asm volatile`) so the C++
 * compiler never constant-folds the decrypted string into the binary's .rodata ELF section.
 * Running `strings` on the compiled binary yields ZERO credentials, endpoints, or tokens.
 */
template <size_t N>
struct Obfuscated {
    std::array<uint8_t, N> data{};

    template <size_t... Is>
    constexpr Obfuscated(const char (&str)[N], uint8_t seed, std::index_sequence<Is...>)
        : data{ static_cast<uint8_t>(
            (((static_cast<uint8_t>(str[Is]) << 3) | (static_cast<uint8_t>(str[Is]) >> 5)) ^
            static_cast<uint8_t>(seed ^ (Is * 0x31) ^ 0x9D))
        )... } {}

    constexpr Obfuscated(const char (&str)[N], uint8_t seed = 0x6B)
        : Obfuscated(str, seed, std::make_index_sequence<N>{}) {}
};

template <size_t N>
__attribute__((noinline)) std::string demangle(const Obfuscated<N>& obf, uint8_t seed = 0x6B) {
    char plaintext[N];
    for (size_t i = 0; i < N; ++i) {
        uint8_t b = obf.data[i];
        // Optimization barrier: prevents GCC/Clang from evaluating decryption at compile time
        asm volatile("" : "+r"(b));
        b ^= static_cast<uint8_t>(seed ^ (i * 0x31) ^ 0x9D);
        b = static_cast<uint8_t>((b >> 3) | (b << 5));
        plaintext[i] = static_cast<char>(b);
    }
    std::string res(plaintext, N - 1);
    
    // Stack-wipe ephemeral buffer
    volatile char* p = plaintext;
    for (size_t i = 0; i < N; ++i) p[i] = 0;
    return res;
}

#define MANGLE_DEF(name, str) constexpr static auto name = Obfuscated<sizeof(str)>(str)
#define DEMANGLE(name) demangle(name)

namespace Secrets {
    MANGLE_DEF(DEFAULT_CLOUD_URL, "https://multiai-cloud.onrender.com");
    MANGLE_DEF(DEFAULT_LOCAL_URL, "http://127.0.0.1:8080");
    MANGLE_DEF(DEFAULT_PASSWORD, "sr.strong.man");
    MANGLE_DEF(ENDPOINT_CAPTCHA, "/api/auth/captcha");
    MANGLE_DEF(ENDPOINT_LOGIN, "/api/auth/login");
    MANGLE_DEF(ENDPOINT_CHATS, "/api/chats");
    MANGLE_DEF(ENDPOINT_CHATS_SAVE, "/api/chats/save");
    MANGLE_DEF(RENDER_WORKSPACE_ID, "tea-d83blarrjlhs73ecn3ig");
    MANGLE_DEF(RENDER_SERVICE_ID, "srv-dbqt0ietlv9c73c7okl0");
    MANGLE_DEF(ENV_FILE, ".env");
    MANGLE_DEF(CONFIG_FILE, "config.ini");
    MANGLE_DEF(MODELS_FILE, "models.yaml");
}
