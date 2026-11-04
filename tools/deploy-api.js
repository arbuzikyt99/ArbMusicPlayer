/* Деплой API-сервера: всегда берёт свежие server/api.js и www */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = 'C:/Users/User/OneDrive/Desktop/ArbMusic';
const STAGE = path.join(ROOT, '.zcode-site', 'stage-api');
const SITE_ID = '2116859456035250176';
const ZCLI = 'C:/Users/User/.zcode/cli/plugins/cache/zcode-plugins-official/zcode-site/0.4.2/scripts/zcode-site.mjs';

// свежие файлы
fs.copyFileSync(path.join(ROOT, 'server', 'api.js'), path.join(STAGE, 'server.js'));
fs.rmSync(path.join(STAGE, 'www'), { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'www'), path.join(STAGE, 'www'), { recursive: true });

execSync(`node "${ZCLI}" deploy ${STAGE} --site ${SITE_ID}`, { cwd: ROOT, stdio: 'inherit' });
console.log('DEPLOYED');
