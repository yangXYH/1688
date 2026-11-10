import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zip = new JSZip();
for (const file of ['manifest.json','worker.js','page-hook.js','content.js','content.css','panel.html','panel.js','panel.css','README.md']) {
  zip.file(file, await fs.readFile(path.join(root, 'extension', file)));
}
await fs.mkdir(path.join(root, 'outputs'), { recursive: true });
const target = path.join(root, 'outputs', '1688-chrome-extension.zip');
await fs.writeFile(target, await zip.generateAsync({ type:'nodebuffer', compression:'DEFLATE' }));
console.log(target);
