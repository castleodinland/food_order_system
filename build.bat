@echo off
set CGO_ENABLED=0
echo [1/2] Building Windows amd64 ...
go build -trimpath -ldflags "-s -w" -o dist\food_order_windows_amd64.exe .
if %errorlevel% neq 0 (echo BUILD FAILED: Windows & exit /b 1)
echo [2/2] Building Linux amd64 ...
set GOOS=linux
set GOARCH=amd64
go build -trimpath -ldflags "-s -w" -o dist\food_order_linux_amd64 .
if %errorlevel% neq 0 (echo BUILD FAILED: Linux & exit /b 1)
echo.
echo Done!
dir dist\food_order_windows_amd64.exe dist\food_order_linux_amd64
