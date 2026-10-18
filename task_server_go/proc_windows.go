//go:build windows

package main

import (
	"os/exec"
	"strconv"
	"syscall"
)

func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
}

func killProcessGroup(pid int, sig syscall.Signal) error {
	killCmd := exec.Command("taskkill", "/PID", strconv.Itoa(pid), "/T", "/F")
	return killCmd.Run()
}
