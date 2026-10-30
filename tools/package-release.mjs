// Explicit allowlist: never copy a working directory or a user profile wholesale.
import {readFile,writeFile,mkdir,lstat,copyFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const name='Codex-Neon-Boot-0.4.0-source';
const destination=path.join(root,'release',name);
const files=[
  'README.md','LICENSE','.gitignore','Start Codex.cmd','CODEX-STARTUP-TEST.md',
  'AI-ENTRY-UPDATE.md','CHAT-READINESS-FIX.md','docs/images/startup-preview.png',
  'embedded/README.md','embedded/start-debug.ps1','embedded/normal-start.ps1',
  'embedded/adapter.json','embedded/cdp.mjs','embedded/injector.mjs',
  'embedded/module-discovery.mjs','embedded/readiness.mjs','embedded/presentation.mjs',
  'embedded/overlay.js','embedded/overlay.html','embedded/mono-overlay.template.html',
  'embedded/assets/chatgpt-knot.svg','embedded/assets/codex-startup.ico',
  'preview/monochrome.html','tools/build-monochrome.mjs','tools/preview-driver.js',
  'tools/create-shortcut.ps1','tools/package-release.mjs'
];
for(const relative of files) {
  const stat=await lstat(path.join(root,relative));
  if(!stat.isFile()||stat.isSymbolicLink())throw Error('Not an ordinary allowlisted file: '+relative);
}
await mkdir(path.dirname(destination),{recursive:true});
// Refuse to overwrite an earlier delivery or accidentally merge its contents.
await mkdir(destination);
for(const relative of files) {
  const target=path.join(destination,relative);
  await mkdir(path.dirname(target),{recursive:true});
  await copyFile(path.join(root,relative),target);
}
const packageInfo={name:'codex-neon-boot',version:'0.4.0',private:true,type:'module',
  description:'Unofficial, version-pinned Windows Codex startup animation',license:'MIT',
  engines:{node:'>=22'},scripts:{build:'node tools/build-monochrome.mjs',
    shortcut:'powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/create-shortcut.ps1',
    'package:source':'node tools/package-release.mjs'}};
await writeFile(path.join(destination,'package.json'),JSON.stringify(packageInfo,null,2)+'\n');
await writeFile(path.join(destination,'.gitattributes'),
  '* text=auto\n*.cmd text eol=crlf\n*.ps1 text eol=crlf\n*.png binary\n*.ico binary\n');
// History-only diagnostics are not part of the public runtime distribution.
for(const relative of ['AI-ENTRY-UPDATE.md','CHAT-READINESS-FIX.md']) {
  const target=path.join(destination,relative);
  let text=await readFile(target,'utf8');
  text=text.split('\n').filter(line=>!line.includes('artifacts/')&&!line.includes('output/')).join('\n');
  await writeFile(target,text);
}
const embeddedDoc=path.join(destination,'embedded/README.md');
let text=await readFile(embeddedDoc,'utf8');
text=text.replace('旧外置代码保留为历史源码。','本交付包不包含旧外置源码。')
  .replace('Playwright 仅用于独立浏览器测试。','交付包不包含开发测试依赖。')
  .replace(/^重复运行独立测试需先.*$/m,'此交付包不含自动化测试文件；手动验收步骤见上方冷启动指南。');
await writeFile(embeddedDoc,text);
await writeFile(path.join(destination,'RELEASE.md'),`# Source delivery 0.4.0\n\nExperimental, version-pinned Windows release.\n\n- No login profile, credentials, node_modules, test files, development logs, extracted app code or machine-specific shortcuts.\n- Generate your shortcut after extraction with tools/create-shortcut.ps1.\n- Core code, generated animation pages, icon, build tools, documentation and MIT license are included.\n- See README.md for compatibility and manual startup verification.\n- SHA256SUMS.txt covers all payload files except itself. FILES.txt lists the complete archive payload.\n`);
const payload=[];
async function visit(directory,relative='') {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const item=relative?relative+'/'+entry.name:entry.name;
    if(entry.isDirectory())await visit(path.join(directory,entry.name),item);
    else payload.push(item);
  }
}
await visit(destination);
payload.push('FILES.txt','SHA256SUMS.txt');payload.sort();
await writeFile(path.join(destination,'FILES.txt'),payload.join('\n')+'\n');
const hashes=[];
for(const relative of payload.filter(x=>x!=='SHA256SUMS.txt')) {
  const hash=createHash('sha256').update(await readFile(path.join(destination,relative))).digest('hex');
  hashes.push(`${hash}  ${relative}`);
}
await writeFile(path.join(destination,'SHA256SUMS.txt'),hashes.join('\n')+'\n');
console.log(JSON.stringify({directory:destination,files:payload.length,testsIncluded:false,profileIncluded:false}));
