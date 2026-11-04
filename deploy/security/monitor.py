#!/usr/bin/env python3
"""Local health checks; Telegram is enabled only when root-owned config is populated."""
import datetime, json, os, pathlib, shutil, ssl, subprocess, time, urllib.request
STATE = pathlib.Path('/var/lib/mrba-monitor/state.json')
CONFIG = pathlib.Path('/etc/mrba-monitor.json')
def run(*args):
 return subprocess.check_output(args, timeout=15, text=True)
def checks():
 errors=[]
 for name,url in [('site','https://mrba.uz/'),('API','https://api.mrba.uz/api/v1/health/ready'),('demo API','https://api.mrba.uz/demo/api/v1/health/ready')]:
  try:
   with urllib.request.urlopen(url,timeout=12) as r:
    if r.status!=200: raise ValueError()
    if name!='site' and json.load(r).get('database')!='connected': raise ValueError()
  except Exception: errors.append(name+': unavailable')
 disk=shutil.disk_usage('/')
 if disk.free/disk.total<0.15: errors.append('Disk: less than 15% free')
 try:
  if time.time()-pathlib.Path('/srv/mrba/backups/last-local-success').stat().st_mtime>30*3600:errors.append('Database backup is older than 30 hours')
 except OSError:errors.append('Database backup success marker missing')
 try:
  data=json.loads(run('docker','inspect','mrba-production-api-1','mrba-demo-api-1','mrba-production-postgres-1','mrba-demo-postgres-1'))
  for c in data:
   if not c['State']['Running'] or c['State'].get('Health',{}).get('Status')!='healthy':errors.append(c['Name']+': unhealthy')
 except Exception:errors.append('Container inspection failed')
 for host in ['mrba.uz','api.mrba.uz']:
  try:
   import socket
   with socket.create_connection((host,443),timeout=10) as sock:
    with ssl.create_default_context().wrap_socket(sock,server_hostname=host) as s:
     if ssl.cert_time_to_seconds(s.getpeercert()['notAfter'])-time.time()<14*86400: errors.append(host+': certificate expires in less than 14 days')
  except Exception:errors.append(host+': TLS check failed')
 return sorted(set(errors))
def main():
 STATE.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
 try: old=json.loads(STATE.read_text())
 except (OSError,ValueError):old={}
 errors=checks(); now=time.time()
 event=errors!=old.get('errors',[]) or bool(errors and now-old.get('notifiedAt',0)>86400)
 config=json.loads(CONFIG.read_text()) if CONFIG.exists() else {}
 sent=old.get('notifiedAt',0)
 if event and config.get('botToken') and config.get('chatId'):
  message='MRBA server: '+ ('PROBLEM\n'+'\n'.join(errors) if errors else 'RECOVERED: all checks passed')
  request=urllib.request.Request('https://api.telegram.org/bot'+config['botToken']+'/sendMessage',data=json.dumps({'chat_id':config['chatId'],'text':message}).encode(),headers={'Content-Type':'application/json'})
  try:
   with urllib.request.urlopen(request,timeout=15) as r:
    if not json.load(r).get('ok'):raise ValueError()
   sent=now
  except Exception:
   print('Telegram delivery failed; will retry next check',flush=True)
   errors_for_state=old.get('errors',[])
   STATE.write_text(json.dumps({'checkedAt':now,'errors':errors_for_state,'notifiedAt':sent})); return
 STATE.write_text(json.dumps({'checkedAt':now,'errors':errors,'notifiedAt':sent}))
 print(json.dumps({'errors':errors,'telegramConfigured':bool(config.get('botToken') and config.get('chatId'))}),flush=True)
if __name__=='__main__':main()
