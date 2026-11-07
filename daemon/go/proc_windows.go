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

func sendInterrupt(pid int) error {
	return killProcess(pid)
}

func sendStop(pid int) error {
	return killProcess(pid)
}

func terminateProcess(pid int) error {
	return killProcess(pid)
}

func killProcess(pid int) error {
	killCmd := exec.Command("taskkill", "/PID", strconv.Itoa(pid), "/T", "/F")
	return killCmd.Run()
}
