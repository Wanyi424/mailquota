#!/bin/sh
set -eu
# Run from project root. The archive is created only while the app is stopped.
backup_dir=${1:-./backups}
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
archive="$backup_dir/mailquota-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
umask 077
docker compose exec -T postgres pg_dump --format=custom --file=/tmp/mailquota.dump mailquota
docker compose cp postgres:/tmp/mailquota.dump "$backup_dir/mailquota.dump"
tar -czf "$archive" "$backup_dir/mailquota.dump"
rm -f "$backup_dir/mailquota.dump"
printf 'Backup created: %s\n' "$archive"
