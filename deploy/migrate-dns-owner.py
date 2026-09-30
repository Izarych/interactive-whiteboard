import datetime
import json
import os
import re
import subprocess

ZONE = 'bluviboard.ru'
CLI = ['/usr/local/mgr5/sbin/mgrctl', '-m', 'ispmgr']

def call(function, **params):
    result = subprocess.run(CLI + [function, 'out=json'] + ['%s=%s' % pair for pair in params.items()], text=True, capture_output=True)
    if result.returncode or result.stdout.startswith('ERROR'):
        raise RuntimeError(result.stdout + result.stderr)
    doc = json.loads(result.stdout)['doc']
    if 'error' in doc:
        raise RuntimeError(json.dumps(doc['error']))
    return doc

def text(item, name, default=''):
    value = item.get(name, {})
    return value.get('$', default) if isinstance(value, dict) else value

def records():
    doc = call('domain.record', elid=ZONE)
    value = doc.get('elem', [])
    return value if isinstance(value, list) else [value]

def signature(item):
    kind = text(item, 'rtype_hidden').upper()
    priority = re.search(r'priority\s*=\s*(\d+)', text(item, 'info'))
    return (kind, text(item, 'name'), text(item, 'value'), priority.group(1) if priority else '')

def restore(original):
    existing = {signature(item) for item in records()}
    for item in original:
        kind, name, value, priority = signature(item)
        if kind == 'SOA' or signature(item) in existing:
            continue
        params = dict(plid=ZONE, name=name, ttl=text(item, 'ttl', '3600'), rtype=kind.lower(), sok='ok')
        if kind in ('A', 'AAAA'):
            params['ip'] = value
        elif kind in ('MX', 'NS', 'CNAME'):
            params['domain'] = value
            if priority:
                params['priority'] = priority
        elif kind == 'TXT':
            params['value'] = value
        else:
            raise RuntimeError('Unsupported record type requires manual restore: ' + kind)
        call('domain.record.edit', **params)
    final = {signature(item) for item in records()}
    missing = [signature(item) for item in original if signature(item)[0] != 'SOA' and signature(item) not in final]
    if missing:
        raise RuntimeError('Missing DNS records after restore: ' + repr(missing))

before = records()
original_domain = call('domain.edit', elid=ZONE)
backup = '/root/bluviboard-provision/backups/dns-%s.json' % datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
os.makedirs(os.path.dirname(backup), mode=0o700, exist_ok=True)
with open(backup, 'w') as file:
    json.dump({'domain': original_domain, 'records': before}, file, indent=2)
os.chmod(backup, 0o600)
print('Backed up %s records to %s' % (len(before), backup), flush=True)
deleted = False
try:
    call('domain.delete.request', elid=ZONE, sok='ok')
    deleted = True
    call('domain.edit', name=ZONE, owner='www-root', owner_admins='off', dtype='master', ip='83.220.174.211',
         ns='ns1.firstvds.ru. ns2.firstvds.ru.', webdomain='off', maildomain='on', sok='ok')
    restore(before)
    domain = call('domain.edit', elid=ZONE)
    if text(domain, 'owner_admins') == 'on':
        raise RuntimeError('Owner change was not applied')
    print('DNS owner migration completed; original records preserved.', flush=True)
except Exception:
    if deleted:
        try:
            call('domain.edit', elid=ZONE)
        except Exception:
            call('domain.edit', name=ZONE, owner_admins='on', dtype='master', ip='83.220.174.211',
                 ns='ns1.firstvds.ru. ns2.firstvds.ru.', sok='ok')
        restore(before)
    raise
