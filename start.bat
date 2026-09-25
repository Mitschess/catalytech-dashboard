@echo off
setlocal
cd /d "%~dp0"
title Catalytech SIGAP
echo.
echo  === Catalytech SIGAP - Intelligent Manufacturing Dashboard ===
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo  Python 3.11 atau lebih baru belum terpasang. Unduh dari https://www.python.org/downloads/
  pause
  exit /b 1
)

if not exist "backend\.venv\Scripts\python.exe" (
  echo  [1/3] Menyiapkan lingkungan Python ^(sekali saja, 1-3 menit^)...
  python -m venv backend\.venv || goto :fail
  backend\.venv\Scripts\python.exe -m pip install --upgrade pip -q
  backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt -q || goto :fail
) else (
  echo  [1/3] Lingkungan Python sudah siap.
)

if not exist "frontend\dist\index.html" (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo  Node.js belum terpasang. Unduh versi LTS dari https://nodejs.org/
    pause
    exit /b 1
  )
  echo  [2/3] Membangun tampilan dashboard ^(sekali saja^)...
  pushd frontend
  call npm install --no-audit --no-fund || (popd & goto :fail)
  call npm run build || (popd & goto :fail)
  popd
) else (
  echo  [2/3] Tampilan dashboard sudah dibangun.
)

echo  [3/3] Menjalankan server. Dashboard terbuka di http://localhost:8000
echo        Tutup jendela ini ^(atau tekan Ctrl+C^) untuk menghentikan server.
echo.
start "" http://localhost:8000
cd backend
.venv\Scripts\python.exe run.py
goto :eof

:fail
echo.
echo  Gagal menyiapkan aplikasi. Baca pesan error di atas.
pause
exit /b 1
