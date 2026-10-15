"""Executa suítes independentes sem contato com serviços externos."""
import os
import subprocess
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
env=dict(os.environ)
env['PYTHONPATH']=os.pathsep.join([str(ROOT/'.runtime/python'),str(ROOT/'.runtime/firebase_packages'),str(ROOT)])
suites=[('tests','test_importers.py'),('tests/backend','test*.py'),('assistant-preview','test*.py'),('functions','test*.py')]
failed=False
for folder,pattern in suites:
    if not (ROOT/folder).is_dir():
        continue
    print(f'\nVerificando {folder}',flush=True)
    result=subprocess.run([sys.executable,'-B','-m','unittest','discover','-s',folder,'-p',pattern],cwd=ROOT,env=env)
    failed=failed or result.returncode!=0
raise SystemExit(1 if failed else 0)
