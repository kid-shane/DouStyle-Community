#!/usr/bin/env python3
"""Build the Windows x64 portable preview without touching the macOS release."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import struct
import subprocess
import tarfile
import zipfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / '.cache' / 'windows-build'
MODULES = [
    'doubao-target.mjs', 'skin-model.mjs', 'skin-runtime.mjs', 'skin-ui.mjs',
    'skin-ui.css', 'skin-cli.mjs', 'skin-workshop.mjs', 'skin-workshop-ui.mjs',
    'injector.mjs', 'composer-clean-input.mjs', 'theme-appearance.mjs',
    'update-ui.mjs', 'update-bridge.mjs', 'theme.css', 'appearance.json',
]


def sha256(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def download(url, name, checksum):
    CACHE.mkdir(parents=True, exist_ok=True)
    target = CACHE / name
    if target.exists() and sha256(target) == checksum:
        return target
    temporary = target.with_suffix(target.suffix + '.part')
    subprocess.run(['curl', '-fLsS', '--connect-timeout', '15', '--max-time', '240', url, '-o', str(temporary)], check=True)
    if sha256(temporary) != checksum:
        temporary.unlink()
        raise RuntimeError('官方依赖的 SHA-256 校验不一致：' + name)
    temporary.replace(target)
    return target


def windows_pe(file):
    with file.open('rb') as stream:
        if stream.read(2) != b'MZ':
            raise RuntimeError('不是 Windows 可执行文件：' + file.name)
        stream.seek(0x3c)
        stream.seek(struct.unpack('<I', stream.read(4))[0])
        if stream.read(4) != b'PE\0\0' or struct.unpack('<H', stream.read(2))[0] != 0x8664:
            raise RuntimeError('不是 Windows x64 可执行文件：' + file.name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', default=(ROOT / 'VERSION').read_text().strip() + '-windows-test.1')
    args = parser.parse_args()
    if not re.fullmatch(r'\d+\.\d+\.\d+-windows-test\.\d+', args.version):
        raise RuntimeError('测试版本应为 x.y.z-windows-test.n')
    dependencies = json.loads((ROOT / 'windows' / 'dependencies.json').read_text())
    node = dependencies['node']
    archive = download('https://nodejs.org/dist/' + node['version'] + '/' + node['filename'], node['filename'], node['sha256'])
    go = shutil.which('go')
    if not go:
        host = platform.system().lower() + '-' + {'aarch64': 'arm64', 'arm64': 'arm64', 'x86_64': 'amd64'}.get(platform.machine(), platform.machine())
        specification = dependencies['go'].get(host)
        if not specification:
            raise RuntimeError('请先安装 Go；当前仅为 darwin-arm64 自动下载固定编译器。')
        tar = download('https://go.dev/dl/' + specification['filename'], specification['filename'], specification['sha256'])
        toolchain = CACHE / dependencies['go']['version']
        go = str(toolchain / 'go' / 'bin' / 'go')
        if not Path(go).exists():
            toolchain.mkdir(exist_ok=True)
            with tarfile.open(tar) as source:
                source.extractall(toolchain, filter='data')
    output = ROOT / 'build' / 'windows-preview' / args.version
    package = output / 'DouStyle'
    if output.exists():
        raise RuntimeError('构建目录已存在，请使用新的测试版本，避免覆盖已有包：' + str(output))
    (package / 'theme').mkdir(parents=True)
    (package / 'runtime').mkdir()
    (package / 'windows').mkdir()
    for name in MODULES:
        shutil.copy2(ROOT / name, package / 'theme' / name)
    for name in ['themes', 'skins', 'skills', 'assets']:
        shutil.copytree(ROOT / name, package / 'theme' / name, ignore=shutil.ignore_patterns('.DS_Store', '__pycache__'))
    for notice in ['LICENSE', 'THIRD_PARTY_NOTICES.md']:
        shutil.copy2(ROOT / notice, package / notice)
    shutil.copy2(ROOT / 'windows' / 'launcher.mjs', package / 'windows' / 'launcher.mjs')
    (package / 'VERSION').write_text(args.version + '\n', encoding='utf-8')
    with zipfile.ZipFile(archive) as source:
        prefix = 'node-' + node['version'] + '-win-x64/'
        for name, destination in [('node.exe', 'node.exe'), ('LICENSE', 'NODE-LICENSE.txt')]:
            (package / 'runtime' / destination).write_bytes(source.read(prefix + name))
    environment = {**os.environ, 'GOOS': 'windows', 'GOARCH': 'amd64', 'CGO_ENABLED': '0', 'GOTOOLCHAIN': 'local', 'GOCACHE': str(CACHE / 'gocache')}
    subprocess.run([go, 'build', '-trimpath', '-ldflags=-s -w -H=windowsgui -buildid=', '-o', str(package / '豆Style.exe'), str(ROOT / 'windows' / 'host_windows.go')], check=True, cwd=ROOT, env=environment)
    windows_pe(package / '豆Style.exe')
    windows_pe(package / 'runtime' / 'node.exe')
    readme = '''豆Style · Windows x64 测试版

版本：{version}
这是首次 Windows 测试包，尚未完成 Windows 实机验收。适用于 Windows 10/11 x64；ARM64 和 32 位系统不在本次测试范围。

使用：
1. 完整解压 ZIP 到本地文件夹，不要在压缩包内直接运行，也不要单独移动 EXE。
2. 保存当前工作，并从系统托盘正常退出豆包工作。
3. 双击「豆Style.exe」。会自动查找并启动豆包；若找不到，请选择已安装豆包的主程序 EXE，不能选安装包。
4. 在侧栏「豆包 工作」标题右侧点击彩色花瓣，或按 Ctrl + Alt + , 打开设置。

请测试：七套 Style 切换、修改排版与欢迎页、重启后设置保留、Windows XP 完整皮肤导入/导出及恢复、清爽输入开关。

退出与恢复：先从系统托盘退出豆包；约 15 秒后豆Style会退出。以后从原来的豆包图标启动，即恢复原生外观。卸载只需删除此文件夹。
本测试版不安装系统字体、不修改豆包程序文件，不接入 Mac 自动更新。更新时下载新测试包并重新解压。
没有 Windows 代码签名，系统可能显示未知发布者；是否运行由你根据此测试包来源判断。

如启动失败：窗口会给出原因。日志位置：%LOCALAPPDATA%\\DouStyle\\logs\\windows-test.log。
也可双击「诊断启动.cmd」查看即时错误。反馈时可提供报错截图、豆包版本、Windows 版本和日志；日志不记录聊天正文。

构建信息和文件校验见 BUILD-INFO.json 与 MANIFEST.sha256。
'''.format(version=args.version)
    (package / '使用说明.txt').write_text(readme.replace('\n', '\r\n'), encoding='utf-8-sig')
    diagnostic = '@echo off\nchcp 65001 >nul\ncd /d "%~dp0"\n"%~dp0runtime\\node.exe" "%~dp0windows\\launcher.mjs"\nif errorlevel 1 pause\n'
    (package / '诊断启动.cmd').write_bytes(diagnostic.replace('\n', '\r\n').encode('utf-8'))
    build_info = {
        'product': 'DouStyle', 'version': args.version, 'platform': 'win32', 'arch': 'x64',
        'builtAt': datetime.now(timezone.utc).isoformat(),
        'sourceRevision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'sourceIncludesLocalWindowsAdaptations': True,
        'nodeVersion': node['version'], 'nodeArchiveSHA256': node['sha256'],
        'automaticUpdates': False, 'codeSigned': False, 'windowsRuntimeVerified': False,
    }
    (package / 'BUILD-INFO.json').write_text(json.dumps(build_info, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    manifest = '\n'.join(sha256(file) + '  ' + file.relative_to(package).as_posix() for file in sorted(package.rglob('*')) if file.is_file()) + '\n'
    (package / 'MANIFEST.sha256').write_text(manifest, encoding='utf-8')
    distribution = ROOT / 'dist'
    distribution.mkdir(exist_ok=True)
    destination = distribution / ('DouStyle-' + args.version + '-windows-x64.zip')
    if destination.exists():
        raise RuntimeError('发布文件已存在，不覆盖：' + str(destination))
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zipped:
        for file in sorted(package.rglob('*')):
            if file.is_file():
                zipped.write(file, file.relative_to(output))
    checksum = destination.with_suffix('.zip.sha256')
    checksum.write_text(sha256(destination) + '  ' + destination.name + '\n', encoding='utf-8')
    print(json.dumps({'artifact': str(destination), 'sha256': sha256(destination), 'bytes': destination.stat().st_size, 'windowsRuntimeVerified': False}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
