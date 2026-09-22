FROM postgres:18.3-alpine@sha256:54451ecb8ab38c24c3ec123f2fd501303a3a1856a5c66e98cecf2460d5e1e9d7
RUN apk add --no-cache gnupg openssh-client
COPY backup.sh /usr/local/bin/mrba-backup
COPY entrypoint.sh /usr/local/bin/backup-entrypoint
RUN chmod 755 /usr/local/bin/mrba-backup /usr/local/bin/backup-entrypoint
ENTRYPOINT ["/usr/local/bin/backup-entrypoint"]
