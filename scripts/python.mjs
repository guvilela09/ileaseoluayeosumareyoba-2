import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';

const bundled=process.platform==='win32'&&process.env.USERPROFILE?join(process.env.USERPROFILE,'.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe'):null;
const executable=process.env.PORTAL_PYTHON||(bundled&&existsSync(bundled)?bundled:'python');
const child=spawn(executable,['-B',...process.argv.slice(2)],{stdio:'inherit',shell:false,windowsHide:true});
child.on('error',()=>{process.stderr.write('Python 3.12+ não encontrado. Instale Python ou configure PORTAL_PYTHON com o caminho do executável.\n');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
