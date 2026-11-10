let directory='';
fetch('/api/extension-info').then(r=>r.json()).then(data=>{directory=data.path;document.getElementById('folder').textContent=directory;}).catch(()=>{document.getElementById('message').textContent='本机服务未连接，请先启动 pnpm ui。';});
document.getElementById('copy').addEventListener('click',async()=>{await navigator.clipboard.writeText(directory);document.getElementById('message').textContent='目录已复制，请在 Chrome「加载已解压的扩展程序」中选择该目录。';});
