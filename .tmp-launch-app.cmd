@echo off
set ELECTRON_RUN_AS_NODE=
cd /d R:\project\periodicity-calendar-react
start "" "R:\project\periodicity-calendar-react\node_modules\electron\dist\electron.exe" . --remote-debugging-port=9222
