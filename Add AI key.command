#!/bin/bash
# Double-click in Finder: opens the private settings file (.env.local) in TextEdit so you can paste your Anthropic API key.
# Paste the key right after ANTHROPIC_API_KEY= (no spaces), save with Cmd+S, close TextEdit,
# then close the app window and double-click "Open Casa BIM.command" again.
cd "$(dirname "$0")"
if [ ! -f .env.local ]; then cp .env.local.example .env.local; fi
open -a TextEdit .env.local
