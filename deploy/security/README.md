# Server hardening

API uses patched body-parser >=2.4, multer >=2.5 and platform-express 12.3.3. Validate with npm test and API production-workspace npm audit.

Compose limits: production PostgreSQL 512 MiB, demo PostgreSQL 256 MiB, each API 384 MiB; each has a 128-process limit. Monitor demand before increasing limits.

Fail2ban: install sshd.local to jail.d/mrba-sshd.local, validate configuration and enable service.
CSP: include csp.conf only in the mrba.uz HTTPS vhost; validate nginx before reload. React Native Web requires inline styles.

Install monitor.py to /usr/local/sbin/mrba-monitor and the systemd units to /etc/systemd/system. State directory /var/lib/mrba-monitor must be root-only. Root-only /etc/mrba-monitor.json contains botToken and chatId. Never commit credentials. No messages are sent until both values are configured. Checks every 5 minutes, alerts on changes, daily reminders and recovery notices, retry on delivery failure. A local monitor cannot notify during full server outage; an independent external checker is still required for that case.

roles.sql is a ONE-TIME migration executed in each application database by a temporary local superuser. PostgreSQL 18 bootstrap role cannot be demoted: rename to mrba_admin, remove password, create mrba_owner with existing hash and limited privileges, transfer only application objects. Drop temporary setup user after conversion. mrba_backup is read-only and has no password. Database ports must stay unpublished. Emergency administration is through host-root docker exec and local socket trust using mrba_admin. Backup uses mrba_backup; migrations use mrba_owner. Create temporary restoration databases with mrba_admin.

Rollback copies: /srv/mrba/backups/security-20261104 (root-only). Application rollback must never replace current business data. Validate API/DB, nginx, fail2ban, backup and monitor after reboot.
