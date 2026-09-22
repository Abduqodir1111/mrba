#!/bin/sh
set -eu
umask 077
: "${BACKUP_RECIPIENT:?Required}" "${OFFSITE_DESTINATION:?Required}"
mkdir -p /backups
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="mrba-$stamp.dump.gpg"
pg_dump --format=custom --no-owner --file="$work/database.dump"
pg_restore --list "$work/database.dump" > "$work/archive-list"
test -s "$work/archive-list"
gpg --batch --import /keys/recipient.asc >/dev/null 2>&1
gpg --batch --yes --trust-model always --recipient "$BACKUP_RECIPIENT" --output "/backups/$file.partial" --encrypt "$work/database.dump"
mv "/backups/$file.partial" "/backups/$file"
(cd /backups && sha256sum "$file" > "$file.sha256")
# Fail closed if host key is unknown. Backup destination must be set by the operator.
scp -o BatchMode=yes -o StrictHostKeyChecking=yes "/backups/$file" "/backups/$file.sha256" "$OFFSITE_DESTINATION"
touch /backups/last-success
find /backups -type f -name 'mrba-*.dump.gpg*' -mtime +"${BACKUP_RETENTION_DAYS:-30}" -delete
printf 'Backup completed and copied offsite: %s\n' "$stamp"
