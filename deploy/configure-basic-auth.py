import grp
import os
import pathlib
import subprocess
import sys

values = {}
for line in pathlib.Path(sys.argv[1]).read_text().splitlines():
    if '=' in line:
        key, value = line.split('=', 1)
        values[key] = value
username = values['BASIC_AUTH_USERNAME']
password = values['BASIC_AUTH_PASSWORD']
if not username or ':' in username or '\n' in password:
    raise ValueError('Invalid Basic Auth credentials')
path = '/etc/bluviboard/admin.htpasswd'
args = ['htpasswd', '-i', '-B', '-C', '12']
if not os.path.exists(path):
    args.append('-c')
subprocess.run(args + [path, username], input=password + '\n', text=True, check=True, stdout=subprocess.DEVNULL)
os.chmod(path, 0o640)
os.chown(path, 0, grp.getgrnam('www-data').gr_gid)
print('Administrative Basic Auth configured with a bcrypt password hash.')
