/* Ждёт токена device-flow, затем подключает его к API-серверу и передеплоит. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TMP = process.env.TEMP || '/tmp';
const flow = JSON.parse(fs.readFileSync(path.join(TMP, 'device_flow.json'), 'utf8'));
const ROOT = path.resolve(__dirname, '..');
const SITE_ID = '2116859456035250176';
const ZCLI = 'C:/Users/User/.zcode/cli/plugins/cache/zcode-plugins-official/zcode-site/0.4.2/scripts/zcode-site.mjs';

async function poll() {
  const deadline = Date.now() + (flow.expires_in + 30) * 1000;
  while (Date.now() < deadline) {
    const r = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: '178c6fc778ccc68e1d6a',
        device_code: flow.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    }).then(x => x.json());
    if (r.access_token) return r.access_token;
    if (r.error === 'expired_token' || r.error === 'authorization_pending' === false && r.error && r.error !== 'authorization_pending') {
      if (r.error && r.error !== 'authorization_pending') { console.log('FLOW_ERROR:', r.error); return null; }
    }
    await new Promise(rs => setTimeout(rs, (flow.interval || 5) * 1000));
  }
  console.log('EXPIRED');
  return null;
}

poll().then(tok => {
  if (!tok) { console.log('NO_TOKEN'); return; }
  console.log('TOKEN_OK', tok.slice(0, 8) + '...');
  // вшить в stage
  const start = path.join(ROOT, '.zcode-site', 'stage-api', 'start.sh');
  let s = fs.readFileSync(start, 'utf8');
  s = s.replace('export GH_TOKEN="${GH_TOKEN:-}"', 'export GH_TOKEN="' + tok + '"');
  fs.writeFileSync(start, s);
  console.log('token baked into start.sh');
  // передеплоить API
  try {
    execSync(`node "${ZCLI}" deploy .zcode-site/stage-api --site ${SITE_ID}`, { cwd: ROOT, stdio: 'inherit' });
    console.log('API REDEPLOYED WITH MIRROR');
  } catch (e) {
    console.log('DEPLOY_FAIL', e.message);
  }
});
