#!/bin/sh
set -eu
umask 077
# Container-local crond inherits the required environment; secrets are not written into crontab.
printf '0 22 * * * /usr/local/bin/mrba-backup >> /proc/1/fd/1 2>> /proc/1/fd/2\n' > /etc/crontabs/root
/usr/local/bin/mrba-backup
exec crond -f -l 8
