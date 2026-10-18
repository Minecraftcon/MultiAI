//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func killProcessGroup(pid int, sig syscall.Signal) error {
	pgid, err := syscall.Getpgid(pid)
	if err == nil && pgid > 0 {
		return syscall.Kill(-pgid, sig)
	}
	return syscall.Kill(-pid, sig)
}
