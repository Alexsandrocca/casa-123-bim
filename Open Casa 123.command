#!/bin/bash
# Double-click in Finder to open the Casa 123 app in your browser.
# Keep this window open while you use the app. Close it to stop.
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "First run: installing (takes a minute)..."
  npm install
fi
(sleep 3; open http://localhost:5173) &
npm run dev
