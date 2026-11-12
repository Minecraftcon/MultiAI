#pragma once
#include <string>
#include <vector>
#include <map>
#include <fstream>
#include <sstream>
#include <iostream>
#include <cstdlib>
#include <unistd.h>

#if defined(USE_LIBCURL) && !defined(__ANDROID__)
#include <curl/curl.h>
#endif

#include <nlohmann/json.hpp>
#include "obfuscation.hpp"

using json = nlohmann::json;

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

    struct HttpResponse {
        long code = 0;
        std::string body;
        std::string error;
    };

#if defined(USE_LIBCURL) && !defined(__ANDROID__)
    static size_t writeCallback(void* contents, size_t size, size_t nmemb, void* userp) {
        size_t total = size * nmemb;
        std::string* s = static_cast<std::string*>(userp);
        s->append(static_cast<char*>(contents), total);
        return total;
    }

    HttpResponse executeLibcurl(const std::string& method, const std::string& url, const std::vector<std::string>& headers, const std::string& body) {
        HttpResponse resp;
        CURL* curl = curl_easy_init();
        if (!curl) { resp.error = "Failed to initialize curl"; return resp; }

        struct curl_slist* hList = NULL;
        for (const auto& h : headers) {
            hList = curl_slist_append(hList, h.c_str());
        }

        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, hList);
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &resp.body);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 15L);
        curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0L);

        if (method == "POST") {
            curl_easy_setopt(curl, CURLOPT_POST, 1L);
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
        } else if (method == "DELETE") {
            curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "DELETE");
        }

        CURLcode res = curl_easy_perform(curl);
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &resp.code);
        curl_slist_free_all(hList);
        curl_easy_cleanup(curl);

        if (res != CURLE_OK) {
            resp.error = curl_easy_strerror(res);
        }
        return resp;
    }
#endif

    HttpResponse executeCurlCli(const std::string& method, const std::string& url, const std::vector<std::string>& headers, const std::string& body) {
        HttpResponse resp;
        std::string tempFile = "";
        if (!body.empty()) {
            char tpl[] = "/tmp/multiai_mgr_XXXXXX";
            int fd = mkstemp(tpl);
            if (fd < 0) {
                char tpl2[] = "/data/local/tmp/multiai_mgr_XXXXXX";
                fd = mkstemp(tpl2);
                if (fd >= 0) tempFile = tpl2;
            } else {
                tempFile = tpl;
            }
            if (fd >= 0) {
                ssize_t w = write(fd, body.data(), body.size());
                (void)w;
                close(fd);
            }
        }

        std::string cmd = "curl -s -k -w \"\\n%{http_code}\" -X " + method;
        for (const auto& h : headers) {
            cmd += " -H \"" + h + "\"";
        }
        if (!tempFile.empty()) {
            cmd += " --data-binary \"@" + tempFile + "\"";
        }
        cmd += " \"" + url + "\" 2>/dev/null";

        FILE* fp = popen(cmd.c_str(), "r");
        if (!tempFile.empty()) {
            unlink(tempFile.c_str());
        }
        if (!fp) {
            resp.error = "Failed to launch curl";
            return resp;
        }

        std::string output;
        char buf[4096];
        while (fgets(buf, sizeof(buf), fp)) {
            output += buf;
        }
        pclose(fp);

        size_t lastNl = output.find_last_of('\n');
        if (lastNl != std::string::npos) {
            std::string codeStr = output.substr(lastNl + 1);
            while (!codeStr.empty() && (codeStr.back() == '\r' || codeStr.back() == '\n' || codeStr.back() == ' ')) {
                codeStr.pop_back();
            }
            try {
                resp.code = std::stol(codeStr);
                resp.body = output.substr(0, lastNl);
            } catch (...) {
                resp.body = output;
            }
        } else {
            resp.body = output;
        }

        return resp;
    }

    std::vector<std::string> getAuthHeadersList(bool isJson = true) {
        std::vector<std::string> headers;
        if (isJson) {
            headers.push_back("Content-Type: application/json");
        }
        if (directSupabaseMode) {
            std::string sbKey = DEMANGLE(Secrets::SUPABASE_ANON_KEY);
            headers.push_back("apikey: " + sbKey);
            headers.push_back("Authorization: Bearer " + sbKey);
        } else {
            headers.push_back("Authorization: Bearer " + password);
            headers.push_back("X-Admin-Key: " + password);
            if (!sessionCookie.empty()) {
                headers.push_back("Cookie: " + sessionCookie);
            }
        }
        return headers;
    }

    HttpResponse performRequest(const std::string& method, const std::string& url, bool isJson = false, const std::string& body = "") {
        auto headers = getAuthHeadersList(isJson);
#if defined(USE_LIBCURL) && !defined(__ANDROID__)
        return executeLibcurl(method, url, headers, body);
#else
        return executeCurlCli(method, url, headers, body);
#endif
    }

public:
    MultiAIClient(const std::string& root = ".")
        : baseUrl(DEMANGLE(Secrets::DEFAULT_CLOUD_URL)),
          password(DEMANGLE(Secrets::DEFAULT_PASSWORD)),
          repoRoot(root) {
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
        std::string url = directSupabaseMode
            ? (DEMANGLE(Secrets::SUPABASE_REST_URL) + "/chats?select=*&order=updated_at.desc")
            : (baseUrl + DEMANGLE(Secrets::ENDPOINT_CHATS));

        HttpResponse resp = performRequest("GET", url, false);
        if (resp.code >= 400 || !resp.error.empty()) {
            errMsg = resp.error.empty() ? ("HTTP " + std::to_string(resp.code) + ": " + resp.body) : resp.error;
            if (!directSupabaseMode) {
                directSupabaseMode = true;
                list = listChats(errMsg);
                if (!list.empty()) return list;
                directSupabaseMode = false;
            }
            return list;
        }

        try {
            auto val = json::parse(resp.body);
            const json* arrPtr = nullptr;
            if (val.is_array()) {
                arrPtr = &val;
            } else if (val.is_object() && val.contains("chats") && val["chats"].is_array()) {
                arrPtr = &val["chats"];
            }

            if (arrPtr) {
                for (const auto& obj : *arrPtr) {
                    if (obj.is_object()) {
                        ChatSummary s;
                        if (obj.contains("id") && obj["id"].is_string()) s.id = obj["id"].get<std::string>();
                        if (obj.contains("title") && obj["title"].is_string()) s.title = obj["title"].get<std::string>();
                        if (obj.contains("type") && obj["type"].is_string()) s.type = obj["type"].get<std::string>();
                        if (obj.contains("date_folder") && obj["date_folder"].is_string()) s.date_folder = obj["date_folder"].get<std::string>();
                        else if (obj.contains("date") && obj["date"].is_string()) s.date_folder = obj["date"].get<std::string>();
                        if (obj.contains("updated_at") && obj["updated_at"].is_string()) s.updated_at = obj["updated_at"].get<std::string>();
                        else if (obj.contains("updatedAt") && obj["updatedAt"].is_string()) s.updated_at = obj["updatedAt"].get<std::string>();
                        if (obj.contains("message_count") && obj["message_count"].is_number()) s.message_count = obj["message_count"].get<int>();
                        else if (obj.contains("messageCount") && obj["messageCount"].is_number()) s.message_count = obj["messageCount"].get<int>();
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
        if (directSupabaseMode) {
            std::string cUrl = DEMANGLE(Secrets::SUPABASE_REST_URL) + "/chats?id=eq." + id + "&select=*";
            auto cResp = performRequest("GET", cUrl);
            std::string mUrl = DEMANGLE(Secrets::SUPABASE_REST_URL) + "/chat_messages?chat_id=eq." + id + "&select=*&order=id.asc";
            auto mResp = performRequest("GET", mUrl);
            if (mResp.code != 200) { errMsg = "HTTP " + std::to_string(mResp.code) + ": " + mResp.body; return false; }
            detail.id = id;
            try {
                auto mVal = json::parse(mResp.body);
                detail.raw_json = mVal.dump(2);
                if (mVal.is_array()) {
                    for (const auto& obj : mVal) {
                        if (obj.is_object()) {
                            ChatMessage msg;
                            if (obj.contains("role") && obj["role"].is_string()) msg.role = obj["role"].get<std::string>();
                            if (obj.contains("content")) {
                                if (obj["content"].is_string()) msg.content = obj["content"].get<std::string>();
                                else msg.content = obj["content"].dump();
                            }
                            if (obj.contains("created_at") && obj["created_at"].is_string()) msg.timestamp = obj["created_at"].get<std::string>();
                            detail.messages.push_back(msg);
                        }
                    }
                }
                return true;
            } catch (const std::exception& e) {
                detail.raw_json = mResp.body;
                errMsg = e.what();
                return false;
            }
        }

        std::string url = baseUrl + DEMANGLE(Secrets::ENDPOINT_CHATS) + "/" + id;
        auto resp = performRequest("GET", url);
        if (resp.code != 200) {
            errMsg = resp.error.empty() ? ("HTTP " + std::to_string(resp.code) + ": " + resp.body) : resp.error;
            return false;
        }
        try {
            auto val = json::parse(resp.body);
            if (val.is_object()) {
                const json* objPtr = &val;
                if (val.contains("session") && val["session"].is_object()) {
                    objPtr = &val["session"];
                }
                detail.raw_json = objPtr->dump(2);
                const auto& obj = *objPtr;
                detail.id = id;
                if (obj.contains("title") && obj["title"].is_string()) detail.title = obj["title"].get<std::string>();
                if (obj.contains("type") && obj["type"].is_string()) detail.type = obj["type"].get<std::string>();
                if (obj.contains("date") && obj["date"].is_string()) detail.date_folder = obj["date"].get<std::string>();
                if (obj.contains("meta") && obj["meta"].is_object()) {
                    const auto& m = obj["meta"];
                    if (detail.title.empty() && m.contains("title") && m["title"].is_string()) detail.title = m["title"].get<std::string>();
                    if (m.contains("updatedAt") && m["updatedAt"].is_string()) detail.updated_at = m["updatedAt"].get<std::string>();
                }
                if (obj.contains("messages") && obj["messages"].is_array()) {
                    for (const auto& mObj : obj["messages"]) {
                        if (mObj.is_object()) {
                            ChatMessage msg;
                            if (mObj.contains("role") && mObj["role"].is_string()) msg.role = mObj["role"].get<std::string>();
                            if (mObj.contains("content")) {
                                if (mObj["content"].is_string()) msg.content = mObj["content"].get<std::string>();
                                else msg.content = mObj["content"].dump();
                            }
                            if (mObj.contains("model") && mObj["model"].is_string()) msg.model = mObj["model"].get<std::string>();
                            if (mObj.contains("timestamp")) {
                                if (mObj["timestamp"].is_string()) msg.timestamp = mObj["timestamp"].get<std::string>();
                                else if (mObj["timestamp"].is_number()) msg.timestamp = std::to_string(mObj["timestamp"].get<int64_t>());
                            }
                            detail.messages.push_back(msg);
                        }
                    }
                }
                return true;
            }
        } catch (const std::exception& e) {
            detail.raw_json = resp.body;
            errMsg = e.what();
        }
        return false;
    }

    bool saveChatRaw(const std::string& rawJson, std::string& errMsg) {
        std::string payload = rawJson;
        try {
            auto val = json::parse(rawJson);
            if (val.is_object() && val.contains("session") && val["session"].is_object()) {
                payload = val["session"].dump();
            }
        } catch (...) {}
        std::string url = baseUrl + DEMANGLE(Secrets::ENDPOINT_CHATS_SAVE);
        auto resp = performRequest("POST", url, true, payload);
        if (resp.code != 200) { errMsg = resp.error.empty() ? ("HTTP " + std::to_string(resp.code) + ": " + resp.body) : resp.error; return false; }
        return true;
    }

    bool deleteChat(const std::string& id, std::string& errMsg) {
        std::string url = directSupabaseMode
            ? (DEMANGLE(Secrets::SUPABASE_REST_URL) + "/chats?id=eq." + id)
            : (baseUrl + DEMANGLE(Secrets::ENDPOINT_CHATS) + "/" + id);
        auto resp = performRequest("DELETE", url, false);
        if (resp.code != 200 && resp.code != 204) {
            errMsg = resp.error.empty() ? ("HTTP " + std::to_string(resp.code) + ": " + resp.body) : resp.error;
            return false;
        }
        return true;
    }

    std::map<std::string, std::string> loadLocalEnv() {
        std::map<std::string, std::string> env;
        std::string envPath = repoRoot + "/" + DEMANGLE(Secrets::ENV_FILE);
        std::ifstream file(envPath);
        if (!file.is_open()) return env;

        std::string line;
        while (std::getline(file, line)) {
            if (line.empty() || line[0] == '#') continue;
            size_t eq = line.find('=');
            if (eq != std::string::npos) {
                std::string k = line.substr(0, eq);
                std::string v = line.substr(eq + 1);
                while (!k.empty() && (k.back() == ' ' || k.back() == '\t')) k.pop_back();
                while (!v.empty() && (v.front() == ' ' || v.front() == '\t' || v.front() == '"')) v.erase(v.begin());
                while (!v.empty() && (v.back() == ' ' || v.back() == '\t' || v.back() == '"' || v.back() == '\r')) v.pop_back();
                env[k] = v;
            }
        }
        return env;
    }

    bool saveLocalEnv(const std::map<std::string, std::string>& env, std::string& errMsg) {
        std::string envPath = repoRoot + "/" + DEMANGLE(Secrets::ENV_FILE);
        std::ofstream file(envPath);
        if (!file.is_open()) { errMsg = "Cannot write to " + envPath; return false; }
        for (const auto& [k, v] : env) {
            file << k << "=\"" << v << "\"\n";
        }
        return true;
    }
};
