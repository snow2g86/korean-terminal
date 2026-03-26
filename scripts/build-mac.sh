#!/bin/bash
# 한텀 macOS 빌드 스크립트
# electron-builder 대신 로컬 Electron 바이너리 수동 패키징
# (macOS 26 Tahoe에서 electron-builder 바이너리 크래시 우회)

set -e
cd "$(dirname "$0")/.."

APP_NAME="한텀"
BUNDLE_ID="com.hanterm"
VERSION="1.0.0"
DIST="dist/${APP_NAME}.app"
ELECTRON_APP="node_modules/electron/dist/Electron.app"

echo "=== 한텀 macOS 빌드 ==="

# 클린
rm -rf "$DIST"

# Electron.app 복사
echo "[1/5] Electron 복사..."
cp -R "$ELECTRON_APP" "$DIST"
mv "$DIST/Contents/MacOS/Electron" "$DIST/Contents/MacOS/${APP_NAME}"

# 리소스 교체
echo "[2/5] 리소스 복사..."
rm -rf "$DIST/Contents/Resources/default_app.asar"
mkdir -p "$DIST/Contents/Resources/app"
cp main.js preload.js package.json "$DIST/Contents/Resources/app/"
cp -R src "$DIST/Contents/Resources/app/"

# node_modules (devDependencies 제외)
echo "[3/5] node_modules 복사..."
rsync -a \
  --exclude='electron' \
  --exclude='electron-builder' \
  --exclude='@electron/rebuild' \
  --exclude='.cache' \
  node_modules "$DIST/Contents/Resources/app/"

# 아이콘
cp build/icon.icns "$DIST/Contents/Resources/electron.icns"
cp build/icon.icns "$DIST/Contents/Resources/icon.icns"

# Info.plist 수정
echo "[4/5] Info.plist 업데이트..."
plutil -replace CFBundleName -string "$APP_NAME" "$DIST/Contents/Info.plist"
plutil -replace CFBundleDisplayName -string "$APP_NAME" "$DIST/Contents/Info.plist"
plutil -replace CFBundleIdentifier -string "$BUNDLE_ID" "$DIST/Contents/Info.plist"
plutil -replace CFBundleExecutable -string "$APP_NAME" "$DIST/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$DIST/Contents/Info.plist"

# 코드 서명
echo "[5/5] 코드 서명..."
codesign --force --deep --sign - "$DIST"

SIZE=$(du -sh "$DIST" | cut -f1)
echo "=== 빌드 완료: $DIST ($SIZE) ==="
