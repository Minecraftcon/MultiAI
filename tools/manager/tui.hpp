#pragma once
#include <iostream>
#include <string>
#include <vector>
#include <termios.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <signal.h>
#include <sstream>
#include <algorithm>

namespace TUI {

enum Key {
    KEY_NONE = 0,
    KEY_UP = 1000,
    KEY_DOWN,
    KEY_LEFT,
    KEY_RIGHT,
    KEY_ENTER,
    KEY_BACKSPACE,
    KEY_ESC,
    KEY_CTRL_X = 24,
    KEY_CTRL_O = 15,
    KEY_CTRL_D = 4,
    KEY_CTRL_R = 18,
    KEY_CTRL_C = 3
};

class Terminal {
private:
    struct termios orig_termios;
    bool raw_active = false;

public:
    Terminal() {
        tcgetattr(STDIN_FILENO, &orig_termios);
    }

    ~Terminal() {
        disableRawMode();
    }

    void enableRawMode() {
        if (raw_active) return;
        struct termios raw = orig_termios;
        raw.c_iflag &= ~(BRKINT | ICRNL | INPCK | ISTRIP | IXON);
        raw.c_oflag &= ~(OPOST);
        raw.c_cflag |= (CS8);
        raw.c_lflag &= ~(ECHO | ICANON | IEXTEN | ISIG);
        raw.c_cc[VMIN] = 0;
        raw.c_cc[VTIME] = 1;
        tcsetattr(STDIN_FILENO, TCSAFLUSH, &raw);
        raw_active = true;
        // Enter alternate screen buffer & hide cursor
        std::cout << "\033[?1049h\033[?25h" << std::flush;
    }

    void disableRawMode() {
        if (!raw_active) return;
        // Exit alternate screen buffer & show cursor
        std::cout << "\033[?1049l\033[?25h" << std::flush;
        tcsetattr(STDIN_FILENO, TCSAFLUSH, &orig_termios);
        raw_active = false;
    }

    void getWindowSize(int& rows, int& cols) {
        struct winsize ws;
        if (ioctl(STDOUT_FILENO, TIOCGWINSZ, &ws) == -1 || ws.ws_col == 0) {
            rows = 24;
            cols = 80;
        } else {
            rows = ws.ws_row;
            cols = ws.ws_col;
        }
    }

    int readKey() {
        char c;
        while (read(STDIN_FILENO, &c, 1) != 1) {
            usleep(10000); // 10ms
        }

        if (c == '\033') {
            char seq[3];
            if (read(STDIN_FILENO, &seq[0], 1) != 1) return KEY_ESC;
            if (read(STDIN_FILENO, &seq[1], 1) != 1) return KEY_ESC;

            if (seq[0] == '[') {
                switch (seq[1]) {
                    case 'A': return KEY_UP;
                    case 'B': return KEY_DOWN;
                    case 'C': return KEY_RIGHT;
                    case 'D': return KEY_LEFT;
                    case '3':
                        if (read(STDIN_FILENO, &seq[2], 1) == 1 && seq[2] == '~') return KEY_CTRL_D;
                        break;
                }
            }
            return KEY_ESC;
        }

        if (c == 127 || c == 8) return KEY_BACKSPACE;
        if (c == 13 || c == 10) return KEY_ENTER;
        if (c == 24) return KEY_CTRL_X;
        if (c == 15) return KEY_CTRL_O;
        if (c == 4)  return KEY_CTRL_D;
        if (c == 18) return KEY_CTRL_R;
        if (c == 3)  return KEY_CTRL_C;

        return static_cast<unsigned char>(c);
    }

    void clearScreen() {
        std::cout << "\033[2J\033[H" << std::flush;
    }

    void moveCursor(int row, int col) {
        std::cout << "\033[" << row << ";" << col << "H" << std::flush;
    }

    void renderHeader(const std::string& title, const std::string& status = "") {
        int rows, cols;
        getWindowSize(rows, cols);
        moveCursor(1, 1);
        std::cout << "\033[7m"; // Inverted colors (nano header style)
        std::string line = " MultiAI Console: " + title;
        if (!status.empty()) {
            size_t pad = (cols > (int)line.size() + (int)status.size() + 2) ? cols - line.size() - status.size() - 2 : 1;
            line += std::string(pad, ' ') + status + " ";
        }
        if ((int)line.size() < cols) {
            line += std::string(cols - line.size(), ' ');
        }
        std::cout << line.substr(0, cols) << "\033[0m\r\n" << std::flush;
    }

    void renderFooter(const std::vector<std::pair<std::string, std::string>>& shortcuts) {
        int rows, cols;
        getWindowSize(rows, cols);
        moveCursor(rows - 1, 1);
        std::cout << "\033[K\r\n\033[K"; // clear last two lines
        moveCursor(rows - 1, 1);

        // Render Nano style 2-row footer
        size_t perRow = 4;
        for (size_t i = 0; i < shortcuts.size(); ++i) {
            if (i > 0 && i % perRow == 0) {
                moveCursor(rows, 1);
            }
            std::cout << "\033[7m " << shortcuts[i].first << " \033[0m " << shortcuts[i].second << "   ";
        }
        std::cout << std::flush;
    }

    // Nano-style interactive text editor buffer
    bool nanoEditor(const std::string& title, std::string& content) {
        std::vector<std::string> lines;
        std::stringstream ss(content);
        std::string item;
        while (std::getline(ss, item)) {
            lines.push_back(item);
        }
        if (lines.empty()) lines.push_back("");

        int curRow = 0;
        int curCol = 0;
        int scrollOffset = 0;
        bool modified = false;

        while (true) {
            int rows, cols;
            getWindowSize(rows, cols);
            int viewHeight = rows - 4;

            if (curRow < scrollOffset) scrollOffset = curRow;
            if (curRow >= scrollOffset + viewHeight) scrollOffset = curRow - viewHeight + 1;

            clearScreen();
            renderHeader("Nano Editor - " + title, modified ? "[Modified]" : "[Unchanged]");

            for (int i = 0; i < viewHeight; ++i) {
                int lineIdx = scrollOffset + i;
                moveCursor(2 + i, 1);
                if (lineIdx < (int)lines.size()) {
                    std::cout << "\033[90m" << (lineIdx + 1) << "\033[0m │ " << lines[lineIdx].substr(0, cols - 6);
                } else {
                    std::cout << "\033[90m~ \033[0m";
                }
            }

            renderFooter({
                {"^O", "WriteOut (Save)"},
                {"^X", "Exit"},
                {"^R", "Reload"},
                {"↑/↓", "Navigate"}
            });

            moveCursor(2 + (curRow - scrollOffset), 5 + curCol + 1);
            int k = readKey();

            if (k == KEY_CTRL_X) {
                return false; // Exit without save
            }
            if (k == KEY_CTRL_O) {
                // Save and serialize back
                std::string res;
                for (size_t i = 0; i < lines.size(); ++i) {
                    res += lines[i];
                    if (i + 1 < lines.size()) res += "\n";
                }
                content = res;
                return true;
            }
            if (k == KEY_UP) {
                if (curRow > 0) {
                    curRow--;
                    curCol = std::min(curCol, (int)lines[curRow].size());
                }
            } else if (k == KEY_DOWN) {
                if (curRow + 1 < (int)lines.size()) {
                    curRow++;
                    curCol = std::min(curCol, (int)lines[curRow].size());
                }
            } else if (k == KEY_LEFT) {
                if (curCol > 0) curCol--;
            } else if (k == KEY_RIGHT) {
                if (curCol < (int)lines[curRow].size()) curCol++;
            } else if (k == KEY_BACKSPACE) {
                if (curCol > 0) {
                    lines[curRow].erase(curCol - 1, 1);
                    curCol--;
                    modified = true;
                } else if (curRow > 0) {
                    curCol = lines[curRow - 1].size();
                    lines[curRow - 1] += lines[curRow];
                    lines.erase(lines.begin() + curRow);
                    curRow--;
                    modified = true;
                }
            } else if (k == KEY_ENTER) {
                std::string rest = lines[curRow].substr(curCol);
                lines[curRow] = lines[curRow].substr(0, curCol);
                lines.insert(lines.begin() + curRow + 1, rest);
                curRow++;
                curCol = 0;
                modified = true;
            } else if (k >= 32 && k <= 126) {
                lines[curRow].insert(curCol, 1, static_cast<char>(k));
                curCol++;
                modified = true;
            }
        }
    }
};

} // namespace TUI

