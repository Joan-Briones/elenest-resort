@echo off
cd /d "%~dp0"
echo Starting Elenest Resort Python API on http://127.0.0.1:5000
echo Optional: XAMPP can keep using /api/*.php (thin bridges into the same Python).
echo Keep this window open only if you call Flask directly.
echo.

set "PY="
where py >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%I in ('py -3 -c "import sys; print(sys.executable)" 2^>nul') do set "PY=%%I"
)
if not defined PY (
  where python >nul 2>&1
  if not errorlevel 1 (
    for /f "delims=" %%I in ('where python') do (
      echo %%I | find /i "\WindowsApps\" >nul
      if errorlevel 1 if not defined PY set "PY=%%I"
    )
  )
)
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python314\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python314\python.exe"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
if not defined PY if exist "C:\Python314\python.exe" set "PY=C:\Python314\python.exe"
if not defined PY if exist "C:\Python312\python.exe" set "PY=C:\Python312\python.exe"
if not defined PY if exist "C:\Python311\python.exe" set "PY=C:\Python311\python.exe"

if not defined PY (
  echo.
  echo ERROR: Real Python 3 was not found on PATH.
  echo Install Python 3.12+ from https://www.python.org/downloads/
  echo and check "Add python.exe to PATH", then reopen this window.
  echo.
  pause
  exit /b 1
)

echo Using: %PY%
"%PY%" --version
if errorlevel 1 (
  echo That Python executable failed. Reinstall Python 3 from python.org.
  pause
  exit /b 1
)

echo Installing deps from requirements.txt ...
"%PY%" -m pip install -r requirements.txt -q
if errorlevel 1 (
  echo pip install failed. Try: "%PY%" -m pip install -r requirements.txt
  pause
  exit /b 1
)

"%PY%" app.py
pause
