# roadSOS Capacitor wrapper

Wraps the Flask PWA in a real Android APK so we can call native
`FusedLocationProviderClient` (~3-5x more accurate than browser geolocation).

## Architecture

```
[ Android phone ]
   |  Capacitor APK
   |  WebView + native bridge -> @capacitor/geolocation -> FusedLocationProvider
   |
   v  http://<your-lan-ip>:5000
[ Laptop ]
   Flask + PWA + region cache + service worker
```

The APK is a thin shell. All UI / logic still lives in the Flask backend; the
APK just gives us a native bridge for GPS.

## One-time setup

```powershell
cd C:\Users\shash\OneDrive\Desktop\roadSOS\mobile
npm install
```

## Wire your LAN IP into the Capacitor config

Run this in PowerShell from the `mobile/` folder. It detects your active Wi-Fi
IP and patches `capacitor.config.json` automatically:

```powershell
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
       Where-Object { $_.PrefixOrigin -eq 'Dhcp' -and $_.IPAddress -like '192.168.*' } |
       Select-Object -First 1).IPAddress
if (-not $ip) { $ip = Read-Host "Couldn't auto-detect a LAN IP. Paste yours" }
(Get-Content capacitor.config.json) -replace '__LAN_IP__', $ip | Set-Content capacitor.config.json
echo "Patched capacitor.config.json with $ip"
```

After that, verify by `cat capacitor.config.json` and confirming `__LAN_IP__`
no longer appears.

## Add the Android platform (one-time, after install)

```powershell
npx cap add android
```

## Each time you change web code

The web code lives in `..\backend\app\static\` and `..\backend\app\templates\`.
When you change it, the Flask server reloads automatically — **you don't need
to rebuild the APK**. Just refresh the phone (pull to reload or close/reopen).

The only time you need to re-sync is when you change the Capacitor config or
a plugin:

```powershell
npx cap sync android
```

## Build + install on phone

```powershell
npx cap open android        # opens Android Studio
```

Then in Android Studio: select your phone in the device dropdown -> click the
green Run (Shift+F10).

To produce a shareable APK without Android Studio:

```powershell
cd android
.\gradlew.bat assembleDebug
# APK lands at: android\app\build\outputs\apk\debug\app-debug.apk
```

## Reminders before each demo

1. Flask must be running with `flask run --host=0.0.0.0` (binds to all interfaces).
2. Laptop and phone must be on the same Wi-Fi.
3. Windows firewall must allow inbound on TCP 5000 (one-time, admin):
   `New-NetFirewallRule -DisplayName "Flask dev 5000" -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow`

## When the WiFi changes

If your laptop gets a new LAN IP (after switching networks), re-run the patch
script above and `npx cap sync android` then rebuild. The IP is baked into
the APK.
