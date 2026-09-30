#!/usr/bin/env python3
import grp
import json
import os
import secrets
import subprocess
import sys

path = '/etc/bluviboard/server.env'
private = {}
if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
    for line in open(sys.argv[1], encoding='utf-8'):
        if '=' in line and not line.startswith('#'):
            key, value = line.strip().split('=', 1)
            private[key] = value.strip('"')
if not os.path.exists(path):
    password = secrets.token_hex(24)
    statement = "CREATE ROLE bluviboard LOGIN PASSWORD '%s' NOSUPERUSER NOCREATEDB NOCREATEROLE;" % password
    subprocess.run(['runuser', '-u', 'postgres', '--', 'psql', '-v', 'ON_ERROR_STOP=1', '--file=-'], input=statement, text=True, check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['runuser', '-u', 'postgres', '--', 'createdb', '-O', 'bluviboard', 'bluviboard'], check=True)
    settings = {
        'NODE_ENV': 'production', 'HOST': '127.0.0.1', 'PORT': '3000',
        'DATABASE_URL': 'postgresql://bluviboard:%s@127.0.0.1:5432/bluviboard' % password,
        'AUTH_SECRET': secrets.token_hex(32), 'COOKIE_SECURE': 'true', 'WEB_ORIGIN': 'https://bluviboard.ru',
        'TRUST_PROXY': 'loopback', 'REQUIRE_ORIGIN': 'true', 'UV_THREADPOOL_SIZE': '2',
        'STORAGE_PROVIDER': 'local', 'STORAGE_LOCAL_PATH': '/var/lib/bluviboard/uploads',
        'SMTP_HOST': '127.0.0.1', 'SMTP_PORT': '25', 'SMTP_SECURE': 'false', 'SMTP_LOCAL_RELAY': 'true',
        'MAIL_FROM': 'BluviBoard <no-reply@bluviboard-mail.ru>',
    }
    settings.update(private)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
    with os.fdopen(fd, 'w', encoding='utf-8') as file:
        for key, value in settings.items():
            file.write('%s=%s\n' % (key, json.dumps(value)))
    os.chown(path, 0, grp.getgrnam('bluviboard').gr_gid)
print('Private production configuration created or preserved.')
