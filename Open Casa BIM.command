#!/bin/bash
# Double-click in Finder to open Casa BIM in your browser.
# It starts the local server (the app, your project files and the AI connection).
# Keep this window open while you use the app. Close it to stop.
cd "$(dirname "$0")"
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "First run or update: installing (takes a minute)..."
  npm install
fi
if [ ! -f .env.local ]; then cp .env.local.example .env.local; fi
(sleep 4; open http://localhost:5173) &
npm run dev
