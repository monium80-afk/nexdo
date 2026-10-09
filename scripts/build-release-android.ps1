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
# of a dev server. Nexdo Pro is sold through Google Play with RevenueCat's
# Google key (goog_…), which .env must have — the build stops without it.
# Release builds never read the Test Store key (lib/purchases.ts); once the
# bundle is built it is checked to hold the Google key and not the test one.

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

# .env's values, for the RevenueCat checks below. Nothing from it is printed.
$dotenv = @{}
foreach ($line in Get-Content (Join-Path $project ".env")) {
  if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$') { $dotenv[$Matches[1]] = $Matches[2] }
}
$googleKey = $dotenv["EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY"]
if (-not $googleKey -or -not $googleKey.StartsWith("goog_")) {
  throw "EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY in .env must be RevenueCat's Google Play key (goog_...)"
}
# Store builds sign people in to Clerk's production instance (clerk.getnexdo.app).
# A development key (pk_test_) would put real users in the test instance.
$clerkKey = $dotenv["EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY"]
if (-not $clerkKey -or -not $clerkKey.StartsWith("pk_live_")) {
  throw "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in .env must be Clerk's production key (pk_live_...)"
}

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

# The compiled JS must sell through Google Play, never the Test Store, and
# talk to the hosted server.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($aab)
try {
  $reader = New-Object System.IO.StreamReader($zip.GetEntry("base/assets/index.android.bundle").Open(), [System.Text.Encoding]::GetEncoding(28591))
  $js = $reader.ReadToEnd()
  $reader.Close()
} finally {
  $zip.Dispose()
}
if (-not $js.Contains($googleKey)) { throw "The bundle doesn't hold the RevenueCat Google key from .env" }
$testKey = $dotenv["EXPO_PUBLIC_REVENUECAT_TEST_API_KEY"]
if ($testKey -and $js.Contains($testKey)) { throw "The bundle holds the RevenueCat Test Store key - don't upload it" }
if (-not $js.Contains($env:EXPO_PUBLIC_API_URL)) { throw "The bundle doesn't point at $env:EXPO_PUBLIC_API_URL" }
if (-not $js.Contains($clerkKey)) { throw "The bundle doesn't hold Clerk's production key from .env" }

$config = Get-Content (Join-Path $project "app.json") -Raw | ConvertFrom-Json
$name = "nexdo-$($config.expo.version)-$($config.expo.android.versionCode).aab"
$releases = Join-Path $root "releases"
New-Item -ItemType Directory -Force $releases | Out-Null
Copy-Item $aab (Join-Path $releases $name) -Force
Write-Host "Built: $(Join-Path $releases $name)"
