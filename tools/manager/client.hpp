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
    bool directSupabaseMode = false;

    static size_t writeCallback(void* contents, size_t size, size_t nmemb, void* userp) {
        size_t total = size * nmemb;
        std::string* s = static_cast<std::string*>(userp);
        s->append(static_cast<char*>(contents), total);
        return total;
    }

    struct curl_slist* buildAuthHeaders(bool isJson = true) {
        struct curl_slist* headers = NULL;
        if (isJson) {
            headers = curl_slist_append(headers, "Content-Type: application/json");
        }

        if (directSupabaseMode) {
            std::string sbKey = DEMANGLE(Secrets::SUPABASE_ANON_KEY);
            headers = curl_slist_append(headers, ("apikey: " + sbKey).c_str());
            headers = curl_slist_append(headers, ("Authorization: Bearer " + sbKey).c_str());
        } else {
            // Server API fast-path admin authentication
            std::string bearer = "Authorization: Bearer " + password;
            headers = curl_slist_append(headers, bearer.c_str());
            std::string admKey = "X-Admin-Key: " + password;
            headers = curl_slist_append(headers, admKey.c_str());

            if (!sessionCookie.empty()) {
                std::string cHeader = "Cookie: " + sessionCookie;
                headers = curl_slist_append(headers, cHeader.c_str());
            }
        }
        return headers;
    }

public:
    MultiAIClient(const std::string& root = ".")
        : baseUrl(DEMANGLE(Secrets::DEFAULT_CLOUD_URL)),
          password(DEMANGLE(Secrets::DEFAULT_PASSWORD)),
          repoRoot(root) {
        // Check if local .env has updated password
        auto env = loadLocalEnv();
        if (env.count("CLOUD_PASSWORD") && !env["CLOUD_PASSWORD"].empty()) {
            password = env["CLOUD_PASSWORD"];
        }
    }

    void setBaseUrl(const std::string& url) { baseUrl = url; }
    std::string getBaseUrl() const { return directSupabaseMode ? "(Direct Supabase Postgres REST)" : baseUrl; }

    void setDirectSupabaseMode(bool enable) { directSupabaseMode = enable; }
    bool isDirectSupabaseMode() const { return directSupabaseMode; }

    void setPassword(const std::string& pass) { password = pass; }
    std::string getPassword() const { return password; }

    bool ping(std::string& info) {
        std::string err;
        auto chats = listChats(err);
        if (!err.empty()) {
            info = err;
            return false;
        }
        info = "OK (" + std::to_string(chats.size()) + " conversations found)";
        return true;
    }

    std::vector<ChatSummary> listChats(std::string& errMsg) {
        std::vector<ChatSummary> list;
        CURL* curl = curl_easy_init();
        if (!curl) { errMsg = "Failed to initialize curl"; return list; }

        std::string url;
        if (directSupabaseMode) {
            url = DEMANGLE(Secrets::SUPABASE_REST_URL) + "/chats?select=*&order=updated_at.desc";
        } else {
            url = baseUrl + DEMANGLE(Secrets::ENDPOINT_CHATS);
        }

        std::string response;
        struct curl_slist* headers = buildAuthHeaders(false);

        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 12L);
        curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0L);

        CURLcode res = curl_easy_perform(curl);
        long httpCode = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);
        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);

        if (res != CURLE_OK) {
            errMsg = curl_easy_strerror(res);
            // Fallback: try direct Supabase if server network fails
            if (!directSupabaseMode) {
                directSupabaseMode = true;
                list = listChats(errMsg);
                if (!list.empty()) return list;
                directSupabaseMode = false;
            }
            return list;
        }

        if (httpCode >= 400) {
            errMsg = "HTTP " + std::to_string(httpCode) + ": " + response;
            // Fallback: try direct Supabase
            if (!directSupabaseMode) {
                directSupabaseMode = true;
                list = listChats(errMsg);
                if (!list.empty()) return list;
                directSupabaseMode = false;
            }
            return list;
        }

        try {
            auto val = json::parse(response);
            if (val.is_array()) {
                // Direct Supabase array response
                for (auto& item : val.as_array()) {
                    if (item.is_object()) {
                        auto& obj = item.as_object();
                        ChatSummary s;
                        if (obj.contains("id") && obj["id"].is_string()) s.id = obj["id"].as_string().c_str();
                        if (obj.contains("title") && obj["title"].is_string()) s.title = obj["title"].as_string().c_str();
                        if (obj.contains("type") && obj["type"].is_string()) s.type = obj["type"].as_string().c_str();
                        if (obj.contains("date_folder") && obj["date_folder"].is_string()) s.date_folder = obj["date_folder"].as_string().c_str();
                        if (obj.contains("updated_at") && obj["updated_at"].is_string()) s.updated_at = obj["updated_at"].as_string().c_str();
                        list.push_back(s);
                    }
                }
            } else if (val.is_object() && val.as_object().contains("chats")) {
                // Server API wrapper response
                auto& arr = val.as_object()["chats"].as_array();
                for (auto& item : arr) {
                    if (item.is_object()) {
                        auto& obj = item.as_object();
                        ChatSummary s;
                        if (obj.contains("id") && obj["id"].is_string()) s.id = obj["id"].as_string().c_str();
                        if (obj.contains("title") && obj["title"].is_string()) s.title = obj["title"].as_string().c_str();
                        if (obj.contains("type") && obj["type"].is_string()) s.type = obj["type"].as_string().c_str();

                        if (obj.contains("date_folder") && obj["date_folder"].is_string()) s.date_folder = obj["date_folder"].as_string().c_str();
                        else if (obj.contains("date") && obj["date"].is_string()) s.date_folder = obj["date"].as_string().c_str();

                        if (obj.contains("updated_at") && obj["updated_at"].is_string()) s.updated_at = obj["updated_at"].as_string().c_str();
                        else if (obj.contains("updatedAt") && obj["updatedAt"].is_string()) s.updated_at = obj["updatedAt"].as_string().c_str();

                        if (obj.contains("message_count") && obj["message_count"].is_int64()) s.message_count = (int)obj["message_count"].as_int64();
                        else if (obj.contains("messageCount") && obj["messageCount"].is_int64()) s.message_count = (int)obj["messageCount"].as_int64();

                        list.push_back(s);
                    }
                }
            }
        } catch (const std::exception& e) {
            errMsg = std::string("JSON parse error: ") + e.what();
        }
        return list;
    }

    static std::string formatJson(const json::value& jv, const std::string& indent = "") {
        switch (jv.kind()) {
            case json::kind::object: {
                auto const& obj = jv.get_object();
                if (obj.empty()) return "{}";
                std::string out = "{\n";
                size_t i = 0;
                for (auto const& item : obj) {
                    out += indent + "  \"" + std::string(item.key()) + "\": " + formatJson(item.value(), indent + "  ");
                    if (++i < obj.size()) out += ",";
                    out += "\n";
                }
                out += indent + "}";
                return out;
            }
            case json::kind::array: {
                auto const& arr = jv.get_array();
                if (arr.empty()) return "[]";
                std::string out = "[\n";
                for (size_t i = 0; i < arr.size(); ++i) {
                    out += indent + "  " + formatJson(arr[i], indent + "  ");
                    if (i + 1 < arr.size()) out += ",";
                    out += "\n";
                }
                out += indent + "]";
                return out;
            }
            default:
                return json::serialize(jv);
        }
    }

    bool getChat(const std::string& id, ChatDetail& detail, std::string& errMsg) {
        CURL* curl = curl_easy_init();
        if (!curl) { errMsg = "Failed to initialize curl"; return false; }

        if (directSupabaseMode) {
            // 1. Get chat row
            std::string cUrl = DEMANGLE(Secrets::SUPABASE_REST_URL) + "/chats?id=eq." + id + "&select=*";
            std::string cResp;
            struct curl_slist* h = buildAuthHeaders(false);

            curl_easy_setopt(curl, CURLOPT_URL, cUrl.c_str());
            curl_easy_setopt(curl, CURLOPT_HTTPHEADER, h);
            curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCallback);
            curl_easy_setopt(curl, CURLOPT_WRITEDATA, &cResp);
            curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0L);
            CURLcode res = curl_easy_perform(curl);

            // 2. Get messages
            std::string mUrl = DEMANGLE(Secrets::SUPABASE_REST_URL) + "/chat_messages?chat_id=eq." + id + "&select=*&order=id.asc";
            std::string mResp;
            curl_easy_setopt(curl, CURLOPT_URL, mUrl.c_str());
            curl_easy_setopt(curl, CURLOPT_WRITEDATA, &mResp);
            res = curl_easy_perform(curl);
            curl_slist_free_all(h);
            curl_easy_cleanup(curl);

            if (res != CURLE_OK) { errMsg = curl_easy_strerror(res); return false; }

            detail.id = id;
            try {
                auto mVal = json::parse(mResp);
                detail.raw_json = formatJson(mVal);
                if (mVal.is_array()) {
                    for (auto& item : mVal.as_array()) {
                        if (item.is_object()) {
                            auto& obj = item.as_object();
                            ChatMessage msg;
                            if (obj.contains("role") && obj["role"].is_string()) msg.role = obj["role"].as_string().c_str();
                            if (obj.contains("content")) {
                                if (obj["content"].is_string()) msg.content = obj["content"].as_string().c_str();
                                else msg.content = json::serialize(obj["content"]);
                            }
                            if (obj.contains("created_at") && obj["created_at"].is_string()) msg.timestamp = obj["created_at"].as_string().c_str();
                            detail.messages.push_back(msg);
                        }
                    }
                }
                return true;
            } catch (const std::exception& e) {
                detail.raw_json = mResp;
                errMsg = e.what();
                return false;
            }
        }

        // Server API route
        std::string url = baseUrl + DEMANGLE(Secrets::ENDPOINT_CHATS) + "/" + id;
        std::string response;
        struct curl_slist* headers = buildAuthHeaders(false);

        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
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

        if (res != CURLE_OK || code >= 400) {
            errMsg = (res != CURLE_OK) ? curl_easy_strerror(res) : ("HTTP " + std::to_string(code) + ": " + response);
            return false;
        }

        try {
            auto val = json::parse(response);
            if (val.is_object()) {
                auto& rootObj = val.as_object();
                auto* objPtr = &rootObj;
                if (rootObj.contains("session") && rootObj["session"].is_object()) {
                    objPtr = &rootObj["session"].as_object();
                }
                detail.raw_json = formatJson(*objPtr);
                auto& obj = *objPtr;
                detail.id = id;
                if (obj.contains("title") && obj["title"].is_string()) detail.title = obj["title"].as_string().c_str();
                if (obj.contains("type") && obj["type"].is_string()) detail.type = obj["type"].as_string().c_str();
                if (obj.contains("date") && obj["date"].is_string()) detail.date_folder = obj["date"].as_string().c_str();

                if (obj.contains("meta") && obj["meta"].is_object()) {
                    auto& m = obj["meta"].as_object();
                    if (detail.title.empty() && m.contains("title") && m["title"].is_string()) {
                        detail.title = m["title"].as_string().c_str();
                    }
                    if (m.contains("updatedAt") && m["updatedAt"].is_string()) detail.updated_at = m["updatedAt"].as_string().c_str();
                }
                if (obj.contains("messages") && obj["messages"].is_array()) {
                    for (auto& mVal : obj["messages"].as_array()) {
                        if (mVal.is_object()) {
                            auto& mObj = mVal.as_object();
                            ChatMessage msg;
                            if (mObj.contains("role") && mObj["role"].is_string()) msg.role = mObj["role"].as_string().c_str();
                            if (mObj.contains("content")) {
                                if (mObj["content"].is_string()) msg.content = mObj["content"].as_string().c_str();
                                else msg.content = json::serialize(mObj["content"]);
                            }
                            if (mObj.contains("model") && mObj["model"].is_string()) msg.model = mObj["model"].as_string().c_str();
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
            detail.raw_json = response;
            errMsg = e.what();
        }
        return false;
    }

    bool saveChatRaw(const std::string& rawJson, std::string& errMsg) {
        CURL* curl = curl_easy_init();
        if (!curl) { errMsg = "Failed to initialize curl"; return false; }

        std::string payload = rawJson;
        try {
            auto val = json::parse(rawJson);
            if (val.is_object() && val.as_object().contains("session") && val.as_object()["session"].is_object()) {
                payload = json::serialize(val.as_object()["session"]);
            }
        } catch (...) {}

        std::string url = baseUrl + DEMANGLE(Secrets::ENDPOINT_CHATS_SAVE);
        std::string response;
        struct curl_slist* headers = buildAuthHeaders(true);

        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_POST, 1L);
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, payload.c_str());
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

        std::string url;
        if (directSupabaseMode) {
            url = DEMANGLE(Secrets::SUPABASE_REST_URL) + "/chats?id=eq." + id;
        } else {
            url = baseUrl + DEMANGLE(Secrets::ENDPOINT_CHATS) + "/" + id;
        }

        std::string response;
        struct curl_slist* headers = buildAuthHeaders(false);

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
        return (code == 200 || code == 204);
    }

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
