#!/bin/sh
set -eu
# Run from project root. The archive is created only while the app is stopped.
backup_dir=${1:-./backups}
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
archive="$backup_dir/mailquota-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
docker compose stop mailquota
trap 'docker compose start mailquota' EXIT HUP INT TERM
test -f storage/config/customers.json
test -f storage/data/mailquota.sqlite
umask 077
tar -czf "$archive" storage
printf 'Backup created: %s\n' "$archive"
