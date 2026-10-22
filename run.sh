#!/usr/bin/env bash
# Launch the Simple Stopping (Fixed SSDs) task on a local expfactory server.
# First run creates .venv and installs the bundled server; later runs reuse it.
#
#   ./run.sh -sub s03 -ses 1 -gi 3
#
# Any arguments are passed through to expfactory_deploy_local.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x .venv/bin/expfactory_deploy_local ]; then
  echo "Setting up .venv (first run only)..."
  python3 -m venv .venv
  .venv/bin/pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet -r requirements.txt
  .venv/bin/pip install --quiet -e ./expfactory_deploy_local
fi

exec .venv/bin/expfactory_deploy_local -e simple_stopping_fixed_ssds -raw data/raw "$@"
