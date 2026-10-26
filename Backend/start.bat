@echo off
setlocal

set "BACKEND_DIR=%~dp0"
set "RCS_DIR=%BACKEND_DIR%rcs"
rem The repository keeps its frontend files directly in the Cognitia folder.
set "FRONTEND_DIR=%BACKEND_DIR%.."
set "BUILD_DIR=%BACKEND_DIR%build\classes"
set "MARIADB_JAR=%BACKEND_DIR%lib\mariadb-java-client-3.5.10.jar"
set "JAVA_BIN="

if defined JAVA_HOME if exist "%JAVA_HOME%\bin\javac.exe" set "JAVA_BIN=%JAVA_HOME%\bin"

if not defined JAVA_BIN (
    for /d %%D in ("%ProgramFiles%\Java\jdk-*") do (
        if exist "%%~fD\bin\javac.exe" set "JAVA_BIN=%%~fD\bin"
    )
)

if not defined JAVA_BIN (
    for /f "delims=" %%J in ('where javac.exe 2^>nul') do if not defined JAVA_BIN set "JAVA_BIN=%%~dpJ"
)

if not defined JAVA_BIN (
    echo A JDK was not found. Install a JDK or set JAVA_HOME to its folder.
    pause
    exit /b 1
)

if not exist "%MARIADB_JAR%" (
    echo MariaDB driver not found:
    echo "%MARIADB_JAR%"
    pause
    exit /b 1
)

if not exist "%BUILD_DIR%" mkdir "%BUILD_DIR%"

pushd "%RCS_DIR%"
echo Make sure MariaDB is running in XAMPP before starting the backend.
echo Compiling Cognitia backend...
"%JAVA_BIN%\javac.exe" --release 21 -encoding UTF-8 -cp "%MARIADB_JAR%" -d "%BUILD_DIR%" Main.java util\*.java data\*.java handlers\*.java
if errorlevel 1 (
    echo.
    echo Compilation failed. Review the errors above.
    popd
    pause
    exit /b 1
)

echo.
echo Compilation succeeded. Starting the backend...
"%JAVA_BIN%\java.exe" -cp "%BUILD_DIR%;%MARIADB_JAR%" Main "%FRONTEND_DIR%"

popd
echo.
echo The backend has stopped.
pause
endlocal
