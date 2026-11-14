# Builds the Android development build (a debug APK with expo-dev-client) on
# this PC and, if a phone is connected over USB, installs it.
#
#   powershell -ExecutionPolicy Bypass -File scripts\build-dev-android.ps1
#
# Needed again only when something native changes: a package with native code
# is added or upgraded, app.json's plugins/permissions change, or package.json's
# "reanimated" > "staticFeatureFlags" do (they're compiled in). Day to day,
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

# The native project is generated from app.json and not kept in git. Every
# run, like the release build: a changed plugin or permission has to reach
# android/ before Gradle builds it.
Set-Location $project
npx expo prebuild --platform android --no-install
if ($LASTEXITCODE -ne 0) { throw "expo prebuild failed" }

# The C++ build needs a ninja that can handle Windows paths over 260
# characters (gesture-handler 3's generated files reach ~340): the one that
# comes with the SDK's CMake 3.30+, as in build-release-android.ps1. The
# default CMake 3.22.1 fails with "Filename longer than 260 characters"
# (seen 2026-11-13). Prebuild regenerates android/, so this is written after it.
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "D:\Documents\Sdk" }
$cmake = Get-ChildItem (Join-Path $sdk "cmake") -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' -and [version]$_.Name -ge [version]"3.30.0" } |
  Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $cmake) { throw "Install CMake 3.30 or newer from the Android SDK (sdkmanager `"cmake;3.31.6`") - 3.22.1's ninja can't handle long paths" }
$localProps = Join-Path $project "android\local.properties"
$kept = @()
if (Test-Path $localProps) { $kept = @(Get-Content $localProps | Where-Object { $_ -notmatch '^cmake\.dir=' }) }
$kept + "cmake.dir=$($cmake.FullName.Replace('\', '\\').Replace(':', '\:'))" | Set-Content $localProps -Encoding ascii

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
