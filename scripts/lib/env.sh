# Loads KEY=value lines from an env file into the environment, without
# handing them to the shell. `. ./.env` would: the Atlas connection string
# carries `&` and `?`, and sourcing it runs the tail as background jobs and
# leaves the variable empty. Surrounding quotes are dropped; nothing is
# expanded.
#
#   . scripts/lib/env.sh; load_env .env
load_env() {
  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    [[ $line =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key=${BASH_REMATCH[1]}
    value=${BASH_REMATCH[2]}
    if [[ $value =~ ^\"(.*)\"$ || $value =~ ^\'(.*)\'$ ]]; then value=${BASH_REMATCH[1]}; fi
    export "$key=$value"
  done <"$1"
}
