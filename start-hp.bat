@echo off
setlocal
cd /d "%~dp0"
title Catalytech SIGAP - akses dari HP
echo.
echo  === Catalytech SIGAP - pantau dari HP ===
echo.
echo   1. HP di Wi-Fi yang sama dengan laptop  (jaringan rumah / Private)
echo   2. Lewat internet, dari jaringan mana pun  (Cloudflare Tunnel)
echo.
choice /c 12 /n /m "  Pilih 1 atau 2: "
if errorlevel 2 goto :tunnel

rem ------------------------------------------------------------------ 1. same Wi-Fi
echo.
echo  Buka salah satu alamat ini di browser HP (HP harus di Wi-Fi yang sama):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=*" %%b in ("%%a") do echo     http://%%b:8000
echo.
echo  Jika HP tidak bisa membuka:
echo   - Saat Windows bertanya "Allow access", centang "Private networks" lalu Allow.
echo   - Jaringan Wi-Fi harus berstatus Private (Settings ^> Network ^> Wi-Fi ^> Network profile type).
echo     Jangan ubah ke Private di Wi-Fi umum (kampus/kafe); pakai pilihan 2.
echo   - Beberapa Wi-Fi umum memblokir antar-perangkat; pakai pilihan 2 atau hotspot HP.
echo.
set HOST=0.0.0.0
call start.bat
goto :eof

rem ------------------------------------------------------------------ 2. Cloudflare quick tunnel
:tunnel
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo.
  echo  cloudflared belum terpasang. Pasang sekali dengan perintah ini, lalu jalankan start-hp.bat lagi:
  echo.
  echo     winget install --id Cloudflare.cloudflared
  echo.
  pause
  exit /b 1
)
echo.
echo  Server dijalankan di jendela terpisah. Tunggu baris berisi alamat
echo     https://....trycloudflare.com
echo  lalu buka alamat itu di browser HP. Alamat berubah setiap kali tunnel dijalankan.
echo.
echo  PERHATIAN: siapa pun yang tahu alamat itu bisa membuka dan mengendalikan dashboard (belum ada login).
echo  Bagikan hanya ke tim, dan tutup jendela ini setelah selesai. Jika asisten RCA aktif, orang lain
echo  yang membuka alamat itu juga ikut memakai GPU komputer ini, jadi dashboard bisa terasa lambat.
echo.
start "Catalytech SIGAP - server" cmd /k call start.bat
timeout /t 8 /nobreak >nul
cloudflared tunnel --url http://localhost:8000
