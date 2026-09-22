#!/bin/bash
# Local encrypted copy; last-local-success deliberately does not claim offsite success.
set -euo pipefail
umask 077
exec 9>/run/lock/mrba-local-backup.lock
flock -n 9 || exit 0
cd /srv/mrba/app
mkdir -p /srv/mrba/backups /srv/mrba/backup-gnupg
chmod 700 /srv/mrba/backups /srv/mrba/backup-gnupg
work=$(mktemp -d /srv/mrba/backups/.work-XXXXXX)
trap 'rm -rf "$work"' EXIT
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="mrba-$stamp.dump.gpg"
docker compose --env-file deploy/.env -f deploy/compose.prepare.yaml exec -T postgres pg_dump -U mrba_owner -d mrba -Fc --no-owner > "$work/database.dump"
docker compose --env-file deploy/.env -f deploy/compose.prepare.yaml exec -T postgres pg_restore --list < "$work/database.dump" > "$work/archive-list"
test -s "$work/archive-list"
gpg --homedir /srv/mrba/backup-gnupg --batch --import /srv/mrba/backup-recipient.asc >/dev/null 2>&1
gpg --homedir /srv/mrba/backup-gnupg --batch --trust-model always --recipient 19D5B85A99F33B38BC0F64EF4CF369FCC75D08B0 --output "$work/$file" --encrypt "$work/database.dump"
mv "$work/$file" "/srv/mrba/backups/$file"
(cd /srv/mrba/backups && sha256sum "$file" > "$file.sha256")
touch /srv/mrba/backups/last-local-success
# Retain 30 days; only files created by this script match the pattern.
find /srv/mrba/backups -maxdepth 1 -type f -name 'mrba-*.dump.gpg*' -mtime +30 -delete
printf 'Local encrypted backup: %s\n' "$file"
