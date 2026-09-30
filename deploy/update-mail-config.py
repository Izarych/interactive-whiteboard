import json
import os
import pathlib
import re
import sys

path = pathlib.Path('/etc/bluviboard/server.env')
content = path.read_text()
private = {}
for line in pathlib.Path(sys.argv[1]).read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        key, value = line.split('=', 1)
        private[key] = value
private['MAIL_FROM'] = 'BluviBoard <no-reply@bluviboard.ru>'
for key, value in private.items():
    line = '%s=%s' % (key, json.dumps(value))
    pattern = r'^%s=.*$' % re.escape(key)
    if re.search(pattern, content, re.M):
        content = re.sub(pattern, lambda match: line, content, flags=re.M)
    else:
        content += line + '\n'
stat = path.stat()
temporary = path.with_suffix('.new')
temporary.write_text(content)
os.chmod(temporary, 0o640)
os.chown(temporary, stat.st_uid, stat.st_gid)
temporary.replace(path)
print('Protected mail configuration updated without displaying credentials.')
