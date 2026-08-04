@echo off
REM Double-clic pour installer les dependances et lancer l'editeur.
REM Requiert Node.js >= 22 et pnpm (npm install -g pnpm) deja installes.

setlocal
cd /d "%~dp0"

where pnpm >nul 2>nul
if errorlevel 1 (
    echo pnpm est introuvable. Installe-le d'abord :
    echo   npm install -g pnpm
    echo puis relance ce fichier.
    pause
    exit /b 1
)

echo Installation et lancement de l'editeur...
echo Cette fenetre doit rester ouverte. Ctrl+C pour arreter.
echo.

call pnpm run start
pause
