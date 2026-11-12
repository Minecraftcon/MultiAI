#pragma once
#include <string>
#include <vector>
#include <map>
#include <fstream>
#include <sstream>
#include <iostream>
#include <curl/curl.h>
#include <boost/json.hpp>
#include "obfuscation.hpp"

namespace json = boost::json;

struct ChatSummary {
    std::string id;
    std::string title;
    std::string type;
    std::string date_folder;
    std::string updated_at;
    int message_count = 0;
};

struct ChatMessage {
    std::string role;
    std::string content;
    std::string model;
    std::string timestamp;
};

struct ChatDetail {
    std::string id;
    std::string title;
    std::string type;
    std::string date_folder;
    std::string updated_at;
    std::vector<ChatMessage> messages;
    std::string raw_json;
};

class MultiAIClient {
private:
    std::string baseUrl;
    std::string password;
    std::string sessionCookie;
    std::string repoRoot;

    static size_t writeCallback(void* contents, size_t size, size_t nmemb, void* userp) {
        size_t total = size * nmemb;
        std::string* s = static_cast<std::string*>(userp);
        s->append(static_cast<char*>(contents), total);
        return total;
    }

    static size_t headerCallback(char* buffer, size_t size, size_t nitems, void* userdata) {
        size_t total = size * nitems;
        std::string header(buffer, total);
        std::string* cookieJar = static_cast<std::string*>(userdata);
        if (header.find("Set-Cookie:") == 0 || header.find("set-cookie:") == 0) {
            size_t start = header.find("multiai_session=");
            if (start != std::string::npos) {
                size_t end = header.find(";", start);
                if (end != std::string::npos) {
                    *cookieJar = header.substr(start, end - start);
                } else {
                    *cookieJar = header.substr(start);
                    while (!cookieJar->empty() && ((*cookieJar)[cookieJar->size() - 1] == '\r' || (*cookieJar)[cookieJar->size() - 1] == '\n')) {
                        cookieJar->pop_back();
                    }
                }
            }
        }
        return total;
    }

public:
    MultiAIClient(const std::string& root = ".")
        : baseUrl(DEMANGLE(Secrets::DEFAULT_CLOUD_URL)),
          password(DEMANGLE(Secrets::DEFAULT_PASSWORD)),
          repoRoot(root) {}

    void setBaseUrl(const std::string& url) { baseUrl = url; }
    std::string getBaseUrl() const { return baseUrl; }

    void setPassword(const std::string& pass) { password = pass; }
    std::string getPassword() const { return password; }

    bool authenticate(std::string& errMsg) {
        CURL* curl = curl_easy_init();
        if (!curl) { errMsg = "Failed to initialize curl"; return false; }

        // 1. Fetch challenge ID
        std::string captchaUrl = baseUrl + DEMANGLE(Secrets::ENDPOINT_CAPTCHA);
        std::string captchaResponse;

        curl_easy_setopt(curl, CURLOPT_URL, captchaUrl.c_str());
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &captchaResponse);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 10L);
        curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0L);

        CURLcode res = curl_easy_perform(curl);
        std::string captchaId = "";
        if (res == CURLE_OK) {
            try {
                auto val = json::parse(captchaResponse);
                if (val.is_object() && val.as_object().contains("id")) {
                    captchaId = val.as_object()["id"].as_string().c_str();
                }
            } catch (...) {}
        }

        // 2. Perform Login POST
        std::string loginUrl = baseUrl + DEMANGLE(Secrets::ENDPOINT_LOGIN);
        std::string loginResponse;
        json::object loginBody;
        loginBody["password"] = password;
        loginBody["captchaId"] = captchaId;
        loginBody["captchaAnswer"] = "BYPASS"; // Admin bypass or will test with server

        std::string reqBody = json::serialize(loginBody);

        struct curl_slist* headers = NULL;
        headers = curl_slist_append(headers, "Content-Type: application/json");

        curl_easy_reset(curl);
        curl_easy_setopt(curl, CURLOPT_URL, loginUrl.c_str());
        curl_easy_setopt(curl, CURLOPT_POST, 1L);
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, reqBody.c_str());
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &loginResponse);
        curl_easy_setopt(curl, CURLOPT_HEADERFUNCTION, headerCallback);
        curl_easy_setopt(curl, CURLOPT_HEADERDATA, &sessionCookie);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 10L);
        curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0L);

        res = curl_easy_perform(curl);
        long httpCode = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);

        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);

        if (res != CURLE_OK) {
            errMsg = curl_easy_strerror(res);
            return false;
        }

        if (httpCode == 200 || !sessionCookie.empty()) {
            return true;
        }

        // If locked or captcha required, format message
        try {
            auto val = json::parse(loginResponse);
            if (val.is_object() && val.as_object().contains("error")) {
                errMsg = val.as_object()["error"].as_string().c_str();
            } else {
                errMsg = "HTTP Status " + std::to_string(httpCode);
            }
        } catch (...) {
            errMsg = "Authentication failed (Status " + std::to_string(httpCode) + ")";
        }
        return false;
    }

    std::vector<ChatSummary> listChats(std::string& errMsg) {
        std::vector<ChatSummary> list;
        CURL* curl = curl_easy_init();
        if (!curl) { errMsg = "Failed to initialize curl"; return list; }

        std::string url = baseUrl + DEMANGLE(Secrets::ENDPOINT_CHATS);
        std::string response;

        struct curl_slist* headers = NULL;
        if (!sessionCookie.empty()) {
            std::string cHeader = "Cookie: " + sessionCookie;
            headers = curl_slist_append(headers, cHeader.c_str());
        }

        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 12L);
        curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0L);

        CURLcode res = curl_easy_perform(curl);
        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);

        if (res != CURLE_OK) {
            errMsg = curl_easy_strerror(res);
            return list;
        }

        try {
            auto val = json::parse(response);
            if (val.is_object() && val.as_object().contains("chats")) {
                auto& arr = val.as_object()["chats"].as_array();
                for (auto& item : arr) {
                    if (item.is_object()) {
                        auto& obj = item.as_object();
                        ChatSummary s;
                        if (obj.contains("id")) s.id = obj["id"].as_string().c_str();
                        if (obj.contains("title")) s.title = obj["title"].as_string().c_str();
                        if (obj.contains("type")) s.type = obj["type"].as_string().c_str();
                        if (obj.contains("date_folder")) s.date_folder = obj["date_folder"].as_string().c_str();
                        if (obj.contains("updated_at")) s.updated_at = obj["updated_at"].as_string().c_str();
                        list.push_back(s);
                    }
                }
            }
        } catch (const std::exception& e) {
            errMsg = std::string("JSON parse error: ") + e.what();
        }
        return list;
    }

    bool getChat(const std::string& id, ChatDetail& detail, std::string& errMsg) {
        CURL* curl = curl_easy_init();
        if (!curl) { errMsg = "Failed to initialize curl"; return false; }

        std::string url = baseUrl + DEMANGLE(Secrets::ENDPOINT_CHATS) + "/" + id;
        std::string response;

        struct curl_slist* headers = NULL;
        if (!sessionCookie.empty()) {
            std::string cHeader = "Cookie: " + sessionCookie;
            headers = curl_slist_append(headers, cHeader.c_str());
        }

        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 15L);
        curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0L);

        CURLcode res = curl_easy_perform(curl);
        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);

        if (res != CURLE_OK) {
            errMsg = curl_easy_strerror(res);
            return false;
        }

        try {
            detail.raw_json = response;
            auto val = json::parse(response);
            if (val.is_object()) {
                auto& obj = val.as_object();
                detail.id = id;
                if (obj.contains("meta") && obj["meta"].is_object()) {
                    auto& m = obj["meta"].as_object();
                    if (m.contains("title")) detail.title = m["title"].as_string().c_str();
                }
                if (obj.contains("messages") && obj["messages"].is_array()) {
                    for (auto& mVal : obj["messages"].as_array()) {
                        if (mVal.is_object()) {
                            auto& mObj = mVal.as_object();
                            ChatMessage msg;
                            if (mObj.contains("role")) msg.role = mObj["role"].as_string().c_str();
                            if (mObj.contains("content")) {
                                if (mObj["content"].is_string()) {
                                    msg.content = mObj["content"].as_string().c_str();
                                } else {
                                    msg.content = json::serialize(mObj["content"]);
                                }
                            }
                            if (mObj.contains("model")) msg.model = mObj["model"].as_string().c_str();
                            if (mObj.contains("timestamp")) {
                                if (mObj["timestamp"].is_string()) msg.timestamp = mObj["timestamp"].as_string().c_str();
                                else if (mObj["timestamp"].is_int64()) msg.timestamp = std::to_string(mObj["timestamp"].as_int64());
                            }
                            detail.messages.push_back(msg);
                        }
                    }
                }
                return true;
            }
        } catch (const std::exception& e) {
            errMsg = e.what();
        }
        return false;
    }

    bool saveChatRaw(const std::string& rawJson, std::string& errMsg) {
        CURL* curl = curl_easy_init();
        if (!curl) { errMsg = "Failed to initialize curl"; return false; }

        std::string url = baseUrl + DEMANGLE(Secrets::ENDPOINT_CHATS_SAVE);
        std::string response;

        struct curl_slist* headers = NULL;
        headers = curl_slist_append(headers, "Content-Type: application/json");
        if (!sessionCookie.empty()) {
            std::string cHeader = "Cookie: " + sessionCookie;
            headers = curl_slist_append(headers, cHeader.c_str());
        }

        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_POST, 1L);
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, rawJson.c_str());
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 15L);
        curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0L);

        CURLcode res = curl_easy_perform(curl);
        long code = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &code);

        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);

        if (res != CURLE_OK) { errMsg = curl_easy_strerror(res); return false; }
        return (code == 200);
    }

    bool deleteChat(const std::string& id, std::string& errMsg) {
        CURL* curl = curl_easy_init();
        if (!curl) { errMsg = "Failed to initialize curl"; return false; }

        std::string url = baseUrl + DEMANGLE(Secrets::ENDPOINT_CHATS) + "/" + id;
        std::string response;

        struct curl_slist* headers = NULL;
        if (!sessionCookie.empty()) {
            std::string cHeader = "Cookie: " + sessionCookie;
            headers = curl_slist_append(headers, cHeader.c_str());
        }

        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "DELETE");
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 15L);
        curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0L);

        CURLcode res = curl_easy_perform(curl);
        long code = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &code);

        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);

        if (res != CURLE_OK) { errMsg = curl_easy_strerror(res); return false; }
        return (code == 200);
    }

    // Local Keys & Password Management (.env file)
    std::map<std::string, std::string> loadLocalEnv() {
        std::map<std::string, std::string> envMap;
        std::string envPath = repoRoot + "/" + DEMANGLE(Secrets::ENV_FILE);
        std::ifstream file(envPath);
        if (!file.is_open()) return envMap;

        std::string line;
        while (std::getline(file, line)) {
            size_t eq = line.find('=');
            if (eq != std::string::npos && line[0] != '#') {
                std::string k = line.substr(0, eq);
                std::string v = line.substr(eq + 1);
                // trim whitespace
                while (!k.empty() && isspace(k.back())) k.pop_back();
                while (!k.empty() && isspace(k.front())) k.erase(0, 1);
                while (!v.empty() && isspace(v.back())) v.pop_back();
                while (!v.empty() && isspace(v.front())) v.erase(0, 1);
                if (!k.empty()) envMap[k] = v;
            }
        }
        return envMap;
    }

    bool saveLocalEnv(const std::map<std::string, std::string>& envMap, std::string& errMsg) {
        std::string envPath = repoRoot + "/" + DEMANGLE(Secrets::ENV_FILE);
        std::ofstream file(envPath);
        if (!file.is_open()) { errMsg = "Cannot write to " + envPath; return false; }

        file << "# MultiAI Master Environment & API Key Registry\n";
        for (const auto& [k, v] : envMap) {
            file << k << "=" << v << "\n";
        }
        return true;
    }
};
