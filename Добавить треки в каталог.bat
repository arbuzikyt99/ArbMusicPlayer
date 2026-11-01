@echo off
chcp 65001 >nul
title Добавить музыку в ArbMusic
cd /d "%~dp0"

echo.
echo  === Публикация треков в общий каталог ArbMusic ===
echo.

node tools\publish-music.js
if errorlevel 1 goto err

git add music catalog.json
git commit -m "Add music to catalog" >nul 2>&1
if errorlevel 1 (
    echo Нечего публиковать — новых треков нет.
) else (
    git push
    if errorlevel 1 goto err
    echo.
    echo  ГОТОВО! Треки опубликованы — все пользователи приложения их увидят.
)
echo.
pause
exit /b 0

:err
echo.
echo  ОШИБКА! Проверь интернет и повтори.
pause
exit /b 1
