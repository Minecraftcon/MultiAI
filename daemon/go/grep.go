package main

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type GrepMatch struct {
	File        string `json:"file"`
	LineNumber  int    `json:"line_number"`
	LineContent string `json:"line_content"`
}

type GrepResult struct {
	Matches      []GrepMatch `json:"matches"`
	TotalMatches int         `json:"total_matches"`
	FilesMatched []string    `json:"files_matched"`
	DurationMs   float64     `json:"duration_ms"`
}

var ignoreDirs = map[string]bool{
	".git":         true,
	"node_modules": true,
	"dist":         true,
	".venv":        true,
	"venv":         true,
	"__pycache__":  true,
	".mitm":        true,
	".idea":        true,
	".vscode":      true,
}

func ExecuteCodeGrep(
	query, searchPath string,
	isRegex, caseSensitive bool,
	includeGlob string,
	filesOnly bool,
	maxResults int,
) (*GrepResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("parameter 'query' is required")
	}

	if searchPath == "" {
		searchPath = "."
	}
	if strings.HasPrefix(searchPath, "~/") {
		home, _ := os.UserHomeDir()
		searchPath = filepath.Join(home, searchPath[2:])
	}

	resolvedPath, err := filepath.Abs(searchPath)
	if err != nil {
		return nil, fmt.Errorf("invalid path: %w", err)
	}

	info, err := os.Stat(resolvedPath)
	if err != nil {
		return nil, fmt.Errorf("path not found: %s", searchPath)
	}

	maxLim := maxResults
	if maxLim <= 0 {
		maxLim = 50
	} else if maxLim > 100 {
		maxLim = 100
	}

	var pattern *regexp.Regexp
	patStr := query
	if !isRegex {
		patStr = regexp.QuoteMeta(query)
	}
	if !caseSensitive {
		patStr = "(?i)" + patStr
	}

	pattern, err = regexp.Compile(patStr)
	if err != nil {
		return nil, fmt.Errorf("invalid regular expression: %w", err)
	}

	var includePatterns []string
	if includeGlob != "" {
		for _, p := range strings.Split(includeGlob, ",") {
			p = strings.TrimSpace(p)
			if p != "" {
				includePatterns = append(includePatterns, p)
			}
		}
	}

	matches := make([]GrepMatch, 0)
	filesMatched := make([]string, 0)
	startTime := time.Now()

	matchInclude := func(filename string) bool {
		if len(includePatterns) == 0 {
			return true
		}
		for _, pat := range includePatterns {
			if matched, _ := filepath.Match(pat, filename); matched {
				return true
			}
		}
		return false
	}

	checkFile := func(path string) bool {
		baseName := filepath.Base(path)
		if strings.HasPrefix(baseName, ".") && baseName != ".gitignore" {
			return false
		}
		if !matchInclude(baseName) {
			return false
		}

		fi, err := os.Stat(path)
		if err != nil || !fi.Mode().IsRegular() {
			return false
		}
		if fi.Size() > 10*1024*1024 {
			return false // skip files > 10MB
		}

		file, err := os.Open(path)
		if err != nil {
			return false
		}
		defer file.Close()

		// Read first 1024 bytes to check for binary
		head := make([]byte, 1024)
		n, _ := file.Read(head)
		if bytes.Contains(head[:n], []byte{0}) {
			return false
		}

		// Read remaining
		_, _ = file.Seek(0, io.SeekStart)
		content, err := io.ReadAll(file)
		if err != nil {
			return false
		}

		relPath, _ := filepath.Rel(resolvedPath, path)
		if relPath == "" || relPath == "." {
			relPath = baseName
		}

		if filesOnly {
			if pattern.Match(content) {
				filesMatched = append(filesMatched, relPath)
				if len(filesMatched) >= maxLim {
					return true // stop
				}
			}
			return false
		}

		locs := pattern.FindAllIndex(content, maxLim-len(matches))
		for _, loc := range locs {
			startIdx := loc[0]
			endIdx := loc[1]

			lineNo := bytes.Count(content[:startIdx], []byte("\n")) + 1

			lineStart := bytes.LastIndex(content[:startIdx], []byte("\n"))
			if lineStart == -1 {
				lineStart = 0
			} else {
				lineStart++
			}

			lineEnd := bytes.Index(content[endIdx:], []byte("\n"))
			if lineEnd == -1 {
				lineEnd = len(content)
			} else {
				lineEnd += endIdx
			}

			rawLine := string(content[lineStart:lineEnd])
			if len(rawLine) > 500 {
				rawLine = rawLine[:500] + "…"
			}

			matches = append(matches, GrepMatch{
				File:        relPath,
				LineNumber:  lineNo,
				LineContent: rawLine,
			})

			if len(matches) >= maxLim {
				return true
			}
		}

		return len(matches) >= maxLim
	}

	if !info.IsDir() {
		checkFile(resolvedPath)
	} else {
		_ = filepath.WalkDir(resolvedPath, func(p string, d os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				name := d.Name()
				if ignoreDirs[name] || (strings.HasPrefix(name, ".") && p != resolvedPath) {
					return filepath.SkipDir
				}
				return nil
			}

			stop := checkFile(p)
			if stop {
				return io.EOF // sentinel to stop walking early
			}
			return nil
		})
	}

	duration := roundFloat(float64(time.Since(startTime).Milliseconds()), 2)

	return &GrepResult{
		Matches:      matches,
		TotalMatches: len(matches),
		FilesMatched: filesMatched,
		DurationMs:   duration,
	}, nil
}
