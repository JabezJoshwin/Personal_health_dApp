#!/usr/bin/env bash
# Regenerates the tables from bench/results and builds both PDFs.
# Requires: node, tectonic (https://tectonic-typesetting.github.io).
set -euo pipefail
cd "$(dirname "$0")"
node scripts/make-tables.mjs
tectonic --keep-logs --outdir build main-ieee.tex
tectonic --keep-logs --outdir build main-springer.tex
cp build/main-ieee.pdf paper-ieee.pdf
cp build/main-springer.pdf paper-springer.pdf
echo "Built paper-ieee.pdf and paper-springer.pdf"
