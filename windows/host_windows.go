//go:build windows

// A small native host; all styling stays in the shared Node/DOM implementation.
package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

func showError(message string) {
	text, _ := syscall.UTF16PtrFromString(message)
	title, _ := syscall.UTF16PtrFromString("豆Style · Windows 测试版")
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), 0x10)
}

func main() {
	executable, err := os.Executable()
	if err != nil {
		showError("无法确认程序位置，请重新解压完整测试包。")
		return
	}
	root := filepath.Dir(executable)
	node := filepath.Join(root, "runtime", "node.exe")
	launcher := filepath.Join(root, "windows", "launcher.mjs")
	for _, file := range []string{node, launcher, filepath.Join(root, "theme", "injector.mjs")} {
		if _, err := os.Stat(file); err != nil {
			showError("安装内容不完整。请先解压整个 ZIP，再双击豆Style.exe；不要只复制一个 EXE。")
			return
		}
	}
	command := exec.Command(node, launcher)
	command.Dir = root
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	var errors bytes.Buffer
	command.Stderr = &errors
	if err := command.Run(); err != nil {
		message := errors.String()
		if message == "" {
			message = fmt.Sprintf("启动组件未能运行：%v", err)
		}
		if len(message) > 12000 {
			message = message[len(message)-12000:]
		}
		showError(message)
	}
}
