#include <iostream>
#include <string>
#include <vector>
#include <iomanip>
#include <sstream>
#include <thread>
#include <chrono>
#include "obfuscation.hpp"
#include "client.hpp"
#include "tui.hpp"

using namespace TUI;

static std::string repeatUtf8(const std::string& pat, size_t count) {
    std::string res;
    res.reserve(pat.size() * count);
    for (size_t i = 0; i < count; ++i) res += pat;
    return res;
}

class MultiAIManagerApp {
private:
    Terminal term;
    MultiAIClient client;
    std::string statusMsg;

public:
    MultiAIManagerApp(const std::string& repoRoot = ".")
        : client(repoRoot), statusMsg("Ready") {}

    void run() {
        term.enableRawMode();
        mainMenu();
        term.disableRawMode();
        std::cout << "\033[2J\033[H MultiAI Management Console closed.\n";
    }

private:
    void mainMenu() {
        const std::vector<std::pair<std::string, std::string>> menuItems = {
            {"1. Database & Chats View", "Browse conversation database tables and records"},
            {"2. Formatted Chat Viewer", "Full conversation view with roles, timestamps, models"},
            {"3. Database Record Edit", "Edit raw chat session JSON in interactive Nano editor"},
            {"4. Delete Conversation", "Delete single or all conversations from database"},
            {"5. Edit Master Password", "Rotate CLOUD_PASSWORD locally (.env) and verify gate"},
            {"6. Edit Keys Registry", "Manage GEMINI_API_KEY, OPENAI_API_KEY, Supabase tokens"},
            {"7. Switch Target Host", "Toggle between Cloud (Render) and Local (localhost:8080)"},
            {"8. Exit", "Return to terminal shell"}
        };

        int selected = 0;

        while (true) {
            int rows, cols;
            term.getWindowSize(rows, cols);

            term.clearScreen();
            term.renderHeader("Main Console", "Target: " + client.getBaseUrl());

            term.moveCursor(3, 3);
            std::cout << "\033[1;36m┌─────────────────────────────────────────────────────────────┐\033[0m\r\n";
            term.moveCursor(4, 3);
            std::cout << "\033[1;36m│\033[0m  \033[1mMultiAI Security & Database Management Interface (C++20)\033[0m   \033[1;36m│\033[0m\r\n";
            term.moveCursor(5, 3);
            std::cout << "\033[1;36m└─────────────────────────────────────────────────────────────┘\033[0m\r\n";

            for (size_t i = 0; i < menuItems.size(); ++i) {
                term.moveCursor(7 + (int)i, 5);
                if ((int)i == selected) {
                    std::cout << "\033[1;32m ➔ \033[7m " << menuItems[i].first << " \033[0m  \033[90m" << menuItems[i].second << "\033[0m";
                } else {
                    std::cout << "    \033[1m" << menuItems[i].first << "\033[0m  \033[90m" << menuItems[i].second << "\033[0m";
                }
            }

            if (!statusMsg.empty()) {
                term.moveCursor(rows - 3, 5);
                std::cout << "\033[33mStatus: " << statusMsg << "\033[0m";
            }

            term.renderFooter({
                {"^X", "Exit"},
                {"Enter", "Open"},
                {"↑/↓", "Navigate"},
                {"^R", "Ping/Auth"}
            });

            int k = term.readKey();
            if (k == KEY_CTRL_X || k == KEY_CTRL_C || k == 'q') {
                break;
            }
            if (k == KEY_UP) {
                if (selected > 0) selected--;
            } else if (k == KEY_DOWN) {
                if (selected + 1 < (int)menuItems.size()) selected++;
            } else if (k == KEY_CTRL_R) {
                std::string info;
                if (client.ping(info)) {
                    statusMsg = "Ping success: " + info;
                } else {
                    statusMsg = "Ping failed: " + info;
                }
            } else if (k == KEY_ENTER) {
                if (selected == 0) viewDatabase();
                else if (selected == 1) viewFormattedChat();
                else if (selected == 2) editDatabaseRecord();
                else if (selected == 3) deleteConversation();
                else if (selected == 4) editPassword();
                else if (selected == 5) editKeysRegistry();
                else if (selected == 6) switchTarget();
                else if (selected == 7) break;
            }
        }
    }

    void viewDatabase() {
        std::string err;
        auto chats = client.listChats(err);
        int selected = 0;
        int scroll = 0;

        while (true) {
            int rows, cols;
            term.getWindowSize(rows, cols);
            int listHeight = rows - 6;

            if (selected < scroll) scroll = selected;
            if (selected >= scroll + listHeight) scroll = selected - listHeight + 1;

            term.clearScreen();
            term.renderHeader("Database View: public.chats (" + std::to_string(chats.size()) + " records)", "Target: " + client.getBaseUrl());

            term.moveCursor(3, 2);
            std::cout << "\033[1;37m"
                      << std::left << std::setw(28) << "CHAT ID"
                      << std::setw(30) << "TITLE"
                      << std::setw(12) << "TYPE"
                      << std::setw(14) << "DATE"
                      << "\033[0m\r\n";
            term.moveCursor(4, 2);
            std::cout << std::string(cols - 4, '-') << "\r\n";

            if (chats.empty()) {
                term.moveCursor(6, 4);
                std::cout << "\033[90m(No chat records found or database is currently empty)\033[0m";
                if (!err.empty()) {
                    term.moveCursor(8, 4);
                    std::cout << "\033[31mError fetching records: " << err << "\033[0m";
                }
            } else {
                for (int i = 0; i < listHeight && (scroll + i) < (int)chats.size(); ++i) {
                    int idx = scroll + i;
                    term.moveCursor(5 + i, 2);
                    std::string idStr = chats[idx].id.substr(0, 26);
                    std::string titleStr = chats[idx].title.substr(0, 28);
                    if (idx == selected) {
                        std::cout << "\033[7m"
                                  << std::left << std::setw(28) << idStr
                                  << std::setw(30) << titleStr
                                  << std::setw(12) << chats[idx].type
                                  << std::setw(14) << chats[idx].date_folder
                                  << "\033[0m";
                    } else {
                        std::cout << std::left << std::setw(28) << idStr
                                  << std::setw(30) << titleStr
                                  << "\033[36m" << std::setw(12) << chats[idx].type << "\033[0m"
                                  << "\033[90m" << std::setw(14) << chats[idx].date_folder << "\033[0m";
                    }
                }
            }

            term.renderFooter({
                {"^X", "Back"},
                {"Enter", "Inspect"},
                {"^R", "Reload"},
                {"^D", "Delete"}
            });

            int k = term.readKey();
            if (k == KEY_CTRL_X || k == KEY_ESC || k == 'q') break;
            if (k == KEY_UP && selected > 0) selected--;
            if (k == KEY_DOWN && selected + 1 < (int)chats.size()) selected++;
            if (k == KEY_CTRL_R) {
                chats = client.listChats(err);
            }
            if (k == KEY_CTRL_D && !chats.empty()) {
                std::string delErr;
                if (client.deleteChat(chats[selected].id, delErr)) {
                    statusMsg = "Deleted chat " + chats[selected].id;
                    chats = client.listChats(err);
                    if (selected >= (int)chats.size() && selected > 0) selected--;
                } else {
                    statusMsg = "Delete failed: " + delErr;
                }
            }
            if (k == KEY_ENTER && !chats.empty()) {
                showFormattedChatDetail(chats[selected].id);
            }
        }
    }

    void showFormattedChatDetail(const std::string& chatId) {
        std::string err;
        ChatDetail detail;
        if (!client.getChat(chatId, detail, err)) {
            statusMsg = "Failed to load chat: " + err;
            return;
        }

        // Build formatted lines
        std::vector<std::string> viewLines;
        viewLines.push_back("Conversation ID: " + detail.id);
        viewLines.push_back("Title:           " + detail.title);
        viewLines.push_back("Total Turns:     " + std::to_string(detail.messages.size()));
        viewLines.push_back(std::string(70, '='));
        viewLines.push_back("");

        for (size_t i = 0; i < detail.messages.size(); ++i) {
            const auto& m = detail.messages[i];
            std::string roleHeader;
            if (m.role == "user") {
                roleHeader = "┌── [USER] " + (m.timestamp.empty() ? "" : "(" + m.timestamp + ")");
            } else if (m.role == "assistant") {
                roleHeader = "┌── [ASSISTANT" + (m.model.empty() ? "" : " • " + m.model) + "] " + (m.timestamp.empty() ? "" : "(" + m.timestamp + ")");
            } else {
                roleHeader = "┌── [" + m.role + "] " + (m.timestamp.empty() ? "" : "(" + m.timestamp + ")");
            }
            viewLines.push_back(roleHeader + " " + repeatUtf8("─", std::max(0, 70 - (int)roleHeader.size())));

            std::stringstream ss(m.content);
            std::string line;
            while (std::getline(ss, line)) {
                viewLines.push_back("│ " + line);
            }
            viewLines.push_back("└" + repeatUtf8("─", 69));
            viewLines.push_back("");
        }

        int scroll = 0;
        while (true) {
            int rows, cols;
            term.getWindowSize(rows, cols);
            int height = rows - 4;

            term.clearScreen();
            term.renderHeader("Chat: " + detail.id, "[Turn " + std::to_string(detail.messages.size()) + "]");

            for (int i = 0; i < height; ++i) {
                int idx = scroll + i;
                term.moveCursor(2 + i, 1);
                if (idx < (int)viewLines.size()) {
                    std::cout << viewLines[idx].substr(0, cols);
                }
            }

            term.renderFooter({
                {"^X", "Back"},
                {"^E", "Edit JSON (Nano)"},
                {"↑/↓", "Scroll"}
            });

            int k = term.readKey();
            if (k == KEY_CTRL_X || k == KEY_ESC || k == 'q') break;
            if (k == KEY_UP && scroll > 0) scroll--;
            if (k == KEY_DOWN && scroll + height < (int)viewLines.size()) scroll++;
            if (k == 5 || k == 'e') { // Ctrl+E
                std::string jsonBuffer = detail.raw_json;
                if (term.nanoEditor("Chat JSON: " + detail.id, jsonBuffer)) {
                    std::string saveErr;
                    if (client.saveChatRaw(jsonBuffer, saveErr)) {
                        statusMsg = "Chat updated in database!";
                        client.getChat(chatId, detail, err);
                    } else {
                        statusMsg = "Save error: " + saveErr;
                    }
                }
            }
        }
    }

    void viewFormattedChat() {
        std::string err;
        auto chats = client.listChats(err);
        if (chats.empty()) {
            statusMsg = "No chats found to view.";
            return;
        }
        viewDatabase();
    }

    void editDatabaseRecord() {
        std::string err;
        auto chats = client.listChats(err);
        if (chats.empty()) {
            statusMsg = "No records to edit.";
            return;
        }

        int rows, cols;
        term.getWindowSize(rows, cols);

        term.clearScreen();
        term.renderHeader("Select Record to Edit in Nano");
        for (size_t i = 0; i < chats.size() && i < 15; ++i) {
            term.moveCursor(4 + (int)i, 5);
            std::cout << (int)(i + 1) << ". " << chats[i].id << " (" << chats[i].title << ")";
        }
        term.moveCursor(20, 5);
        std::cout << "Opening record 1 in interactive Nano editor...";
        std::this_thread::sleep_for(std::chrono::milliseconds(500));

        ChatDetail detail;
        if (client.getChat(chats[0].id, detail, err)) {
            std::string buffer = detail.raw_json;
            if (term.nanoEditor("Editing Record " + chats[0].id, buffer)) {
                std::string saveErr;
                if (client.saveChatRaw(buffer, saveErr)) {
                    statusMsg = "Record updated successfully in database!";
                } else {
                    statusMsg = "Record update failed: " + saveErr;
                }
            }
        }
    }

    void deleteConversation() {
        std::string err;
        auto chats = client.listChats(err);
        if (chats.empty()) {
            statusMsg = "Database has no conversations to delete.";
            return;
        }

        term.clearScreen();
        term.renderHeader("Delete Conversation");
        term.moveCursor(4, 5);
        std::cout << "\033[1;31mConfirm Deletion\033[0m\r\n";
        term.moveCursor(6, 5);
        std::cout << "Are you sure you want to delete chat: " << chats[0].id << " (" << chats[0].title << ")?\r\n";
        term.moveCursor(8, 5);
        std::cout << "Press [Y] to confirm delete, [A] to purge ALL, [N] to cancel.";

        while (true) {
            int k = term.readKey();
            if (k == 'y' || k == 'Y') {
                std::string delErr;
                if (client.deleteChat(chats[0].id, delErr)) {
                    statusMsg = "Successfully deleted " + chats[0].id;
                } else {
                    statusMsg = "Delete failed: " + delErr;
                }
                break;
            } else if (k == 'a' || k == 'A') {
                statusMsg = "Purging chats...";
                for (const auto& c : chats) {
                    std::string delErr;
                    client.deleteChat(c.id, delErr);
                }
                statusMsg = "All conversations purged!";
                break;
            } else if (k == 'n' || k == 'N' || k == KEY_ESC || k == KEY_CTRL_X) {
                statusMsg = "Delete cancelled.";
                break;
            }
        }
    }

    void editPassword() {
        auto env = client.loadLocalEnv();
        std::string currentPass = env.count("CLOUD_PASSWORD") ? env["CLOUD_PASSWORD"] : client.getPassword();

        term.clearScreen();
        term.renderHeader("Edit Master Cloud Password");
        term.moveCursor(4, 5);
        std::cout << "\033[1mCurrent Master Password:\033[0m " << currentPass << "\r\n";
        term.moveCursor(6, 5);
        std::cout << "Enter new password (or press Ctrl+X to cancel):\r\n";
        term.moveCursor(8, 5);
        std::cout << "➔ ";

        std::string newPass;
        while (true) {
            int k = term.readKey();
            if (k == KEY_CTRL_X || k == KEY_ESC) {
                statusMsg = "Password edit cancelled.";
                return;
            }
            if (k == KEY_ENTER) {
                if (!newPass.empty()) {
                    env["CLOUD_PASSWORD"] = newPass;
                    std::string saveErr;
                    if (client.saveLocalEnv(env, saveErr)) {
                        client.setPassword(newPass);
                        statusMsg = "Password updated to: " + newPass;
                    } else {
                        statusMsg = "Failed to save: " + saveErr;
                    }
                }
                return;
            }
            if (k == KEY_BACKSPACE && !newPass.empty()) {
                newPass.pop_back();
                std::cout << "\b \b" << std::flush;
            } else if (k >= 32 && k <= 126) {
                newPass.push_back(static_cast<char>(k));
                std::cout << static_cast<char>(k) << std::flush;
            }
        }
    }

    void editKeysRegistry() {
        auto env = client.loadLocalEnv();
        std::vector<std::string> knownKeys = {
            "GEMINI_API_KEY",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "OPENROUTER_API_KEY",
            "GROQ_API_KEY",
            "SUPABASE_DB_HOST",
            "SUPABASE_DB_PASSWORD",
            "CLOUD_PASSWORD"
        };

        // Add any additional keys found in .env
        for (const auto& [k, v] : env) {
            if (std::find(knownKeys.begin(), knownKeys.end(), k) == knownKeys.end()) {
                knownKeys.push_back(k);
            }
        }

        int selected = 0;
        while (true) {
            term.clearScreen();
            term.renderHeader("Keys & Secrets Registry (.env)");

            term.moveCursor(3, 2);
            std::cout << "\033[1;37m" << std::left << std::setw(28) << "KEY NAME" << std::setw(40) << "MASKED VALUE" << "\033[0m\r\n";
            term.moveCursor(4, 2);
            std::cout << std::string(70, '-') << "\r\n";

            for (size_t i = 0; i < knownKeys.size(); ++i) {
                const std::string& key = knownKeys[i];
                std::string val = env.count(key) ? env[key] : "(not set)";
                std::string masked = val;
                if (val.size() > 8 && key.find("KEY") != std::string::npos) {
                    masked = val.substr(0, 4) + "..." + val.substr(val.size() - 4);
                }

                term.moveCursor(5 + (int)i, 2);
                if ((int)i == selected) {
                    std::cout << "\033[7m" << std::left << std::setw(28) << key << std::setw(40) << masked << "\033[0m";
                } else {
                    std::cout << std::left << std::setw(28) << key << "\033[36m" << std::setw(40) << masked << "\033[0m";
                }
            }

            term.renderFooter({
                {"^X", "Back"},
                {"Enter", "Edit Value"},
                {"^O", "Open .env (Nano)"},
                {"↑/↓", "Navigate"}
            });

            int k = term.readKey();
            if (k == KEY_CTRL_X || k == KEY_ESC || k == 'q') break;
            if (k == KEY_UP && selected > 0) selected--;
            if (k == KEY_DOWN && selected + 1 < (int)knownKeys.size()) selected++;

            if (k == KEY_CTRL_O) {
                // Open full .env in Nano editor
                std::string envPath = ".env";
                std::ifstream f(envPath);
                std::string content((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
                f.close();
                if (term.nanoEditor(".env Registry", content)) {
                    std::ofstream out(envPath);
                    out << content;
                    out.close();
                    env = client.loadLocalEnv();
                    statusMsg = ".env saved successfully via Nano!";
                }
            }

            if (k == KEY_ENTER) {
                const std::string& targetKey = knownKeys[selected];
                term.clearScreen();
                term.renderHeader("Update Key: " + targetKey);
                term.moveCursor(4, 5);
                std::cout << "Current: " << (env.count(targetKey) ? env[targetKey] : "(none)") << "\r\n";
                term.moveCursor(6, 5);
                std::cout << "Enter new value: ➔ ";

                std::string newVal;
                while (true) {
                    int ch = term.readKey();
                    if (ch == KEY_CTRL_X || ch == KEY_ESC) break;
                    if (ch == KEY_ENTER) {
                        env[targetKey] = newVal;
                        std::string saveErr;
                        if (client.saveLocalEnv(env, saveErr)) {
                            statusMsg = "Updated " + targetKey;
                        }
                        break;
                    }
                    if (ch == KEY_BACKSPACE && !newVal.empty()) {
                        newVal.pop_back();
                        std::cout << "\b \b" << std::flush;
                    } else if (ch >= 32 && ch <= 126) {
                        newVal.push_back(static_cast<char>(ch));
                        std::cout << static_cast<char>(ch) << std::flush;
                    }
                }
            }
        }
    }

    void switchTarget() {
        term.clearScreen();
        term.renderHeader("Switch Target Host");
        term.moveCursor(4, 5);
        std::cout << "1. Cloud Web API: " << DEMANGLE(Secrets::DEFAULT_CLOUD_URL) << "\r\n";
        term.moveCursor(5, 5);
        std::cout << "2. Local Web API: " << DEMANGLE(Secrets::DEFAULT_LOCAL_URL) << "\r\n";
        term.moveCursor(6, 5);
        std::cout << "3. Direct Supabase Postgres REST (Zero-Latency Native Query)\r\n";
        term.moveCursor(8, 5);
        std::cout << "Press [1] for Cloud, [2] for Local, [3] for Direct Supabase, or [Esc] to cancel.";

        int k = term.readKey();
        if (k == '1') {
            client.setDirectSupabaseMode(false);
            client.setBaseUrl(DEMANGLE(Secrets::DEFAULT_CLOUD_URL));
            statusMsg = "Switched to Cloud: " + client.getBaseUrl();
        } else if (k == '2') {
            client.setDirectSupabaseMode(false);
            client.setBaseUrl(DEMANGLE(Secrets::DEFAULT_LOCAL_URL));
            statusMsg = "Switched to Local: " + client.getBaseUrl();
        } else if (k == '3') {
            client.setDirectSupabaseMode(true);
            statusMsg = "Switched to Direct Supabase REST Mode";
        }
    }

public:
    void printCliList() {
        std::string err;
        auto chats = client.listChats(err);
        std::cout << "\033[1;36m=== MultiAI Database Chats (" << chats.size() << " records) ===\033[0m\n";
        std::cout << "Target: " << client.getBaseUrl() << "\n\n";
        if (chats.empty()) {
            std::cout << "No records found.\n";
            if (!err.empty()) std::cout << "\033[31mError: " << err << "\033[0m\n";
            return;
        }
        std::cout << "\033[1;37m"
                  << std::left << std::setw(28) << "CHAT ID"
                  << std::setw(32) << "TITLE"
                  << std::setw(10) << "TYPE"
                  << std::setw(14) << "DATE"
                  << std::setw(26) << "UPDATED AT"
                  << "\033[0m\n";
        std::cout << std::string(110, '-') << "\n";
        for (const auto& c : chats) {
            std::cout << std::left << std::setw(28) << c.id.substr(0, 26)
                      << std::setw(32) << c.title.substr(0, 30)
                      << "\033[36m" << std::setw(10) << c.type << "\033[0m"
                      << "\033[90m" << std::setw(14) << c.date_folder << "\033[0m"
                      << std::setw(26) << c.updated_at
                      << "\n";
        }
    }

    void printCliView(const std::string& chatId) {
        std::string err;
        ChatDetail detail;
        if (!client.getChat(chatId, detail, err)) {
            std::cerr << "\033[31mError retrieving chat '" << chatId << "': " << err << "\033[0m\n";
            return;
        }
        std::cout << "\033[1;36m================================================================================\033[0m\n";
        std::cout << "\033[1;37mChat ID: " << detail.id << "\033[0m\n";
        std::cout << "Title  : " << detail.title << "\n";
        std::cout << "Date   : " << detail.date_folder << " | Type: " << detail.type << "\n";
        std::cout << "Turns  : " << detail.messages.size() << " messages\n";
        std::cout << "\033[1;36m================================================================================\033[0m\n\n";

        for (size_t i = 0; i < detail.messages.size(); ++i) {
            const auto& m = detail.messages[i];
            std::string headerColor = "\033[1;32m"; // green for user
            if (m.role == "system") headerColor = "\033[1;33m"; // yellow
            else if (m.role == "assistant") headerColor = "\033[1;34m"; // blue

            std::cout << headerColor << "┌── [" << m.role << "] ";
            if (!m.model.empty()) std::cout << "(" << m.model << ") ";
            if (!m.timestamp.empty()) std::cout << "@ " << m.timestamp;
            std::cout << " " << repeatUtf8("─", 30) << "\033[0m\n";

            std::stringstream ss(m.content);
            std::string line;
            while (std::getline(ss, line)) {
                std::cout << "│ " << line << "\n";
            }
            std::cout << headerColor << "└──" << repeatUtf8("─", 50) << "\033[0m\n\n";
        }
    }

    void printCliPing() {
        std::string info;
        std::cout << "Testing connection to " << client.getBaseUrl() << " ...\n";
        if (client.ping(info)) {
            std::cout << "\033[1;32m[PASS] MultiAI Gate Authenticated: " << info << "\033[0m\n";
        } else {
            std::cout << "\033[1;31m[FAIL] Ping failed: " << info << "\033[0m\n";
        }
    }

    void cliDelete(const std::string& chatId) {
        std::string err;
        if (client.deleteChat(chatId, err)) {
            std::cout << "\033[1;32m[SUCCESS] Deleted conversation " << chatId << "\033[0m\n";
        } else {
            std::cout << "\033[1;31m[FAIL] Delete error: " << err << "\033[0m\n";
        }
    }

    void setDirectSupabaseMode(bool enable) {
        client.setDirectSupabaseMode(enable);
    }
};

int main(int argc, char* argv[]) {
    std::string root = ".";
    bool direct = false;
    std::string action = "";
    std::string targetId = "";

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--direct" || arg == "-d") {
            direct = true;
        } else if (arg == "--list" || arg == "-l") {
            action = "list";
        } else if (arg == "--ping" || arg == "-p") {
            action = "ping";
        } else if (arg == "--view" || arg == "-v") {
            action = "view";
            if (i + 1 < argc) targetId = argv[++i];
        } else if (arg == "--delete") {
            action = "delete";
            if (i + 1 < argc) targetId = argv[++i];
        } else if (arg == "--help" || arg == "-h") {
            std::cout << "MultiAI Management Console\n"
                      << "Usage: multiai-mgr [options]\n\n"
                      << "Options:\n"
                      << "  (no args)             Launch interactive Nano-style TUI\n"
                      << "  -l, --list            List all conversations from database\n"
                      << "  -v, --view <chat_id>  Print formatted conversation turns\n"
                      << "  -p, --ping            Test connectivity & authentication gate\n"
                      << "  -d, --direct          Use direct Supabase PostgREST mode\n"
                      << "  --delete <chat_id>    Delete a conversation\n"
                      << "  -h, --help            Show this help message\n";
            return 0;
        } else if (arg[0] != '-') {
            root = arg;
        }
    }

    MultiAIManagerApp app(root);
    if (direct) {
        app.setDirectSupabaseMode(true);
    }

    if (action == "list") {
        app.printCliList();
        return 0;
    } else if (action == "view") {
        if (targetId.empty()) {
            std::cerr << "Error: --view requires a chat ID.\n";
            return 1;
        }
        app.printCliView(targetId);
        return 0;
    } else if (action == "ping") {
        app.printCliPing();
        return 0;
    } else if (action == "delete") {
        if (targetId.empty()) {
            std::cerr << "Error: --delete requires a chat ID.\n";
            return 1;
        }
        app.cliDelete(targetId);
        return 0;
    }

    app.run();
    return 0;
}
