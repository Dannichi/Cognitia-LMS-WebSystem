@echo off
setlocal

set "BACKEND_DIR=%~dp0"
set "BUILD_DIR=%BACKEND_DIR%build\classes"
set "TEST_BUILD_DIR=%BACKEND_DIR%build\test-classes"
set "MARIADB_JAR=%BACKEND_DIR%lib\mariadb-java-client-3.5.10.jar"
set "TEST_SOURCE=%BACKEND_DIR%BackendSmokeTest.java"
set "JAVA_BIN="
set "API_URL=%~1"

if not defined API_URL set "API_URL=http://localhost:8000"

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

if not exist "%BUILD_DIR%\Main.class" (
    echo Backend classes were not found. Run start.bat successfully first.
    pause
    exit /b 1
)

if not exist "%MARIADB_JAR%" (
    echo MariaDB driver not found:
    echo "%MARIADB_JAR%"
    pause
    exit /b 1
)

if not exist "%TEST_BUILD_DIR%" mkdir "%TEST_BUILD_DIR%"

echo Compiling Cognitia backend smoke test...
"%JAVA_BIN%\javac.exe" --release 21 -encoding UTF-8 -cp "%BUILD_DIR%;%MARIADB_JAR%" -d "%TEST_BUILD_DIR%" "%TEST_SOURCE%"
if errorlevel 1 (
    echo.
    echo Test compilation failed. Review the errors above.
    pause
    exit /b 1
)

echo.
echo Running backend smoke tests against %API_URL%...
"%JAVA_BIN%\java.exe" -cp "%BUILD_DIR%;%TEST_BUILD_DIR%;%MARIADB_JAR%" BackendSmokeTest "%API_URL%"
set "TEST_RESULT=%ERRORLEVEL%"

echo.
if "%TEST_RESULT%"=="0" (
    echo Backend smoke tests passed.
) else (
    echo Backend smoke tests reported failures. Review the test results above.
)
pause
exit /b %TEST_RESULT%
