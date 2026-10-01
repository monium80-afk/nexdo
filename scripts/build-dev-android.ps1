# Builds the Android development build (a debug APK with expo-dev-client) on
# this PC and, if a phone is connected over USB, installs it.
#
#   powershell -ExecutionPolicy Bypass -File scripts\build-dev-android.ps1
#
# Needed again only when something native changes: a package with native code
# is added or upgraded, or app.json's plugins/permissions change. Day to day,
# `npx expo start` and the installed app are enough.
#
# Java comes from Android Studio (there is no JAVA_HOME on this PC), and
# Gradle's caches and temp files go to D: because C: has no room for them.

$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $PSScriptRoot
$cache = Join-Path (Split-Path -Parent $project) ".build-cache"

$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:GRADLE_USER_HOME = Join-Path $cache "gradle"
$env:TEMP = Join-Path $cache "tmp"
$env:TMP = $env:TEMP
$env:NODE_ENV = "development"
New-Item -ItemType Directory -Force $env:GRADLE_USER_HOME, $env:TEMP | Out-Null

Set-Location $project
if (-not (Test-Path "android\gradlew.bat")) {
  # The native project is generated from app.json; it is not kept in git.
  npx expo prebuild --platform android --no-install
}

Set-Location (Join-Path $project "android")
# Phones only (32- and 64-bit ARM): leaving out the emulator builds roughly halves the time.
.\gradlew.bat assembleDebug "-PreactNativeArchitectures=armeabi-v7a,arm64-v8a"
if ($LASTEXITCODE -ne 0) { throw "Gradle build failed" }

$apk = Join-Path $project "android\app\build\outputs\apk\debug\app-debug.apk"
Write-Host "Built: $apk"

$devices = (adb devices) | Select-String -Pattern "\tdevice$"
if ($devices) {
  adb install -r $apk
  Write-Host "Installed. Start the app with: npx expo start"
} else {
  Write-Host "No phone connected over USB. Connect it (USB debugging on) and run: adb install -r `"$apk`""
}
