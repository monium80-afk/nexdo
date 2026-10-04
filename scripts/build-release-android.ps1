# Builds the signed Android App Bundle (.aab) for Google Play on this PC.
#
#   powershell -ExecutionPolicy Bypass -File scripts\build-release-android.ps1
#
# Before each new upload to Play, raise "android" > "versionCode" in app.json
# (Play refuses a versionCode it has already seen) and, for a user-visible
# release, "version" too.
#
# Signing uses the upload key in D:\Nexdo\android-signing (outside git — back
# that folder up). It is passed to Gradle as the same "injected" signing
# properties Android Studio uses, so the generated android/ folder needs no
# edits and survives `expo prebuild --clean`.
#
# The JS bundle reads .env like `expo start` does; EXPO_PUBLIC_API_URL is set
# here so the app talks to the hosted server (https://nexdo.expo.app) instead
# of a dev server. Release builds ignore the RevenueCat test_ key
# (lib/purchases.ts), so without EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY in
# .env Nexdo Pro is simply hidden.

$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent $project
$cache = Join-Path $root ".build-cache"
$signing = Join-Path $root "android-signing"

$props = @{}
foreach ($line in Get-Content (Join-Path $signing "keystore.properties")) {
  if ($line -match '^\s*([^#=\s][^=]*?)\s*=\s*(.*)$') { $props[$Matches[1]] = $Matches[2] }
}
$keystore = Join-Path $signing $props.storeFile
if (-not (Test-Path $keystore)) { throw "Upload keystore not found: $keystore" }

$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:GRADLE_USER_HOME = Join-Path $cache "gradle"
$env:npm_config_cache = Join-Path $cache "npm"
$env:TEMP = Join-Path $cache "tmp"
$env:TMP = $env:TEMP
$env:NODE_ENV = "production"
$env:EXPO_NO_GIT_STATUS = "1"
$env:EXPO_PUBLIC_API_URL = "https://nexdo.expo.app"
New-Item -ItemType Directory -Force $env:GRADLE_USER_HOME, $env:npm_config_cache, $env:TEMP | Out-Null

# Brings the native project in line with app.json (versionCode, plugins).
Set-Location $project
npx expo prebuild --platform android --no-install
if ($LASTEXITCODE -ne 0) { throw "expo prebuild failed" }

Set-Location (Join-Path $project "android")
# Phones only (32- and 64-bit ARM), like the dev build: x86/x86_64 are for
# emulators and a few Chromebooks and would add a lot of native compile time.
.\gradlew.bat app:bundleRelease "-PreactNativeArchitectures=armeabi-v7a,arm64-v8a" `
  "-Pandroid.injected.signing.store.file=$keystore" `
  "-Pandroid.injected.signing.store.password=$($props.storePassword)" `
  "-Pandroid.injected.signing.key.alias=$($props.keyAlias)" `
  "-Pandroid.injected.signing.key.password=$($props.keyPassword)"
if ($LASTEXITCODE -ne 0) { throw "Gradle build failed" }

$aab = Join-Path $project "android\app\build\outputs\bundle\release\app-release.aab"
# Fails the script if the bundle was signed with anything but the upload key.
$cert = & "$env:JAVA_HOME\bin\keytool.exe" -printcert -jarfile $aab | Out-String
if ($cert -notmatch "CN=Nexdo") { throw "The bundle is not signed with the upload key:`n$cert" }

$config = Get-Content (Join-Path $project "app.json") -Raw | ConvertFrom-Json
$name = "nexdo-$($config.expo.version)-$($config.expo.android.versionCode).aab"
$releases = Join-Path $root "releases"
New-Item -ItemType Directory -Force $releases | Out-Null
Copy-Item $aab (Join-Path $releases $name) -Force
Write-Host "Built: $(Join-Path $releases $name)"
