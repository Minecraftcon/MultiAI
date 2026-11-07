//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func sendInterrupt(pid int) error {
	return killProcessGroup(pid, syscall.SIGINT)
}

func sendStop(pid int) error {
	return killProcessGroup(pid, syscall.SIGTSTP)
}

func terminateProcess(pid int) error {
	return killProcessGroup(pid, syscall.SIGTERM)
}

func killProcess(pid int) error {
	return killProcessGroup(pid, syscall.SIGKILL)
}

func killProcessGroup(pid int, sig syscall.Signal) error {
	pgid, err := syscall.Getpgid(pid)
	if err == nil && pgid > 0 {
		return syscall.Kill(-pgid, sig)
	}
	return syscall.Kill(-pid, sig)
}
