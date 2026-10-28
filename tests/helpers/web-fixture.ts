import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export async function startWebFixture() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '1688-web-test-'));
  const home = path.join(dir, 'home');
  await fs.mkdir(path.join(dir, 'dist/session'), { recursive: true });
  await fs.mkdir(home);
  await fs.cp(path.join(root, 'web'), path.join(dir, 'web'), { recursive: true });
  await fs.mkdir(path.join(dir, 'scripts'));
  for (const name of ['web-ui.mjs', 'web-export.mjs', 'web-cell-images.mjs']) {
    await fs.copyFile(path.join(root, 'scripts', name), path.join(dir, 'scripts', name));
  }
  await fs.symlink(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await fs.writeFile(path.join(dir, 'package.json'), '{"type":"module"}');
  const paths = await fs.readFile(path.join(root, 'src/session/paths.ts'), 'utf8');
  await fs.writeFile(path.join(dir, 'dist/session/paths.js'), ts.transpileModule(paths, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText);
  await fs.writeFile(path.join(dir, 'dist/cli.js'), `
import fs from 'node:fs/promises';
import path from 'node:path';
const args = process.argv.slice(2);
await fs.appendFile(path.join(process.env.BB1688_HOME, 'calls.jsonl'), JSON.stringify(args) + '\\n');
const offer = {offerId:'123',title:'测试保温杯',price:{text:'¥20',min:20,max:20},supplier:{name:'测试供应商'},location:{province:'浙江',city:'杭州'},verified:{factory:true,business:true},demand:{orderCountText:'100+',orderCountSource:'bookedCount',orderCountPeriod:null}};
const detail = {offerId:'123',title:'测试保温杯',minOrderQty:10,mixOrderQty:20,unitName:'件',priceTiers:[{minQty:10,price:20},{minQty:100,price:18}],skus:[{skuId:'1',specs:'黑色',price:20,stock:100}]};
if(args[0] === 'whoami') console.log(JSON.stringify({loggedIn:true}));
else if(args[0] === 'daemon') console.log(JSON.stringify({running:true,reachable:true}));
else if(args[0] === 'offer') console.log(JSON.stringify(detail));
else if(args[1] === 'fail') {console.error(JSON.stringify({code:'NETWORK_ERROR',message:'测试搜索失败'}));process.exitCode=9;}
else console.log(JSON.stringify({offers:[offer],total:1}));
`);
  const child = spawn(process.execPath, [path.join(dir, 'scripts/web-ui.mjs')], {
    env: { ...process.env, BB1688_HOME: home, BB1688_UI_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Web fixture start timeout: ${output}`)); }, 10000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => { clearTimeout(timeout); reject(error); });
    child.on('exit', (code) => { clearTimeout(timeout); reject(new Error(`Web fixture exited ${code}: ${output}`)); });
  });
  return {
    url, home,
    calls: async () => (await fs.readFile(path.join(home, 'calls.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line)),
    close: async () => {
      if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
      // Remove the dependency link first; never recurse through linked modules.
      await fs.unlink(path.join(dir, 'node_modules'));
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const fixture = await startWebFixture();
  console.log(fixture.url);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await fixture.close(); process.exit(); });
}
