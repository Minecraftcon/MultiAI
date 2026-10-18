package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

type TaskItem struct {
	ID        string
	Command   string
	StartTime float64
	Cmd       *exec.Cmd
	Stdin     io.WriteCloser
	stdoutBuf bytes.Buffer
	stderrBuf bytes.Buffer
	mu        sync.Mutex
	running   bool
	exitCode  *int
	doneChan  chan struct{}
}

type TaskOutput struct {
	TaskID         string  `json:"task_id"`
	Running        bool    `json:"running"`
	ExitCode       *int    `json:"exit_code"`
	Stdout         string  `json:"stdout"`
	Stderr         string  `json:"stderr"`
	Status         string  `json:"status,omitempty"`
	ElapsedSeconds float64 `json:"elapsed_seconds,omitempty"`
	Reason         string  `json:"reason,omitempty"`
	Error          string  `json:"error,omitempty"`
}

type TaskSummary struct {
	Running   bool    `json:"running"`
	ExitCode  *int    `json:"exit_code"`
	Command   string  `json:"command"`
	StartTime float64 `json:"start_time"`
}

type TaskManager struct {
	tasks map[string]*TaskItem
	mu    sync.RWMutex
}

func NewTaskManager() *TaskManager {
	return &TaskManager{
		tasks: make(map[string]*TaskItem),
	}
}

func generateTaskID() string {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%08x", time.Now().UnixNano()&0xFFFFFFFF)
	}
	return hex.EncodeToString(b)
}

func (m *TaskManager) RunTask(command, shellOverride, scratchDir, artifactsDir, cwd string) (string, error) {
	taskID := generateTaskID()

	targetCwd := cwd
	if targetCwd == "" {
		targetCwd = os.Getenv("MULTIAI_WORKSPACE_DIR")
	}
	if targetCwd == "" {
		targetCwd, _ = os.Getwd()
	}

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		shell := shellOverride
		if shell == "" {
			shell = "cmd.exe"
		}
		cmd = exec.Command(shell, "/c", command)
	} else {
		shell := shellOverride
		if shell == "" {
			shell = "/bin/sh"
			if _, err := os.Stat(shell); err != nil {
				shell = "sh"
			}
		}
		cmd = exec.Command(shell, "-c", command)
	}

	cmd.Dir = targetCwd

	// Inherit environment and augment with MultiAI variables
	env := os.Environ()
	env = append(env, "PYTHONUNBUFFERED=1")
	env = append(env, "TERM=xterm-256color")
	if scratchDir != "" {
		env = append(env, "SCRATCH="+scratchDir, "SCRATCH_DIR="+scratchDir)
	}
	if artifactsDir != "" {
		env = append(env, "ARTIFACTS="+artifactsDir, "ARTIFACTS_DIR="+artifactsDir)
	}
	cmd.Env = env

	setProcessGroup(cmd)

	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		return "", fmt.Errorf("failed to create stdin pipe: %w", err)
	}

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return "", fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return "", fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("failed to start command: %w", err)
	}

	item := &TaskItem{
		ID:        taskID,
		Command:   command,
		StartTime: float64(time.Now().UnixNano()) / 1e9,
		Cmd:       cmd,
		Stdin:     stdinPipe,
		running:   true,
		doneChan:  make(chan struct{}),
	}

	m.mu.Lock()
	m.tasks[taskID] = item
	m.mu.Unlock()

	// Stream stdout
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stdoutPipe.Read(buf)
			if n > 0 {
				item.mu.Lock()
				item.stdoutBuf.Write(buf[:n])
				item.mu.Unlock()
			}
			if err != nil {
				break
			}
		}
	}()

	// Stream stderr
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stderrPipe.Read(buf)
			if n > 0 {
				item.mu.Lock()
				item.stderrBuf.Write(buf[:n])
				item.mu.Unlock()
			}
			if err != nil {
				break
			}
		}
	}()

	// Wait for process completion
	go func() {
		err := cmd.Wait()
		item.mu.Lock()
		item.running = false
		exitCode := 0
		if err != nil {
			var exitErr *exec.ExitError
			if errors.As(err, &exitErr) {
				exitCode = exitErr.ExitCode()
			} else {
				exitCode = 1
			}
		}
		item.exitCode = &exitCode
		close(item.doneChan)
		item.mu.Unlock()
	}()

	return taskID, nil
}

func (m *TaskManager) GetOutput(taskID string) (TaskOutput, error) {
	m.mu.RLock()
	item, exists := m.tasks[taskID]
	m.mu.RUnlock()

	if !exists {
		return TaskOutput{Error: fmt.Sprintf("Task %s not found.", taskID)}, fmt.Errorf("task not found")
	}

	item.mu.Lock()
	defer item.mu.Unlock()

	stdoutStr := item.stdoutBuf.String()
	item.stdoutBuf.Reset()

	stderrStr := item.stderrBuf.String()
	item.stderrBuf.Reset()

	return TaskOutput{
		TaskID:   taskID,
		Running:  item.running,
		ExitCode: item.exitCode,
		Stdout:   stdoutStr,
		Stderr:   stderrStr,
	}, nil
}

func (m *TaskManager) WaitForTask(taskID string, timeoutSec float64) TaskOutput {
	m.mu.RLock()
	item, exists := m.tasks[taskID]
	m.mu.RUnlock()

	if !exists {
		return TaskOutput{Error: fmt.Sprintf("Task %s not found.", taskID)}
	}

	timeoutDuration := time.Duration(timeoutSec * float64(time.Second))
	if timeoutDuration < 50*time.Millisecond {
		timeoutDuration = 50 * time.Millisecond
	}

	select {
	case <-item.doneChan:
		// Process completed
		time.Sleep(20 * time.Millisecond) // flush remaining pipe output
	case <-time.After(timeoutDuration):
		// Timeout reached
	}

	out, _ := m.GetOutput(taskID)
	return out
}

func (m *TaskManager) SendInput(taskID, inputString, inputType, combination string, pressEnter bool) (map[string]interface{}, error) {
	m.mu.RLock()
	item, exists := m.tasks[taskID]
	m.mu.RUnlock()

	if !exists {
		return map[string]interface{}{"error": fmt.Sprintf("Task %s not found.", taskID)}, fmt.Errorf("task not found")
	}

	combo := strings.TrimSpace(strings.ToLower(combination))
	combo = strings.ReplaceAll(combo, "control", "ctrl")
	combo = strings.ReplaceAll(combo, " ", "")

	if combo == "ctrl+c" || combo == "ctrl-c" {
		if item.Cmd != nil && item.Cmd.Process != nil {
			_ = sendInterrupt(item.Cmd.Process.Pid)
		}
		return map[string]interface{}{"status": "signal_sent", "task_id": taskID, "signal": "SIGINT"}, nil
	}

	if combo == "ctrl+z" || combo == "ctrl-z" {
		if item.Cmd != nil && item.Cmd.Process != nil {
			_ = sendStop(item.Cmd.Process.Pid)
		}
		return map[string]interface{}{"status": "signal_sent", "task_id": taskID, "signal": "SIGTSTP"}, nil
	}

	if combo == "ctrl+d" || combo == "ctrl-d" {
		if item.Stdin != nil {
			_, _ = item.Stdin.Write([]byte{4})
		}
		return map[string]interface{}{"status": "input_sent", "task_id": taskID}, nil
	}

	if combo == "enter" || combo == "return" {
		if item.Stdin != nil {
			_, _ = item.Stdin.Write([]byte("\n"))
		}
		return map[string]interface{}{"status": "input_sent", "task_id": taskID}, nil
	}

	// Normal text / input string
	if item.Stdin != nil {
		toWrite := inputString
		if pressEnter && !strings.HasSuffix(toWrite, "\n") {
			toWrite += "\n"
		}
		_, err := item.Stdin.Write([]byte(toWrite))
		if err != nil {
			return map[string]interface{}{"error": err.Error()}, err
		}
	}

	return map[string]interface{}{"status": "input_sent", "task_id": taskID}, nil
}

func (m *TaskManager) KillTask(taskID string) (map[string]interface{}, error) {
	m.mu.RLock()
	item, exists := m.tasks[taskID]
	m.mu.RUnlock()

	if !exists {
		return map[string]interface{}{"error": fmt.Sprintf("Task %s not found.", taskID)}, fmt.Errorf("task not found")
	}

	if item.Cmd != nil && item.Cmd.Process != nil && item.running {
		_ = terminateProcess(item.Cmd.Process.Pid)
		go func() {
			time.Sleep(250 * time.Millisecond)
			item.mu.Lock()
			defer item.mu.Unlock()
			if item.running && item.Cmd != nil && item.Cmd.Process != nil {
				_ = killProcess(item.Cmd.Process.Pid)
			}
		}()
	}

	return map[string]interface{}{"status": "killed", "task_id": taskID}, nil
}

func (m *TaskManager) ListTasks() map[string]TaskSummary {
	m.mu.RLock()
	defer m.mu.RUnlock()

	res := make(map[string]TaskSummary)
	for id, item := range m.tasks {
		item.mu.Lock()
		res[id] = TaskSummary{
			Running:   item.running,
			ExitCode:  item.exitCode,
			Command:   item.Command,
			StartTime: item.StartTime,
		}
		item.mu.Unlock()
	}
	return res
}

func (m *TaskManager) CleanFinished() int {
	m.mu.Lock()
	defer m.mu.Unlock()

	cleaned := 0
	for id, item := range m.tasks {
		item.mu.Lock()
		isDone := !item.running
		item.mu.Unlock()
		if isDone {
			delete(m.tasks, id)
			cleaned++
		}
	}
	return cleaned
}

func (m *TaskManager) Idle(seconds float64, taskID, wakeOn, reason string) map[string]interface{} {
	if seconds < 0.1 {
		seconds = 0.1
	} else if seconds > 300.0 {
		seconds = 300.0
	}

	startTime := time.Now()
	timeoutDur := time.Duration(seconds * float64(time.Second))
	deadline := startTime.Add(timeoutDur)

	if taskID != "" {
		m.mu.RLock()
		item, exists := m.tasks[taskID]
		m.mu.RUnlock()

		if exists {
			for time.Now().Before(deadline) {
				item.mu.Lock()
				isDead := !item.running
				hasOutput := item.stdoutBuf.Len() > 0 || item.stderrBuf.Len() > 0
				item.mu.Unlock()

				if (wakeOn == "exit" || wakeOn == "any") && isDead {
					time.Sleep(20 * time.Millisecond)
					out, _ := m.GetOutput(taskID)
					return map[string]interface{}{
						"task_id":         taskID,
						"running":         out.Running,
						"exit_code":       out.ExitCode,
						"stdout":          out.Stdout,
						"stderr":          out.Stderr,
						"status":          "task_completed",
						"elapsed_seconds": roundFloat(time.Since(startTime).Seconds(), 2),
						"reason":          reason,
					}
				}

				if (wakeOn == "output" || wakeOn == "any") && hasOutput {
					time.Sleep(20 * time.Millisecond)
					out, _ := m.GetOutput(taskID)
					return map[string]interface{}{
						"task_id":         taskID,
						"running":         out.Running,
						"exit_code":       out.ExitCode,
						"stdout":          out.Stdout,
						"stderr":          out.Stderr,
						"status":          "task_output",
						"elapsed_seconds": roundFloat(time.Since(startTime).Seconds(), 2),
						"reason":          reason,
					}
				}

				time.Sleep(30 * time.Millisecond)
			}

			out, _ := m.GetOutput(taskID)
			return map[string]interface{}{
				"task_id":         taskID,
				"running":         out.Running,
				"exit_code":       out.ExitCode,
				"stdout":          out.Stdout,
				"stderr":          out.Stderr,
				"status":          "timer_expired",
				"elapsed_seconds": roundFloat(time.Since(startTime).Seconds(), 2),
				"reason":          reason,
			}
		}
	}

	time.Sleep(timeoutDur)
	return map[string]interface{}{
		"status":          "timer_expired",
		"elapsed_seconds": roundFloat(time.Since(startTime).Seconds(), 2),
		"reason":          reason,
	}
}

func roundFloat(val float64, precision int) float64 {
	ratio := 1.0
	for i := 0; i < precision; i++ {
		ratio *= 10.0
	}
	return float64(int(val*ratio+0.5)) / ratio
}
