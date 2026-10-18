package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

var manager = NewTaskManager()

func sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func parseJSONBody(r *http.Request, target interface{}) error {
	defer r.Body.Close()
	body, err := io.ReadAll(r.Body)
	if err != nil || len(body) == 0 {
		return nil
	}
	return json.Unmarshal(body, target)
}

func handleRoutes(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.WriteHeader(http.StatusNoContent)
		return
	}

	path := r.URL.Path

	// 1. Health check
	if r.Method == http.MethodGet && path == "/health" {
		sendJSON(w, http.StatusOK, map[string]string{
			"status": "ok",
			"engine": "go",
		})
		return
	}

	// 2. Run task: POST /api/task/run
	if r.Method == http.MethodPost && path == "/api/task/run" {
		var req struct {
			Command      string      `json:"command"`
			Timer        interface{} `json:"timer"`
			Timeout      interface{} `json:"timeout"`
			WaitMs       interface{} `json:"wait_ms"`
			Cwd          string      `json:"cwd"`
			Shell        string      `json:"shell"`
			ScratchDir   string      `json:"scratch_dir"`
			ArtifactsDir string      `json:"artifacts_dir"`
		}
		_ = parseJSONBody(r, &req)

		if strings.TrimSpace(req.Command) == "" {
			sendJSON(w, http.StatusBadRequest, map[string]string{"error": "No command provided"})
			return
		}

		timeoutSec := 5.0
		if req.Timer != nil {
			timeoutSec = parseNumber(req.Timer, 5.0)
		} else if req.Timeout != nil {
			timeoutSec = parseNumber(req.Timeout, 5.0)
		} else if req.WaitMs != nil {
			timeoutSec = parseNumber(req.WaitMs, 1000.0) / 1000.0
		}

		taskID, err := manager.RunTask(req.Command, req.Shell, req.ScratchDir, req.ArtifactsDir, req.Cwd)
		if err != nil {
			sendJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		out := manager.WaitForTask(taskID, timeoutSec)
		sendJSON(w, http.StatusOK, out)
		return
	}

	// 3. Task output: GET /api/task/stdout/<task_id>
	if r.Method == http.MethodGet && strings.HasPrefix(path, "/api/task/stdout/") {
		taskID := strings.TrimPrefix(path, "/api/task/stdout/")
		out, err := manager.GetOutput(taskID)
		if err != nil {
			sendJSON(w, http.StatusNotFound, map[string]string{"error": fmt.Sprintf("Task %s not found.", taskID)})
			return
		}
		sendJSON(w, http.StatusOK, out)
		return
	}

	// 4. Send input: POST /api/task/input/<task_id>
	if r.Method == http.MethodPost && strings.HasPrefix(path, "/api/task/input/") {
		taskID := strings.TrimPrefix(path, "/api/task/input/")
		var req struct {
			Field       string `json:"field"`
			InputString string `json:"input_string"`
			Input       string `json:"input"`
			Type        string `json:"type"`
			Combination string `json:"combination"`
			PressEnter  *bool  `json:"press_enter"`
		}
		_ = parseJSONBody(r, &req)

		inputStr := req.Field
		if inputStr == "" {
			inputStr = req.InputString
		}
		if inputStr == "" {
			inputStr = req.Input
		}

		inputType := req.Type
		if inputType == "" {
			if req.Combination != "" {
				inputType = "keycode"
			} else {
				inputType = "text"
			}
		}

		pressEnter := true
		if req.PressEnter != nil {
			pressEnter = *req.PressEnter
		}

		res, err := manager.SendInput(taskID, inputStr, inputType, req.Combination, pressEnter)
		if err != nil {
			sendJSON(w, http.StatusNotFound, res)
			return
		}
		sendJSON(w, http.StatusOK, res)
		return
	}

	// 5. Kill task: POST /api/task/kill/<task_id>
	if r.Method == http.MethodPost && strings.HasPrefix(path, "/api/task/kill/") {
		taskID := strings.TrimPrefix(path, "/api/task/kill/")
		res, err := manager.KillTask(taskID)
		if err != nil {
			sendJSON(w, http.StatusNotFound, res)
			return
		}
		sendJSON(w, http.StatusOK, res)
		return
	}

	// 6. List tasks: GET /api/task/list
	if r.Method == http.MethodGet && path == "/api/task/list" {
		sendJSON(w, http.StatusOK, manager.ListTasks())
		return
	}

	// 7. Clean finished tasks: POST /api/task/clean
	if r.Method == http.MethodPost && path == "/api/task/clean" {
		cleaned := manager.CleanFinished()
		sendJSON(w, http.StatusOK, map[string]int{"cleaned": cleaned})
		return
	}

	// 8. Idle monitoring: POST /api/task/idle
	if r.Method == http.MethodPost && path == "/api/task/idle" {
		var req struct {
			Seconds interface{} `json:"seconds"`
			TaskID  string      `json:"task_id"`
			WakeOn  string      `json:"wake_on"`
			Reason  string      `json:"reason"`
		}
		_ = parseJSONBody(r, &req)

		secs := parseNumber(req.Seconds, 5.0)
		wakeOn := req.WakeOn
		if wakeOn == "" {
			wakeOn = "exit"
		}

		res := manager.Idle(secs, req.TaskID, wakeOn, req.Reason)
		sendJSON(w, http.StatusOK, res)
		return
	}

	// 9. Code grep: POST /api/code/grep
	if r.Method == http.MethodPost && path == "/api/code/grep" {
		var req struct {
			Query         string      `json:"query"`
			Path          string      `json:"path"`
			IsRegex       bool        `json:"is_regex"`
			CaseSensitive bool        `json:"case_sensitive"`
			Include       string      `json:"include"`
			Glob          string      `json:"glob"`
			FilesOnly     bool        `json:"files_only"`
			MaxResults    interface{} `json:"max_results"`
		}
		_ = parseJSONBody(r, &req)

		includeGlob := req.Include
		if includeGlob == "" {
			includeGlob = req.Glob
		}

		maxRes := int(parseNumber(req.MaxResults, 50.0))

		res, err := ExecuteCodeGrep(
			req.Query,
			req.Path,
			req.IsRegex,
			req.CaseSensitive,
			includeGlob,
			req.FilesOnly,
			maxRes,
		)
		if err != nil {
			sendJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		sendJSON(w, http.StatusOK, res)
		return
	}

	// 10. Direct Python execution: POST /api/python/run
	if r.Method == http.MethodPost && path == "/api/python/run" {
		var req struct {
			Code         string      `json:"code"`
			Timeout      interface{} `json:"timeout"`
			Cwd          string      `json:"cwd"`
			ScratchDir   string      `json:"scratch_dir"`
			ArtifactsDir string      `json:"artifacts_dir"`
		}
		_ = parseJSONBody(r, &req)

		timeoutSec := int(parseNumber(req.Timeout, 30.0))
		res, err := ExecutePythonCode(req.Code, timeoutSec, req.Cwd, req.ScratchDir, req.ArtifactsDir)
		if err != nil {
			sendJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		sendJSON(w, http.StatusOK, res)
		return
	}

	sendJSON(w, http.StatusNotFound, map[string]string{"error": "Endpoint not found"})
}

func parseNumber(val interface{}, def float64) float64 {
	if val == nil {
		return def
	}
	switch v := val.(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case string:
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return def
}

func main() {
	port := flag.Int("port", 5000, "Server port (default: 5000)")
	host := flag.String("host", "127.0.0.1", "Server host (default: 127.0.0.1)")
	sock := flag.String("socket", "", "Unix domain socket path (overrides --port/--host)")
	flag.Parse()

	fmt.Println("[TASK SERVER GO] MultiAI High-Performance Task Daemon v1.0")
	fmt.Printf("[TASK SERVER GO] Runtime: %s/%s\n", os.Getenv("GOOS"), os.Getenv("GOARCH"))

	mux := http.NewServeMux()
	mux.HandleFunc("/", handleRoutes)

	server := &http.Server{
		Handler: mux,
	}

	if *sock != "" {
		sockPath, err := filepath.Abs(*sock)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[TASK SERVER GO ERROR] Invalid socket path: %v\n", err)
			os.Exit(1)
		}

		sockDir := filepath.Dir(sockPath)
		if sockDir != "" {
			_ = os.MkdirAll(sockDir, 0755)
		}
		_ = os.Remove(sockPath)

		listener, err := net.Listen("unix", sockPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[TASK SERVER GO ERROR] Failed to bind unix socket %s: %v\n", sockPath, err)
			os.Exit(1)
		}
		_ = os.Chmod(sockPath, 0777)

		fmt.Printf("[TASK SERVER GO] Listening on unix://%s\n", sockPath)

		// Clean up socket on termination
		c := make(chan os.Signal, 1)
		signal.Notify(c, os.Interrupt, syscall.SIGTERM)
		go func() {
			<-c
			fmt.Println("\n[TASK SERVER GO] Shutting down cleanly...")
			_ = listener.Close()
			_ = os.Remove(sockPath)
			os.Exit(0)
		}()

		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "[TASK SERVER GO ERROR] %v\n", err)
			os.Exit(1)
		}
	} else {
		addr := fmt.Sprintf("%s:%d", *host, *port)
		server.Addr = addr
		fmt.Printf("[TASK SERVER GO] Listening on http://%s\n", addr)

		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "[TASK SERVER GO ERROR] %v\n", err)
			os.Exit(1)
		}
	}
}
