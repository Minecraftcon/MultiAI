package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

type PythonResult struct {
	Success        bool        `json:"success"`
	ExitCode       int         `json:"exit_code"`
	Stdout         string      `json:"stdout"`
	Stderr         string      `json:"stderr"`
	ReturnValue    interface{} `json:"return_value"`
	ElapsedSeconds float64     `json:"elapsed_seconds"`
}

func ExecutePythonCode(code string, timeoutSec int, cwd, scratchDir, artifactsDir string) (*PythonResult, error) {
	rawCode := strings.TrimSpace(code)
	if rawCode == "" {
		return &PythonResult{
			Success:        false,
			Stdout:         "",
			Stderr:         "Error: Provided Python code snippet is empty.",
			ReturnValue:    nil,
			ExitCode:       1,
			ElapsedSeconds: 0,
		}, nil
	}

	if timeoutSec <= 0 {
		timeoutSec = 30
	} else if timeoutSec > 300 {
		timeoutSec = 300
	}

	targetCwd := cwd
	if targetCwd == "" {
		targetCwd = scratchDir
	}
	if targetCwd == "" {
		targetCwd, _ = os.Getwd()
	}

	env := os.Environ()
	env = append(env, "PYTHONUNBUFFERED=1")
	if scratchDir != "" {
		env = append(env, "SCRATCH="+scratchDir, "SCRATCH_DIR="+scratchDir)
	}
	if artifactsDir != "" {
		env = append(env, "ARTIFACTS="+artifactsDir, "ARTIFACTS_DIR="+artifactsDir)
	}

	runnerScript := fmt.Sprintf(`
import sys
import ast
import traceback

raw_code = %q

try:
    parsed = ast.parse(raw_code)
    last_expr = None
    if parsed.body and isinstance(parsed.body[-1], ast.Expr):
        last_expr = parsed.body.pop()
    
    global_scope = {"__name__": "__main__"}
    exec(compile(parsed, "<multi_ai_exec>", "exec"), global_scope)
    
    if last_expr is not None:
        expr_val = eval(compile(ast.Expression(body=last_expr.value), "<multi_ai_eval>", "eval"), global_scope)
        if expr_val is not None:
            print("\n[EXPR_RESULT]:" + repr(expr_val))
except Exception:
    traceback.print_exc()
    sys.exit(1)
`, rawCode)

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	pythonBin := "python3"
	if runtime.GOOS == "windows" {
		pythonBin = "python"
	}
	if p := os.Getenv("PYTHON"); p != "" {
		pythonBin = p
	}

	cmd := exec.CommandContext(ctx, pythonBin, "-c", runnerScript)
	cmd.Dir = targetCwd
	cmd.Env = env

	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	startTime := time.Now()
	err := cmd.Run()
	elapsed := roundFloat(time.Since(startTime).Seconds(), 2)

	exitCode := 0
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return &PythonResult{
				Success:        false,
				ExitCode:       124,
				Stdout:         stdoutBuf.String(),
				Stderr:         fmt.Sprintf("Execution timed out after %d seconds", timeoutSec),
				ReturnValue:    nil,
				ElapsedSeconds: elapsed,
			}, nil
		}
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = 1
		}
	}

	stdoutRaw := stdoutBuf.String()
	stderrRaw := stderrBuf.String()
	var resultVal interface{} = nil

	if idx := strings.Index(stdoutRaw, "[EXPR_RESULT]:"); idx != -1 {
		resultVal = strings.TrimSpace(stdoutRaw[idx+len("[EXPR_RESULT]:"):])
		stdoutRaw = stdoutRaw[:idx]
	}

	return &PythonResult{
		Success:        exitCode == 0,
		ExitCode:       exitCode,
		Stdout:         stdoutRaw,
		Stderr:         stderrRaw,
		ReturnValue:    resultVal,
		ElapsedSeconds: elapsed,
	}, nil
}
