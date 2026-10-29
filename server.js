/* ═══════════════════════════════════════════════════════════════
   ✦ MOZLINCE NEBULA  ·  v9.0.0 QUANTUM+ HARDENED
   © Asheo Systems · Premium License Engine
   ───────────────────────────────────────────────────────────────
   ◈ Compatível com a extensão Asheo v1.6.2 (build ORIGINAL, não patchada)
   ◈ HMAC: aceita 3 formatos (inject / session / deactivate)
   ◈ Proxy: parseia __asheo wrapper, respeita swap-only, 3ds-strip, remove-cvv
   ◈ Proxy: repassa x-asheo-proxied com tipo, x-asheo-swapped, location
   ◈ Rotas: /v1/process/adyen/:id, /v1/process/tebex/:id, /v1/process/basistheory/tokens
   ◈ Bootstrap/Rules/Gw: valida HMAC e checa licença (ativa/expirada)
   ◈ Bootstrap inclui campaign + manifest
   ◈ Diagnóstico: /v1/keys/jwk para confirmar par ES256
   ═══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const zlib = require('zlib');

const app = express();
app.set('trust proxy', 1); // [FIX #19]

const ALLOWED_HEADERS = [
  'Origin','X-Requested-With','Content-Type','Accept','Authorization','Asheo-Pass',
  'X-Install-Id','X-Client-Tag','X-License-Key','X-Request-Id','Accept-Language','Accept-Encoding',
  'x-asheo-target','x-asheo-method','x-asheo-install','x-asheo-ts','x-asheo-sig','x-asheo-build',
  'x-asheo-nonce','x-asheo-origin','x-asheo-auth','x-asheo-bin','x-asheo-card','x-asheo-clientkey',
  'x-asheo-special-hosts','x-asheo-headers','x-asheo-swap-only','x-asheo-3ds-strip',
  'x-asheo-remove-cvv','x-asheo-bt-host','x-asheo-pack-fmt','x-asheo-attest','x-asheo-session',
  'x-asheo-replay','X-Telegram-Bot-Api-Secret-Token'
].join(', ');

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  res.setHeader('Access-Control-Expose-Headers', [
    'Content-Length','Content-Encoding','X-Request-Id','x-asheo-proxied','x-asheo-swapped',
    'x-asheo-swap-ok','x-asheo-pack-fmt','x-asheo-upstream-status','x-asheo-adyen-verdict',
    'x-asheo-adyen-result','x-asheo-adyen-reason','x-asheo-3ds2-verdict','x-asheo-3ds2-attempts',
    'x-asheo-3ds2-trail','x-asheo-elapsed-ms','x-asheo-hmac-format'
  ].join(', '));
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Powered-By', 'Mozlince-Nebula/9.0.0');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ORDEM CORRETA: json → urlencoded → text → raw (multipart). rawBody salvo em todos.
app.use(express.json({ limit: '4mb', verify: (req,res,buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false, limit: '4mb', verify: (req,res,buf) => { req.rawBody = buf; } }));
app.use(express.text({ type: ['text/*','application/xml'], limit: '4mb', verify: (req,res,buf) => { req.rawBody = buf; } }));
app.use(express.raw({ type: 'multipart/form-data', limit: '4mb', verify: (req,res,buf) => { req.rawBody = buf; } }));

/* ═══ DESIGN SYSTEM (logs) ═══ */
const C = { r:'\x1b[0m', b:'\x1b[1m', d:'\x1b[2m', gray:'\x1b[38;5;245m', dim:'\x1b[38;5;240m', violet:'\x1b[38;5;99m', violetB:'\x1b[38;5;135m', cyan:'\x1b[38;5;45m', cyanB:'\x1b[38;5;51m', gold:'\x1b[38;5;220m', goldB:'\x1b[38;5;226m', mint:'\x1b[38;5;121m', green:'\x1b[38;5;46m', rose:'\x1b[38;5;204m', red:'\x1b[38;5;196m', amber:'\x1b[38;5;214m', blue:'\x1b[38;5;39m' };
const TAGS = { INFO:C.cyanB, OK:C.green, WARN:C.amber, ERRO:C.red, SYS:C.violetB, ATIV:C.blue, BOT:C.cyanB, FEAT:C.rose, BOOT:C.mint, API:C.gold, DBG:C.dim, TG:C.cyanB, SUPPORT:C.gold, I18N:C.blue, RULES:C.rose, DM:C.rose, GW:C.cyanB, HMAC:C.amber, PROXY:C.violetB, GZIP:C.mint };
function log(t, m) { const ts = new Date().toISOString().replace('T',' ').substring(0,19); const tag = (TAGS[t]||C.gray) + C.b + '▸ ' + t.padEnd(7) + C.r; console.log(`${C.dim}${ts}${C.r} ${tag} ${m}`); }
function redactCard(obj) { try { const c = typeof obj === 'string' ? JSON.parse(obj) : obj; if (!c || typeof c !== 'object') return obj; const out = { ...c }; if (out.number) out.number = String(out.number).replace(/\d(?=\d{4})/g,'*'); if (out.cvv) out.cvv = '***'; if (out.cvc) out.cvc = '***'; return out; } catch { return obj; } }
function banner() {
  console.log(`\n${C.violet}   ╭──────────────────────────────────────────────╮${C.r}`);
  console.log(`${C.violet}   │${C.r}  ${C.cyanB}${C.b}◈  MOZLINCE${C.r}  ${C.goldB}${C.b}NEBULA${C.r}  ${C.dim}·${C.r}  ${C.gold}v9.0.0${C.r} ${C.dim}HARDENED${C.r} ${C.violet}│${C.r}`);
  console.log(`${C.violet}   │${C.r}  ${C.dim}Premium License Engine · Asheo Systems${C.r}     ${C.violet}│${C.r}`);
  console.log(`${C.violet}   ╰──────────────────────────────────────────────╯${C.r}\n`);
}
function escapeHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); } // [FIX #21]

/* ═══ CHAVES ES256 ═══ */
const EXPECTED_JWK = { x: 'aTAr_kSTrfocOkpAHlVSDc71E1pc5Pd5KgnE-ggBr_4', y: 'GFrU897XAPvrxqcRhlwoAwpooKHl69-0YrBaJbfwAT4' }; // [FIX #1]
let PRIVATE_KEY = null, PUBLIC_KEY = null, ORIGEM = 'nenhuma';
let JWK_PUBLIC = null;
(function initKeys() {
  const fp = ['/etc/secrets/private.pem','./private.pem','/etc/secrets/ec_private.pem'];
  const fu = ['/etc/secrets/public.pem','./public.pem','/etc/secrets/ec_public.pem'];
  for (const f of fp) { try { if (fs.existsSync(f)) { PRIVATE_KEY = fs.readFileSync(f,'utf8').trim(); ORIGEM='file:'+f; break; } } catch {} }
  for (const f of fu) { try { if (fs.existsSync(f)) { PUBLIC_KEY = fs.readFileSync(f,'utf8').trim(); break; } } catch {} }
  if (!PRIVATE_KEY) { let p = process.env.EC_PRIVATE_KEY || process.env.JWT_PRIVATE_KEY_PEM || ''; if (p) { if (!p.includes('BEGIN')) { try { p = Buffer.from(p.trim(),'base64').toString('utf8'); } catch {} } PRIVATE_KEY = p.replace(/\\n/g,'\n').trim(); ORIGEM = 'env'; } }
  if (!PUBLIC_KEY) { let pu = process.env.EC_PUBLIC_KEY || process.env.JWT_PUBLIC_KEY_PEM || ''; if (pu) { if (!pu.includes('BEGIN')) { try { pu = Buffer.from(pu.trim(),'base64').toString('utf8'); } catch {} } PUBLIC_KEY = pu.replace(/\\n/g,'\n').trim(); } }
  if (PRIVATE_KEY) {
    try {
      const k = crypto.createPrivateKey(PRIVATE_KEY);
      const pubFromPriv = crypto.createPublicKey(k).export({ type:'spki', format:'pem' });
      const jwk = crypto.createPublicKey(k).export({ format:'jwk' });
      JWK_PUBLIC = jwk;
      if (!PUBLIC_KEY) PUBLIC_KEY = pubFromPriv;
      log('OK', `Chave privada carregada (${ORIGEM}) · kid=${(jwk.x||'').slice(0,8)}…`);
      log('SYS', `JWK público: x=${(jwk.x||'').slice(0,20)}… y=${(jwk.y||'').slice(0,20)}…`);
    } catch (e) { log('ERRO','Chave privada inválida: '+e.message); PRIVATE_KEY = null; }
  } else { log('ERRO','Nenhuma chave privada encontrada'); }
  // [FIX #1] aborta se JWK não bate com a esperada pela extensão
  if (JWK_PUBLIC) {
    if (JWK_PUBLIC.x !== EXPECTED_JWK.x || JWK_PUBLIC.y !== EXPECTED_JWK.y) {
      log('ERRO', '══════════════════════════════════════════════════════');
      log('ERRO', 'JWK MISMATCH — a extensão vai REJEITAR todos os tokens.');
      log('ERRO', `Esperado: x=${EXPECTED_JWK.x.slice(0,20)}… y=${EXPECTED_JWK.y.slice(0,20)}…`);
      log('ERRO', `Atual:    x=${(JWK_PUBLIC.x||'').slice(0,20)}… y=${(JWK_PUBLIC.y||'').slice(0,20)}…`);
      log('ERRO', 'Gere o par ES256 cuja pública bata com a EXPECTED_JWK, ou atualize a extensão.');
      log('ERRO', '══════════════════════════════════════════════════════');
      process.exit(1);
    }
    log('OK', 'JWK pública bate com a esperada pela extensão.');
  } else {
    log('ERRO', 'SEM CHAVE PRIVADA — abortando.');
    process.exit(1);
  }
  if (!PUBLIC_KEY) { log('WARN','PUBLIC_KEY ausente — verify usará PRIVATE_KEY'); PUBLIC_KEY = PRIVATE_KEY; }
})();

/* ═══ ENV ═══ */
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const SERVER_URL = (process.env.SERVER_URL || 'https://airo.ai/share/Nmg0d2ptOW43aTpjNDA6c1RCT21PWVpuWlda').replace(/\/+$/,'');
const RULES_VERSION = 34;
const EXT_API_BASE_DEFAULT = 'https://airo.ai/share/Nmg0d2ptOW43aTpjNDA6c1RCT21PWVpuWlda';

/* ═══ CONSTANTES DE PLANO ═══ */
const FEATURE_KEYS = ['browserMods','ruleOpsLab','liveHud','advancedProtection','apiAccess','experimentalFeatures'];
const CAPABILITY_KEYS = ['adyenGateway','customEncryptedGateways','binGenerator'];
const LIMIT_KEYS = ['binPool','ccQueue','ruleLimit','profileLimit','randomRouting'];
const PREMIUM_SCOPE = ['bypasser','cardfiller','cvv','premium','browserMods','persona','rules','gateways','exclusive'];
const PREMIUM_LIMITS = { max_accounts:-1, daily_actions:-1, max_templates:-1, history_days:-1, export_limit:-1, binPool:null, ccQueue:null, ruleLimit:null, profileLimit:null, randomRouting:true };
const FREE_LIMITS = { max_accounts:1, daily_actions:20, max_templates:3, history_days:3, export_limit:5, binPool:2, ccQueue:10, ruleLimit:20, profileLimit:2, randomRouting:false };

const PACOTES = {
  '3d':   { nome:'3 Dias',    dias:3,     preco:3,   emoji:'◔', lifetime:false },
  '7d':   { nome:'7 Dias',    dias:7,     preco:5,   emoji:'◕', lifetime:false },
  '15d':  { nome:'15 Dias',   dias:15,    preco:7,   emoji:'◑', lifetime:false },
  '30d':  { nome:'30 Dias',   dias:30,    preco:12,  emoji:'◒', lifetime:false },
  '45d':  { nome:'45 Dias',   dias:45,    preco:17,  emoji:'◓', lifetime:false },
  '90d':  { nome:'3 Meses',   dias:90,    preco:30,  emoji:'✦', lifetime:false },
  '180d': { nome:'6 Meses',   dias:180,   preco:45,  emoji:'✧', lifetime:false },
  '1a':   { nome:'1 Ano',     dias:365,   preco:70,  emoji:'⟡', lifetime:false },
  'life': { nome:'LIFETIME',  dias:36500, preco:190, emoji:'∞', lifetime:true  }
};
const precoFmt = usd => `$${Number(usd || 0).toFixed(2)}`;

const PAYMENT_RULES = [
  { defaultId:"stripe.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Stripe", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:api\\.stripe\\.com|js\\.stripe\\.com)(?:\\/|$)",flags:"i"}, matchContentType:"application/x-www-form-urlencoded", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"worldpay.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Worldpay", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:hpp|payments|secure)\\.worldpay\\.com(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"endurance.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Endurance", patternEnc:{kind:"regex",source:"^https:\\/\\/securepay\\.svcs\\.endurance\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"safecharge.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Safecharge", patternEnc:{kind:"regex",source:"^https:\\/\\/secure\\.safecharge\\.com(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"paddle.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Paddle", patternEnc:{kind:"regex",source:"^https:\\/\\/checkout-service\\.paddle\\.com\\/[^?#]*\\/pay(?:[?#]|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"adyen.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Adyen", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:checkoutshopper-live(?:-[a-z0-9]+)?\\.adyen\\.com|checkoutshopper-live(?:-[a-z0-9]+)?\\.cdn\\.adyen\\.com)\\/(?:checkoutshopper\\/)?v\\d+\\/(?:sessions\\/[^/]+\\/)?payments(?:\\/details)?(?:[/?#]|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"boosteroid.adyen", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Boosteroid Adyen", patternEnc:{kind:"regex",source:"^https:\\/\\/cloud\\.boosteroid\\.com\\/api\\/v2\\/payments\\/adyen\\/subscription\\/create(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"chess.adyen", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Chess.com Adyen", patternEnc:{kind:"regex",source:"^https:\\/\\/www\\.chess\\.com\\/payment\\/adyen\\/pay(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"gog.adyen", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"GOG Adyen", patternEnc:{kind:"regex",source:"^https:\\/\\/api\\.gog\\.com\\/v\\d+\\/checkout\\/[a-z0-9]+\\/payment(?:[/?#]|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"lootbar.adyen", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Lootbar", patternEnc:{kind:"regex",source:"^https:\\/\\/api\\.lootbar\\.com\\/api\\/v2\\/asset\\/pay\\/adyen\\/card\\/request(?:[\\/?#]|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"xsolla.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Xsolla", patternEnc:{kind:"regex",source:"^https:\\/\\/secure\\.xsolla\\.com\\/paystation2\\/api\\/.*$",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"recurly.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Recurly", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:[a-z0-9.-]+\\.)?recurly\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/x-www-form-urlencoded", requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"tebex.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Tebex", patternEnc:{kind:"regex",source:"^https:\\/\\/checkout\\.tebex\\.io(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"nordpayments.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"NordPayments", patternEnc:{kind:"regex",source:"^https:\\/\\/iframe-api\\.nordpayments\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:["primary_account_number","expiration_year","expiration_month","cvv"], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"grammerly.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Grammarly", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:gr4vy\\.app|gateway\\.grammarly\\.com|payments\\.grammarly\\.com)(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:["payment_method.number","payment_method.expiration_date","payment_method.security_code"], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"rizzup.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"RizzUp", patternEnc:{kind:"regex",source:"^https:\\/\\/rizzup\\.net(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"fortis.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Fortis", patternEnc:{kind:"regex",source:"^https:\\/\\/api\\.fortis\\.tech(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"jsbasistheory.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Basis Theory", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:api|js)\\.basistheory\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"braintree.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Braintree", patternEnc:{kind:"regex",source:"^https:\\/\\/payments\\.braintree-api\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"mercadopago.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"Mercado Pago", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:api|sdk)\\.mercadopago\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"xendit.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Xendit", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:api\\.xendit\\.co\\/v2\\/credit_card_tokens|pali-orchestrator-prod-live\\.xendit\\.co)(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"razorpay.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"Razorpay", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:api|checkout|cdn)\\.razorpay\\.com(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"paystack.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"Paystack", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:standard|api|checkout|js)\\.paystack\\.(?:co|com)(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"payu.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"PayU India", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:test|secure|info|uat-partner)\\.payu\\.in(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"epicgames.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"Epic Games", patternEnc:{kind:"regex",source:"^https:\\/\\/payment-website-pci\\.ol\\.epicgames\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"appsnetpk.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"IPG (apps.net.pk)", patternEnc:{kind:"regex",source:"^https:\\/\\/ipg\\d*\\.apps\\.net\\.pk(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"primer.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Primer", patternEnc:{kind:"regex",source:"^https:\\/\\/sdk\\.api\\.primer\\.io(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"bluesnap.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"BlueSnap", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:www1\\.)?bluesnap\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:["ccNumber"], inject:{"client_meta.app":"Asheo","client_meta.version":"1.0.0"}, removalFields:["debug","logs"], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"bridgerpay.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"BridgerPay", patternEnc:{kind:"regex",source:"^https:\\/\\/checkout\\.bridgerpay\\.com\\/api\\/(?:v2\\/deposit\\/credit-card|n\\/payment-details-cache)(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"spreedly.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Spreedly", patternEnc:{kind:"regex",source:"^https:\\/\\/core\\.spreedly\\.com\\/v1\\/payment_methods(\\/restricted\\.json)?",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"openpay.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Openpay", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:sandbox-)?api\\.openpay\\.(?:mx|co|pe|com)(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"nmi.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"NMI", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:secure\\.)?nmi\\.com\\/api\\/transact\\.php",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"nmi.collectjs", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"NMI CollectJS", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:secure\\.)?nmi\\.com\\/token\\/api\\/save_multipart_token(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"tailoredpay.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"TailoredPay", patternEnc:{kind:"regex",source:"^https:\\/\\/tailoredpay\\.transactiongateway\\.com\\/token\\/api\\/save_multipart_token(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"sagepay.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Opayo (Sage Pay)", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:live|test|pi-live|pi-test)\\.sagepay\\.com(?:\\/|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"viva.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Viva", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:demo-)?api\\.vivapayments\\.com\\/nativecheckout\\/v2\\/chargetokens",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"codapayments.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Codapayments", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:api-tc|tc-api-card-sandbox)\\.codapayments\\.com\\/v1\\/(?:pub\\/)?direct\\/charges",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"checkout.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Checkout.com", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:api\\.(?:sandbox\\.)?|card-acquisition-gateway\\.)checkout\\.com\\/tokens",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"airwallex.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Airwallex", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:[a-z0-9-]+\\.)*airwallex\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"tokenex.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"TokenEx", patternEnc:{kind:"regex",source:"^https:\\/\\/htp\\.tokenex\\.com\\/iframe\\/v3",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"cashfree.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"Cashfree", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:sandbox\\.|api\\.|sdk\\.|payments\\.)?cashfree\\.com\\/(?:checkout\\/api\\/checkouts\\/payments\\/?)?",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"zuora.default", defaultVersion:2, isDefault:true, swapCapable:true, enabled:true, name:"Zuora", patternEnc:{kind:"regex",source:"^https:\\/\\/rest\\.(?:[a-z0-9-]+\\.)*zuora\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"vgs.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"VGS", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:vgsapi\\.com|[a-z0-9-]+\\.(?:sandbox|live)\\.verygoodproxy\\.com)\\/cards(?:[/?#]|$)",flags:"i"}, matchContentType:null, requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"patreon.default", defaultVersion:1, isDefault:true, swapCapable:true, enabled:true, name:"Patreon", patternEnc:{kind:"regex",source:"^https:\\/\\/(?:www\\.)?patreon\\.com(?:\\/|$)",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"] },
  { defaultId:"authorizenet.default", defaultVersion:1, isDefault:true, enabled:true, name:"Authorize.Net", patternEnc:{kind:"regex",source:"^https:\\/\\/api2\\.authorize\\.net\\/xml\\/v1\\/request\\.api",flags:"i"}, matchContentType:"application/json", requiredKeys:[], inject:{}, removalFields:[], lockFields:["defaultId","isDefault","patternEnc","name"], swapCapable:false }
];

const EXCLUSIVE_TARGETS = [
  {hostSuffix:"checkoutshopper-live.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments"},
  {hostSuffix:"checkoutshopper-live.adyen.com", id:"adyen", method:"POST", pathPattern:"/sessions"},
  {hostSuffix:"checkoutshopper-live.adyen.com", id:"adyen", method:"POST", pathPattern:"/paymentMethods"},
  {hostSuffix:"checkoutshopper-live-us.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments"},
  {hostSuffix:"checkoutshopper-live-eu.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments"},
  {hostSuffix:"checkoutshopper-test.adyen.com", id:"adyen", method:"POST", pathPattern:"/payments"},
  {hostSuffix:"pal-test.adyen.com", id:"adyen", method:"POST", pathPattern:"/pal/servlet/"},
  {hostSuffix:"pal-live.adyen.com", id:"adyen", method:"POST", pathPattern:"/pal/servlet/"}
];

const GATEWAYS_META = [
  {id:'default-stripe',name:'Stripe',pattern:'https://js.stripe.com/*',enabled:true,isDefault:true},
  {id:'default-checkout',name:'Checkout.com',pattern:'https://*.checkout.com/*',enabled:true,isDefault:true},
  {id:'default-adyen',name:'Adyen',pattern:'https://*.adyen.com/*',enabled:true,isDefault:true},
  {id:'default-braintree',name:'Braintree',pattern:'https://*.braintreegateway.com/*',enabled:true,isDefault:true}
];

const CAMPAIGNS = [{id:'default-1',name:'Default Campaign',enabled:true,createdAt:new Date().toISOString()}];

/* ═══ REDIS (Upstash REST) com timeout e retry ═══ */
function normalizeKey(k){ if(!k||typeof k!=='string')return ''; return k.trim().toUpperCase().replace(/\s+/g,'').replace(/[^A-Z0-9\-]/g,''); }
async function redisCmd(args, retries = 1) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) throw new Error('redis_not_configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(UPSTASH_URL, { method:'POST', headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}`, 'Content-Type':'application/json' }, body: JSON.stringify(args), signal: ctrl.signal });
    if (!r.ok) throw new Error('redis_http_'+r.status);
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return d.result;
  } catch (e) {
    if (retries > 0 && (e.name === 'AbortError' || /redis_http_5/.test(e.message))) {
      return redisCmd(args, retries - 1);
    }
    throw e;
  } finally { clearTimeout(timer); }
}
async function redisSet(key, value) { return redisCmd(['SET', normalizeKey(key), typeof value === 'string' ? value : JSON.stringify(value)]); }
async function redisGetRaw(key) { const v = await redisCmd(['GET', normalizeKey(key)]); if (v == null) return null; try { return JSON.parse(v); } catch { return v; } }
async function redisGet(key) { const v = await redisGetRaw(key); return v ? migrarLicenca(v) : null; }
async function redisDel(key) { return redisCmd(['DEL', normalizeKey(key)]); }
async function redisScan(pattern='ASHEO-*') {
  const out = []; let cursor = '0';
  do {
    const res = await redisCmd(['SCAN', cursor, 'MATCH', pattern, 'COUNT', 200]);
    if (!Array.isArray(res) || res.length !== 2) throw new Error('redis_scan_invalid');
    cursor = String(res[0]);
    if (Array.isArray(res[1])) out.push(...res[1]);
  } while (cursor !== '0');
  return out.filter(k => typeof k === 'string');
}
// Índice reverso installId -> licenseKey
async function redisIndexInstall(installId, licenseKey) { return redisCmd(['SET', normalizeKey('ASHEO-INSTALL-' + installId), normalizeKey(licenseKey)]); }
// [FIX #14] auto-recuperação do índice via SCAN
async function redisLookupInstall(installId) {
  const direct = await redisCmd(['GET', normalizeKey('ASHEO-INSTALL-' + installId)]);
  if (direct) return direct;
  try {
    const keys = await redisScan('ASHEO-*');
    for (const k of keys) {
      if (k.startsWith('ASHEO-INSTALL-') || k.startsWith('ASHEO-USER') || k.startsWith('ASHEO-CONV-') || k.startsWith('ASHEO-CAMPAIGN') || k.startsWith('ASHEO-NONCE-') || k.startsWith('ASHEO-ENCGW-')) continue;
      const lic = await redisGet(k).catch(()=>null);
      if (lic && lic.installId === installId) {
        await redisIndexInstall(installId, k).catch(()=>{});
        log('WARN', `Índice ASHEO-INSTALL-${String(installId).slice(0,12)}… recuperado via SCAN → ${k}`);
        return k;
      }
    }
  } catch (e) { log('WARN', 'redisLookupInstall SCAN falhou: ' + e.message); }
  return null;
}
async function redisDelIndexInstall(installId) { return redisCmd(['DEL', normalizeKey('ASHEO-INSTALL-' + installId)]); }
// [FIX #20] INCR atômico para cliques de campanha
async function redisIncr(key) { return redisCmd(['INCR', normalizeKey(key)]); }
// Nonce replay protection
async function redisCheckNonce(nonce) {
  if (!nonce) return { ok: true };
  try {
    const r = await redisCmd(['SET', normalizeKey('ASHEO-NONCE-' + nonce), '1', 'NX', 'EX', '300']);
    return r === 'OK' ? { ok: true } : { ok: false, error: 'hmac_replay' };
  } catch (e) { return { ok: true, degraded: true }; } // se Redis falhar, não bloqueia
}

/* ═══ HELPERS ═══ */
function migrarLicenca(lic) {
  if (!lic || typeof lic !== 'object') return lic;
  const n = { ...lic };
  if (!n.plano && n.plan) n.plano = n.plan === 'premium' ? 'life' : n.plan;
  if (!n.plano) n.plano = '30d';
  const pk = PACOTES[n.plano];
  if (!n.planoNome) n.planoNome = pk ? pk.nome : 'Premium';
  if (typeof n.dias !== 'number') n.dias = pk ? pk.dias : 30;
  n.lifetime = n.plano === 'life';
  n.ilimitada = n.lifetime;
  if (!n.criadaEm && n.createdAt) n.criadaEm = n.createdAt;
  if (!n.criadaEm) n.criadaEm = Date.now();
  // [FIX #51] não recalcular se expiraEm=0 (epoch = expirada)
  if (typeof n.expiraEm !== 'number') { n.expiraEm = n.lifetime ? n.criadaEm + (100*365*24*60*60*1000) : n.criadaEm + (n.dias*24*60*60*1000); }
  if (typeof n.ativa !== 'boolean') n.ativa = typeof n.active === 'boolean' ? n.active : true;
  if (typeof n.preco === 'string') n.preco = parseFloat(n.preco.replace(/[^\d.,]/g,'').replace(',','.')) || 0;
  if (!n.preco) n.preco = pk ? pk.preco : 0;
  n.preco_usd = n.preco; n.preco_fmt = precoFmt(n.preco);
  return n;
}
function signToken(claims, kid){ if(!PRIVATE_KEY) throw new Error('Chave privada nao inicializada'); const opts = { algorithm:'ES256' }; if (kid) opts.keyid = kid; return jwt.sign(claims, PRIVATE_KEY, opts); }
function formatDate(ts){ if(!ts || ts <= 0) return 'Nunca'; return new Date(ts).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); }
function humanTime(ms){ if(ms<=0) return '✕ expirada'; const s=Math.floor(ms/1000), d=Math.floor(s/86400), h=Math.floor((s%86400)/3600), m=Math.floor((s%3600)/60); if(d>0) return `${d}d ${h}h ${m}m`; if(h>0) return `${h}h ${m}m`; return `${m}m`; }
function progressBar(pct, size=10){ pct = Math.max(0, Math.min(100, Number(pct)||0)); const cheio = Math.round(pct*size/100); return '▰'.repeat(cheio) + '▱'.repeat(size-cheio); }
function generateLicenseKey(){ const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const b=()=>{let s='';for(let i=0;i<4;i++)s+=chars[crypto.randomInt(0,chars.length)];return s;}; return `ASHEO-${b()}-${b()}-${b()}-${b()}`; }
function validateBearer(req){ const auth=req.headers['authorization']||''; if(!auth.startsWith('Bearer '))return {ok:false,error:'missing_bearer'}; try{ const d=jwt.verify(auth.substring(7),PUBLIC_KEY||PRIVATE_KEY,{algorithms:['ES256'],clockTolerance:30}); return {ok:true,decoded:d}; } catch(e){ return {ok:false,error:e.message}; } }
function validateAsheoPass(req){ const auth=req.headers['authorization']||''; if(!auth.startsWith('Asheo-Pass '))return {ok:false,error:'missing_asheo_pass'}; try{ const d=jwt.verify(auth.substring(11).trim(),PUBLIC_KEY||PRIVATE_KEY,{algorithms:['ES256'],clockTolerance:30}); return {ok:true,decoded:d,mode:'asheo-pass'}; } catch(e){ return {ok:false,error:'asheo_pass_invalid:'+e.message}; } }
function validateAnyAuth(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return validateBearer(req);
  if (auth.startsWith('Asheo-Pass ')) return validateAsheoPass(req);
  return { ok:false, error:'missing_auth' };
}
function buildSecret(installId, licenseKey) { return crypto.createHash('sha256').update(String(installId||'') + ':' + String(licenseKey||'') + ':asheo-secret-v1').digest('hex'); }
function buildKid(licenseKey) {
  if (!licenseKey) return null;
  const norm = normalizeKey(licenseKey);
  const parts = norm.split('-');
  if (parts.length >= 2 && parts[0] === 'ASHEO') return `${parts[0]}-${parts[1]}`;
  return norm.substring(0, 14);
}
function buildEntitlement(lic, installId, seatsUsed = 1) {
  const isPremium = lic && lic.ativa && (lic.lifetime || lic.expiraEm > Date.now());
  const plano = lic ? lic.plano : 'free';
  const isTrial = plano === '3d' || (lic && lic.trial);
  const features = {}; FEATURE_KEYS.forEach(k => { features[k] = !!isPremium; });
  const capabilities = {}; CAPABILITY_KEYS.forEach(k => { capabilities[k] = !!isPremium; });
  const limits = {}; LIMIT_KEYS.forEach(k => { limits[k] = k === 'randomRouting' ? !!isPremium : (isPremium ? null : 2); });
  // [FIX #23] usar FREE_LIMITS consistentes em vez de 2 hardcoded
  const freeLimits = { ...FREE_LIMITS };
  if (!isPremium) LIMIT_KEYS.forEach(k => { limits[k] = freeLimits[k] !== undefined ? freeLimits[k] : (k === 'randomRouting' ? false : 2); });
  return {
    tier: isPremium ? 'premium' : 'free',
    plan: isPremium ? (isTrial ? 'trial' : 'premium') : 'free',
    planDisplayName: isPremium ? (isTrial ? 'Premium Trial' : 'Premium') : 'Free',
    licenseType: isPremium ? (isTrial ? 'trial' : 'premium') : 'free',
    status: isPremium ? 'active' : 'inactive',
    source: lic ? 'license' : 'free',
    isFounder: false,
    activatedAt: lic ? (lic.ativadaEm || lic.criadaEm) : null,
    expiresAt: lic ? lic.expiraEm : null,
    nextBillingDate: lic ? lic.expiraEm : null,
    seatsAllowed: 1,
    seatsUsed: isPremium ? Math.max(1, seatsUsed) : 0,
    activationCount: isPremium ? Math.max(1, seatsUsed) : 0,
    maxActivations: null,
    currentDeviceId: installId,
    deviceLocked: !!(lic && lic.installId),
    canTransfer: false,
    features, featureKeys: FEATURE_KEYS,
    customFeatures: {},
    capabilities, capabilityKeys: CAPABILITY_KEYS,
    limits, limitKeys: LIMIT_KEYS,
    metadata: lic ? { trial: isTrial, trialHours: isTrial ? 36 : null } : {}
  };
}
function deriveAesKey(installId, licenseKey) { return Buffer.from(buildSecret(installId, licenseKey || 'guest'), 'hex'); }
function encryptPack(data, installId, licenseKey) {
  const key = deriveAesKey(installId, licenseKey);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // [NOTA] base64 PADRÃO (não base64url) — o cliente usa atob() direto
  return { ct: Buffer.concat([encrypted, tag]).toString('base64'), nonce: nonce.toString('base64'), v: RULES_VERSION };
}

const provCache = new Map();
function generateProv(installId, kid) {
  if (!PRIVATE_KEY) return null;
  const key = installId ? (installId + ':' + (kid || '')) : 'default';
  const cached = provCache.get(key);
  if (cached && (Date.now() - cached.ts) < 55 * 60 * 1000) return cached.prov;
  try {
    const opts = { algorithm:'ES256', expiresIn:'1h' };
    if (kid) opts.keyid = kid;
    const prov = jwt.sign({ sub: installId || 'default', jti: crypto.randomUUID(), iat: Math.floor(Date.now()/1000) }, PRIVATE_KEY, opts);
    provCache.set(key, { prov, ts: Date.now() });
    return prov;
  } catch (e) { log('ERRO','generateProv: '+e.message); return null; }
}
// [FIX #3] gwPass alinhado com cache de 23h do cliente
function buildGwPass(installId, expSec, kid) {
  if (!PRIVATE_KEY) return null;
  const now = Math.floor(Date.now()/1000);
  const exp = expSec || (now + 82800); // 23h
  const opts = { algorithm:'ES256' };
  if (kid) opts.keyid = kid;
  return jwt.sign({ sub: installId, purpose:'gw-pass', iat: now, exp, jti: crypto.randomUUID() }, PRIVATE_KEY, opts);
}

const rlMap = new Map();
function rateLimit(key, max = 20, windowMs = 60000) {
  const now = Date.now();
  const rec = rlMap.get(key) || { count: 0, ts: now };
  if (now - rec.ts > windowMs) { rec.count = 0; rec.ts = now; }
  rec.count++;
  rlMap.set(key, rec);
  return rec.count <= max;
}
const rlInterval = setInterval(() => { const now = Date.now(); for (const [k,v] of rlMap.entries()) if (now - v.ts > 5*60*1000) rlMap.delete(k); }, 60000);
if (rlInterval.unref) rlInterval.unref();

/* ═══════════════════════════════════════════════════════════════
   HMAC — aceita 3 formatos da extensão v1.6.2
   ───────────────────────────────────────────────────────────────
   A: inject.js       → METHOD\nPATHNAME\nSEARCH\nTS\nBODYHASH\nBUILD
   B: server-session  → METHOD\nPATH\nNONCE\nTS\nBODYHASH\nBUILD
   C: deactivate      → METHOD\nPATH\n\nTS\nBODYHASH   (sem build)
   ═══════════════════════════════════════════════════════════════ */
async function validateHmac(req, rawBody) {
  const installId = req.headers['x-asheo-install'];
  const ts = req.headers['x-asheo-ts'];
  const sig = req.headers['x-asheo-sig'];
  const build = req.headers['x-asheo-build'] || '';
  const nonce = req.headers['x-asheo-nonce'] || '';
  if (!installId || !ts || !sig) return { ok: false, error: 'missing_hmac_headers' };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - Number(ts)) > 300) return { ok: false, error: 'hmac_expired' };

  // Replay protection (best-effort)
  if (nonce) {
    const n = await redisCheckNonce(nonce);
    if (!n.ok) return { ok: false, error: n.error };
  }

  let licenseKey = null;
  try { licenseKey = await redisLookupInstall(installId); } catch (e) { return { ok: false, error: 'hmac_lookup_failed' }; }
  if (!licenseKey) return { ok: false, error: 'hmac_unknown_install' };

  // [FIX #5] checar licença ativa/expirada
  const lic = await redisGet(licenseKey).catch(()=>null);
  if (!lic) return { ok: false, error: 'hmac_license_not_found' };
  if (!lic.ativa) return { ok: false, error: 'hmac_revoked' };
  if (!lic.lifetime && Date.now() > lic.expiraEm) return { ok: false, error: 'hmac_license_expired' };

  const secret = buildSecret(installId, licenseKey);
  const method = (req.headers['x-asheo-method'] || req.method).toUpperCase();
  const url = new URL(req.originalUrl, 'https://placeholder');
  const pathname = url.pathname;
  const search = url.search || '';
  const bodyStr = rawBody ? rawBody.toString('utf8') : '';
  const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');

  const candidates = [
    { fmt: 'inject',     payload: `${method}\n${pathname}\n${search}\n${ts}\n${bodyHash}\n${build}` },
    { fmt: 'session',    payload: `${method}\n${pathname}\n${nonce}\n${ts}\n${bodyHash}\n${build}` },
    { fmt: 'deactivate', payload: `${method}\n${pathname}\n\n${ts}\n${bodyHash}` },
    { fmt: 'legacy',     payload: `${method}\n${pathname}\n\n${ts}\n${bodyHash}\n${build}` }
  ];

  let a;
  try { a = Buffer.from(sig, 'hex'); } catch { return { ok: false, error: 'hmac_sig_not_hex' }; }

  for (const c of candidates) {
    const expected = crypto.createHmac('sha256', secret).update(c.payload).digest('hex');
    try {
      const b = Buffer.from(expected, 'hex');
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        return { ok: true, licenseKey, format: c.fmt, lic };
      }
    } catch {}
  }
  return { ok: false, error: 'hmac_invalid' };
}

function sendMaybeGzip(req, res, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  if (req.method === 'HEAD') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end();
  }
  const acceptEnc = String(req.headers['accept-encoding'] || '').toLowerCase();
  if (acceptEnc.includes('gzip') && body.length > 512) {
    try {
      const gz = zlib.gzipSync(Buffer.from(body, 'utf8'));
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('X-Compressed', 'gzip');
      return res.send(gz);
    } catch (e) { log('WARN', 'gzip falhou: ' + e.message); }
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.send(body);
}

/* ═══ SSRF — hostname + whitelist de sufixo ═══ */
const ALLOWED_SUFFIXES = [
  'stripe.com','worldpay.com','endurance.com','safecharge.com','paddle.com','adyen.com',
  'boosteroid.com','chess.com','gog.com','lootbar.com','xsolla.com','recurly.com',
  'tebex.io','nordpayments.com','grammarly.com','gr4vy.app','rizzup.net','fortis.tech',
  'basistheory.com','braintree-api.com','mercadopago.com','xendit.co','razorpay.com',
  'paystack.co','paystack.com','payu.in','epicgames.com','apps.net.pk','primer.io',
  'bluesnap.com','bridgerpay.com','spreedly.com','openpay.mx','openpay.co','openpay.pe',
  'nmi.com','transactiongateway.com','sagepay.com','vivapayments.com','codapayments.com',
  'checkout.com','airwallex.com','tokenex.com','cashfree.com','zuora.com','verygoodproxy.com',
  'patreon.com','authorize.net'
];
// [FIX #22] simplificado: testa regex E sufixo
function isAllowedTarget(targetUrl, specialHosts = []) {
  if (!targetUrl || typeof targetUrl !== 'string') return false;
  let u;
  try { u = new URL(targetUrl); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  // Special hosts (custom encrypted gateways) já validados contra Redis no caller
  if (Array.isArray(specialHosts)) {
    for (const sh of specialHosts) {
      if (sh && sh.host && host === String(sh.host).toLowerCase()) return true;
    }
  }
  for (const r of PAYMENT_RULES) {
    try {
      if (new RegExp(r.patternEnc.source, r.patternEnc.flags || 'i').test(targetUrl)) return true;
    } catch {}
  }
  return ALLOWED_SUFFIXES.some(s => host === s || host.endsWith('.' + s));
}

/* [FIX #6] valida specialHosts contra o que a licença tem registrado no Redis */
async function validateSpecialHosts(licenseKey, claimed) {
  if (!licenseKey || !Array.isArray(claimed) || !claimed.length) return [];
  try {
    const licensed = await redisGetRaw(`ASHEO-ENCGW-${normalizeKey(licenseKey)}`).catch(()=>null) || [];
    const allowed = new Set(
      (Array.isArray(licensed) ? licensed : [])
        .filter(e => e && e.enabled !== false && String(e.forwardMode || '').toLowerCase() === 'server')
        .map(e => {
          try { return new URL(String(e.pattern || '')).hostname.toLowerCase(); } catch { return null; }
        })
        .filter(Boolean)
    );
    return claimed.filter(sh => sh && sh.host && allowed.has(String(sh.host).toLowerCase()));
  } catch (e) {
    log('WARN', 'validateSpecialHosts falhou: ' + e.message);
    return [];
  }
}

/* ═══════════════════════════════════════════════
   ◈ HEALTH · VERSION · STATUS · KEYS
   ═══════════════════════════════════════════════ */
const healthHandler = (req,res) => res.json({ok:true,status:'healthy',uptime:Math.floor(process.uptime()),version:'9.0.0',codename:'Quantum+ Hardened',timestamp:new Date().toISOString()});
app.get('/',(req,res)=>res.json({ok:true,service:'mozlince-nebula',version:'9.0.0',codename:'Quantum+ Hardened',status:'live',serverUrl:SERVER_URL,extensionApiBase:EXT_API_BASE_DEFAULT}));
app.get('/v1/health',healthHandler); app.get('/api/v1/health',healthHandler); app.get('/health',healthHandler);

app.get('/v1/keys/jwk', (req,res) => {
  if (!JWK_PUBLIC) return res.status(500).json({ok:false,error:'no_private_key'});
  res.json({
    ok:true,
    jwk: JWK_PUBLIC,
    expected: EXPECTED_JWK,
    matches: JWK_PUBLIC.x === EXPECTED_JWK.x && JWK_PUBLIC.y === EXPECTED_JWK.y,
    hint:'Compare x/y com o PUBLIC_JWK de server-session.js da extensão.'
  });
});

function versionHandler(req,res){
  res.json({
    ok:true, version:'9.0.0', versionName:'Quantum+ Hardened', codename:'Quantum+ Hardened', api:'v1',
    minClientVersion:'1.0.0',
    downloadUrl:'https://download.asheobypasser.net/get',
    notes:'API alinhada com extensão v1.6.2 · HMAC 3 formatos · proxy __asheo · rotas /v1/process/*',
    mandatory:false, channel:'stable',
    timestamp:new Date().toISOString()
  });
}
app.get('/v1/version',versionHandler); app.get('/api/v1/version',versionHandler);

const statusHandler = (req,res)=>res.json({ok:true,service:'mozlince-nebula',version:'9.0.0',codename:'Quantum+ Hardened',hora:new Date().toISOString()});
app.get('/v1/status',statusHandler); app.get('/api/v1/status',statusHandler);

/* ═══ MAP FUNCTIONS ═══ */
function mapFeatures(on) { const o={}; FEATURE_KEYS.forEach(k=>o[k]=!!on); return o; }
function mapCapabilities(on) { const o={}; CAPABILITY_KEYS.forEach(k=>o[k]=!!on); return o; }

/* ═══ BOOTSTRAP (valida HMAC e checa licença; inclui campaign+manifest) ═══ */
async function bootstrapHandler(req,res){
  const auth = validateAnyAuth(req);
  let hmac = { ok: false };
  if (!auth.ok) hmac = await validateHmac(req, req.rawBody);
  const ok = auth.ok || hmac.ok;
  const installId = req.headers['x-asheo-install'] || req.headers['x-install-id'] || (auth.ok ? auth.decoded.sub : (hmac.ok ? req.headers['x-asheo-install'] : 'default'));
  const licenseKey = auth.ok ? (auth.decoded.licenseKey || '') : (hmac.ok ? hmac.licenseKey : '');
  const kid = licenseKey ? buildKid(licenseKey) : 'ASHEO-FREEREF';
  const prov = generateProv(installId, kid);
  const secretHex = buildSecret(installId, licenseKey || 'guest');
  const packKey = Buffer.from(secretHex, 'hex').toString('base64');
  const encPack = encryptPack({ rules: PAYMENT_RULES, version: RULES_VERSION }, installId, licenseKey);
  if (hmac.ok) res.setHeader('x-asheo-hmac-format', hmac.format || 'unknown');
  res.setHeader('x-asheo-pack-fmt', 'enc');
  // [FIX #2] campaign + manifest no bootstrap
  const campaign = await redisGetRaw('ASHEO-CAMPAIGN-ACTIVE').catch(()=>null);
  const manifest = {
    version: '1.7.0', version_name: '1.7.0', generatedAt: new Date().toISOString(), minVersion: '1.0.0',
    exclusiveFeatures: FEATURE_KEYS,
    rules: PAYMENT_RULES,
    targets: EXCLUSIVE_TARGETS,
    gateways: GATEWAYS_META,
    signature: prov
  };
  // [FIX #4] tier/features/limits condicionais a ok
  const tier = ok ? 'premium' : 'free';
  const features = ok ? mapFeatures(true) : mapFeatures(false);
  const capabilities = ok ? mapCapabilities(true) : mapCapabilities(false);
  const limits = ok ? { ...PREMIUM_LIMITS } : { ...FREE_LIMITS };
  log('BOOT', `Bootstrap auth=${auth.ok} hmac=${hmac.ok}${hmac.ok?'('+hmac.format+')':''} installId=${String(installId).substring(0,12)}… tier=${tier} pack=${encPack.ct.length}b`);
  res.json({
    ok:true, version:'9.0.0', codename:'Quantum+ Hardened', apiVersion:'v1',
    issuedAt:new Date().toISOString(), serverTime:Date.now(),
    source: tier, sourceType:'server', isFounder:false, tier, kind: tier,
    rulesVersion: RULES_VERSION, v: RULES_VERSION,
    pack: { encPack: encPack, k: packKey }, encPack: encPack, k: packKey, _prov: prov,
    campaign: campaign ? (campaign.manifest || null) : null,
    manifest,
    rules: PAYMENT_RULES, count: PAYMENT_RULES.length, gateways: PAYMENT_RULES,
    exclusive: { targets: EXCLUSIVE_TARGETS, version: '1.7.0', generatedAt: new Date().toISOString(), signature: prov },
    config:{ apiBase: SERVER_URL, featuresEnabled: ok, premiumEnabled: ok, syncEnabled:true, gatewayMode:'default', telemetryEnabled:false, retryAfterMs:5000, heartbeatMs:60000 },
    flags:{ bootstrapReady:true, exclusiveEnabled: ok, rulesEnabled: ok, premium: ok },
    endpoints:{ activate:'/v1/activate',featureActivate:'/v1/feature/activate',deactivate:'/v1/deactivate',verify:'/v1/verify',bootstrap:'/v1/bootstrap',rules:'/v1/rules',gateways:'/v1/gateways',campaign:'/v1/campaign',dashboard:'/v1/dashboard',health:'/v1/health',version:'/v1/version',support:'/v1/support',paymentRules:'/v1/bootstrap',timehw:'/v1/timehw',update:'/v1/update/check',process:'/v1/process',gw3ds2:'/v1/gw/3ds2/*splat' },
    features, capabilities, limits, scope: ok ? PREMIUM_SCOPE : ['free']
  });
}
app.get('/v1/bootstrap',bootstrapHandler); app.get('/api/v1/bootstrap',bootstrapHandler);

/* ═══ RULES (valida HMAC + licença; tier condicional) ═══ */
async function rulesHandler(req,res){
  const auth = validateAnyAuth(req);
  let hmac = { ok: false };
  if (!auth.ok) hmac = await validateHmac(req, req.rawBody);
  const ok = auth.ok || hmac.ok;
  const installId = req.headers['x-asheo-install'] || req.headers['x-install-id'] || (auth.ok ? auth.decoded.sub : (hmac.ok ? req.headers['x-asheo-install'] : 'default'));
  const licenseKey = auth.ok ? (auth.decoded.licenseKey || '') : (hmac.ok ? hmac.licenseKey : '');
  const kid = licenseKey ? buildKid(licenseKey) : 'ASHEO-FREEREF';
  const prov = generateProv(installId, kid);
  const packFmt = (req.headers['x-asheo-pack-fmt'] || '').toLowerCase();
  const secretHex = buildSecret(installId, licenseKey || 'guest');
  const packKey = Buffer.from(secretHex, 'hex').toString('base64');
  const encPack = encryptPack({ rules: PAYMENT_RULES, version: RULES_VERSION }, installId, licenseKey);
  if (hmac.ok) res.setHeader('x-asheo-hmac-format', hmac.format || 'unknown');
  if (packFmt === 'enc') {
    res.setHeader('x-asheo-pack-fmt', 'enc');
    log('RULES', `/v1/rules enc ${String(installId).substring(0,12)}… ${encPack.ct.length}b (auth=${ok})`);
    return sendMaybeGzip(req, res, { ok:true, version: RULES_VERSION, v: RULES_VERSION, pack: { encPack: encPack, k: packKey }, k: packKey, _prov: prov, serverTime: Date.now() });
  }
  sendMaybeGzip(req, res, {
    ok:true, version: RULES_VERSION, v: RULES_VERSION,
    updatedAt:new Date().toISOString(), source: ok?'premium':'free', tier: ok?'premium':'free',
    scope: ok ? PREMIUM_SCOPE : ['free'], count: PAYMENT_RULES.length,
    rules: PAYMENT_RULES, gateways: PAYMENT_RULES,
    pack: { encPack }, k: packKey, _prov: prov,
    serverTime: Date.now()
  });
}
app.get('/v1/rules',rulesHandler); app.get('/api/v1/rules',rulesHandler); app.get('/v1/rules/sync',rulesHandler); app.get('/api/v1/sync',rulesHandler);

async function gatewaysHandler(req,res){
  const auth = validateAnyAuth(req);
  let hmac = { ok: false };
  if (!auth.ok) hmac = await validateHmac(req, req.rawBody);
  const ok = auth.ok || hmac.ok;
  const installId = req.headers['x-asheo-install'] || req.headers['x-install-id'] || (auth.ok ? auth.decoded.sub : (hmac.ok ? req.headers['x-asheo-install'] : 'default'));
  const licenseKey = auth.ok ? (auth.decoded.licenseKey || '') : (hmac.ok ? hmac.licenseKey : '');
  const kid = licenseKey ? buildKid(licenseKey) : 'ASHEO-FREEREF';
  const prov = generateProv(installId, kid);
  sendMaybeGzip(req, res, { ok:true, source: ok?'premium':'free', tier: ok?'premium':'free', version: RULES_VERSION, count: PAYMENT_RULES.length, gateways: PAYMENT_RULES, gatewaysMeta: GATEWAYS_META, _prov: prov, serverTime:Date.now() });
}
app.get('/v1/gateways',gatewaysHandler); app.get('/api/v1/gateways',gatewaysHandler);

async function campaignHandler(req,res){ const camp = await redisGetRaw('ASHEO-CAMPAIGN-ACTIVE').catch(()=>null); sendMaybeGzip(req, res, { ok:true, campaign: camp ? (camp.manifest || null) : null, serverTime:Date.now() }); }
app.get('/v1/campaign',campaignHandler); app.get('/api/v1/campaign',campaignHandler);

/* ═══ EXCLUSIVE MANIFEST (valida specialHosts contra Redis) ═══ */
async function exclusiveHandler(req,res){
  const auth = validateAnyAuth(req);
  let hmac = { ok: false };
  if (!auth.ok) hmac = await validateHmac(req, req.rawBody);
  const ok = auth.ok || hmac.ok;
  const installId = req.headers['x-asheo-install'] || (auth.ok ? auth.decoded.sub : (hmac.ok ? req.headers['x-asheo-install'] : 'default'));
  const licenseKey = auth.ok ? (auth.decoded.licenseKey || '') : (hmac.ok ? hmac.licenseKey : '');
  const kid = licenseKey ? buildKid(licenseKey) : 'ASHEO-FREEREF';
  const prov = generateProv(installId, kid);
  let specialHosts = [];
  try {
    const raw = req.headers['x-asheo-special-hosts'];
    if (raw) {
      const claimed = JSON.parse(raw);
      specialHosts = await validateSpecialHosts(licenseKey, claimed); // [FIX #6]
    }
  } catch {}
  sendMaybeGzip(req, res, {
    ok:true, source: ok?'premium':'free', tier: ok?'premium':'free',
    manifest:{
      version:'1.7.0', version_name:'1.7.0', generatedAt:new Date().toISOString(), minVersion:'1.0.0',
      exclusiveFeatures: FEATURE_KEYS,
      rules: PAYMENT_RULES,
      targets: EXCLUSIVE_TARGETS,
      gateways: GATEWAYS_META,
      signature: prov
    },
    specialHostsReceived: specialHosts.length,
    _prov: prov, cachedAt:Date.now(), expiresAt:Date.now()+(23*3600*1000)
  });
}
app.get('/v1/exclusive/manifest',exclusiveHandler); app.get('/api/v1/manifest',exclusiveHandler);

async function exclusiveSyncHandler(req,res){
  const auth = validateAnyAuth(req);
  let hmac = { ok: false };
  if (!auth.ok) hmac = await validateHmac(req, req.rawBody);
  const ok = auth.ok || hmac.ok;
  const installId = req.headers['x-asheo-install'] || (auth.ok ? auth.decoded.sub : (hmac.ok ? req.headers['x-asheo-install'] : 'default'));
  const licenseKey = auth.ok ? (auth.decoded.licenseKey || '') : (hmac.ok ? hmac.licenseKey : '');
  const kid = licenseKey ? buildKid(licenseKey) : 'ASHEO-FREEREF';
  const prov = generateProv(installId, kid);
  sendMaybeGzip(req, res, {
    ok:true, source: ok?'premium':'free', tier: ok?'premium':'free',
    manifest:{
      version:'1.7.0', generatedAt:new Date().toISOString(),
      rules: PAYMENT_RULES, targets: EXCLUSIVE_TARGETS, gateways: GATEWAYS_META,
      signature: prov
    },
    _prov: prov, cachedAt:Date.now()
  });
}
app.get('/v1/exclusive/sync',exclusiveSyncHandler); app.get('/api/v1/exclusive/sync',exclusiveSyncHandler);

/* ═══ TIME · UPDATE ═══ */
app.get('/v1/timehw', (req,res) => res.json({ ok:true, maxServer: Date.now(), at: Date.now() }));
app.get('/api/v1/timehw', (req,res) => res.json({ ok:true, maxServer: Date.now(), at: Date.now() }));
app.get('/v1/update/check', (req,res) => res.json({ ok:true, available:false, dismissedVersion:'', error:'', lastCheck:Date.now(), latest:{ downloadUrl:'https://download.asheobypasser.net/get', version:'9.0.0', mandatory:false, notes:'Você está na versão mais recente.' } }));
app.get('/api/v1/update/check', (req,res) => res.json({ ok:true, available:false, latest:{ downloadUrl:'https://download.asheobypasser.net/get', version:'9.0.0', mandatory:false, notes:'OK' } }));

/* ═══ DASHBOARD · ENTITLEMENT · PREMIUM ═══ */
function dashboardHandler(req,res){
  const auth = validateAnyAuth(req);
  const ok = auth.ok && auth.decoded.tier === 'premium';
  res.json({ ok:true, source: ok?'premium':'free', sourceType:'server', isFounder:false, dashboard:{ tier: ok?'premium':'free', source: ok?'premium':'free', seat: auth.ok?1:0, seats: auth.ok?1:0, installId: auth.ok?auth.decoded.sub:null, expiresAt: auth.ok?auth.decoded.expiresAt:null, lifetime: auth.ok?auth.decoded.lifetime===true:false, features: ok?mapFeatures(true):mapFeatures(false), capabilities: ok?mapCapabilities(true):mapCapabilities(false), limits: ok?{...PREMIUM_LIMITS}:{...FREE_LIMITS}, scope: ok?PREMIUM_SCOPE:['free'] }, serverTime:Date.now() });
}
app.get('/v1/dashboard',dashboardHandler); app.get('/api/v1/dashboard',dashboardHandler);

function entitlementHandler(req,res){
  const auth = validateAnyAuth(req);
  if (!auth.ok) return res.status(401).json({ok:false,error:'missing_auth'});
  const isPremium = auth.decoded.tier === 'premium' && !!(auth.decoded.licenseKey || auth.decoded.plano);
  const ent = buildEntitlement(isPremium ? { ativa:true, plano: auth.decoded.plano || 'life', lifetime: auth.decoded.lifetime === true, expiraEm: auth.decoded.expiresAt || (Date.now()+9999999), criadaEm: auth.decoded.issuedAt || Date.now() } : null, auth.decoded.sub, isPremium ? 1 : 0);
  res.json({ ok:true, source: isPremium?'premium':'free', sourceType:'server', isFounder:false, tier:ent.tier, kind: isPremium?'premium':'free', active: isPremium, isPremium, isVerified: isPremium, installId:auth.decoded.sub, plan:ent.plan, planDisplayName:ent.planDisplayName, lifetime: auth.decoded.lifetime === true, licenseKey: auth.decoded.licenseKey || null, issuedAt: auth.decoded.issuedAt || null, expiresAt: auth.decoded.expiresAt || null, scope: isPremium?PREMIUM_SCOPE:['free'], features: mapFeatures(isPremium), capabilities: mapCapabilities(isPremium), limits: isPremium?{...PREMIUM_LIMITS}:{...FREE_LIMITS}, exp: auth.decoded.exp*1000, serverTime:Date.now() });
}
app.get('/v1/entitlement',entitlementHandler); app.get('/api/v1/entitlement',entitlementHandler);

const PREMIUM_FEATURES_DEF = { browser_mods:{enabled:true,label:'Browser Mods'}, rule_ops_lab:{enabled:true,label:'Rule Ops Lab'}, live_injection_hud:{enabled:true,label:'Live Injection HUD'}, algo_v2:{enabled:true,label:'Algo V2'}, exclusive_rules:{enabled:true,label:'Exclusive Rules'}, advanced_automation:{enabled:true,label:'Advanced Automation'}, multi_account:{enabled:true,label:'Multi Account'}, custom_export:{enabled:true,label:'Custom Export'}, api_access:{enabled:true,label:'API Access'} };
const PREMIUM_CAPABILITIES_DEF = { priority_support:{enabled:true,label:'Priority Support'}, custom_webhooks:{enabled:true,label:'Custom Webhooks'}, cloud_sync:{enabled:true,label:'Cloud Sync'}, bulk_actions:{enabled:true,label:'Bulk Actions'}, advanced_analytics:{enabled:true,label:'Advanced Analytics'} };
function premiumDefHandler(req,res){ res.json({ ok:true, source:'premium', tier:'premium', features: PREMIUM_FEATURES_DEF, capabilities: PREMIUM_CAPABILITIES_DEF, premiumLimits: PREMIUM_LIMITS, freeLimits: FREE_LIMITS, scope: PREMIUM_SCOPE, version:'9.0.0' }); }
app.get('/v1/premium/definitions',premiumDefHandler); app.get('/api/v1/premium/definitions',premiumDefHandler);

function planosHandler(req,res){ res.json({ ok:true, currency:'USD', planos: Object.entries(PACOTES).map(([id,p])=>({ id, nome:p.nome, dias:p.dias, lifetime:p.lifetime, preco:p.preco, preco_fmt:precoFmt(p.preco), emoji:p.emoji })) }); }
app.get('/v1/planos',planosHandler); app.get('/api/v1/planos',planosHandler);

function manifestCheckHandler(req,res){ res.json({ ok:true, latest:'1.8.0', minVersion:'1.0.0', channel: req.query.channel || 'stable', serverTime:Date.now() }); }
app.get('/v1/manifest/check',manifestCheckHandler); app.get('/api/v1/manifest',manifestCheckHandler);

function packsHandler(req,res){ const id = req.params.id; res.json({ ok:true, pack:{ id, version:'1.0.0', data:null, signature: crypto.randomBytes(32).toString('hex') }, serverTime:Date.now() }); }
app.get('/v1/packs/:id',packsHandler); app.get('/api/v1/packs/:id',packsHandler);

function telemetryHandler(req,res){ res.json({ ok:true, received:true, serverTime:Date.now() }); }
app.post('/v1/telemetry',telemetryHandler); app.post('/api/v1/telemetry',telemetryHandler);

// [FIX #40] rate limit + escapeHtml no support
function supportHandler(req,res){
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString();
  if (!rateLimit('support:' + ip, 10, 60000)) return res.status(429).json({ok:false,error:'rate_limited'});
  const {chatId,message} = req.body||{};
  if (!message) return res.status(400).json({ok:false,error:'missing_message'});
  if (chatId && OWNER_ID) tgSend(OWNER_ID, `<b>✆ SUPORTE (API)</b>\n<code>${escapeHtml(chatId)}</code>\n\n${escapeHtml(message)}`).catch(()=>{});
  res.json({ ok:true, received:true, serverTime:Date.now() });
}
app.post('/v1/support',supportHandler); app.post('/api/v1/support',supportHandler);

/* ═══ I18N ═══ */
const T = {
  pt: {
    menu_title:'⌬  PAINEL DE CONTROLE', menu_sub:'Selecione uma operação abaixo',
    online:'online', secure:'seguro',
    btn_generate:'⚡  Gerar Licença', btn_mykeys:'◈  Minhas Chaves', btn_stats:'◧  Estatísticas',
    btn_link:'⟡  Vincular', btn_unlink:'⌬  Desvincular', btn_query:'◉  Consultar',
    btn_prices:'✦  Tabela de Preços', btn_support:'✆  Suporte',
    btn_lang:'◐  Idioma / Language', btn_help:'?  Ajuda', btn_danger:'⚠  Zona de Perigo',
    btn_back:'‹  Voltar', btn_menu:'‹  Menu', btn_refresh:'↻  Atualizar', btn_cancel:'✕  Cancelar',
    btn_confirm_yes:'✓  Sim, confirmar', btn_confirm_no:'✕  Cancelar',
    welcome_title:'Bem-vindo ao Mozlince Nebula',
    welcome_desc:'Para adquirir uma licença premium, clique abaixo:',
    contact:'✆  CONTACTAR SUPORTE',
    support_title:'✆  Suporte', support_write:'Escreva sua mensagem agora:',
    support_hint:'(o próximo texto será encaminhado ao suporte)',
    support_exp:'Sessão expira em 10 minutos',
    support_sent:'✓  MENSAGEM ENVIADA',
    support_sent_desc:'Sua mensagem foi encaminhada.\nTempo de resposta: até 24h',
    support_cancelled:'✕  Suporte cancelado',
    gen_title:'⚡  Gerar Licença', gen_sub:'Escolha um plano abaixo:',
    gen_success:'✓  LICENÇA EMITIDA', gen_key:'Chave', gen_plan:'Plano', gen_price:'Preço',
    gen_issued:'Emitida', gen_expires:'Expira', gen_duration:'Duração',
    gen_lifetime:'Lifetime', gen_never:'Nunca', gen_yes:'Sim', gen_no:'Não',
    list_title:'◈  Minhas Licenças', list_empty:'Nenhuma licença cadastrada.', list_more:'+{n} ocultas',
    stats_title:'◧  Estatísticas', stats_total:'Total', stats_active:'Ativas',
    stats_expired:'Expiradas', stats_linked:'Vinculadas', stats_lifetime:'Lifetime',
    stats_revenue:'Receita', stats_rate:'Taxa ativa',
    detail_title:'◉  Detalhes da Licença', detail_key:'Chave', detail_status:'Status',
    detail_active:'● Ativa', detail_revoked:'○ Revogada', detail_install:'Install ID',
    detail_not_linked:'não vinculada', detail_remaining:'Restante',
    act_link:'⟡ Vincular', act_unlink:'⌬ Desvincular', act_revoke:'✕ Revogar', act_delete:'✕ Deletar',
    prices_title:'✦  Tabela de Preços', prices_currency:'USD (Dólar Americano)',
    help_title:'?  Central de Ajuda', help_cmds:'Comandos disponíveis',
    danger_title:'⚠  Zona de Perigo', danger_warn:'Ações irreversíveis',
    danger_del_active:'Deletar apenas ativas', danger_del_all:'Deletar TODAS as licenças',
    danger_confirm_active:'Deletar todas as licenças <b>ativas</b>?',
    danger_confirm_all:'⚠ DELETAR TODAS as licenças? Esta ação é irreversível.',
    danger_done:'{n} licenças removidas.',
    lang_select:'Escolha seu idioma / Choose your language:', lang_saved:'✓ Idioma atualizado',
    status_active:'● Ativa', status_revoked:'○ Revogada', status_expired:'✕ Expirada',
    expired_msg:'Esta licença expirou. Renove para continuar.',
    btn_dm:'✉  Enviar Mensagem', btn_convs:'💬  Conversas',
    dm_title:'✉  ENVIAR MENSAGEM', dm_sub:'Escolha um usuário ou digite /dm @user msg',
    dm_users_title:'◈  USUÁRIOS CONHECIDOS', dm_users_empty:'Nenhum usuário registrado ainda.',
    dm_sent:'✓  Mensagem enviada', dm_not_found:'✕  Usuário não encontrado',
    conv_title:'💬  CONVERSA', conv_empty:'Sem histórico com este usuário.', conv_cleared:'✓  Histórico limpo',
    inbox_title:'📥  NOVA MENSAGEM RECEBIDA',
    inbox_reply_hint:'Responda com: /resp &lt;chatId&gt; &lt;msg&gt;',
    dm_type_msg:'✎  Envie agora a mensagem para',
    dm_next_is_msg:'(o próximo texto será enviado)',
    users_hint:'Use /dm &lt;@user|chatId&gt; &lt;msg&gt;'
  },
  en: {
    menu_title:'⌬  CONTROL PANEL', menu_sub:'Select an operation below',
    online:'online', secure:'secure',
    btn_generate:'⚡  Generate License', btn_mykeys:'◈  My Keys', btn_stats:'◧  Statistics',
    btn_link:'⟡  Link', btn_unlink:'⌬  Unlink', btn_query:'◉  Query',
    btn_prices:'✦  Price List', btn_support:'✆  Support',
    btn_lang:'◐  Language / Idioma', btn_help:'?  Help', btn_danger:'⚠  Danger Zone',
    btn_back:'‹  Back', btn_menu:'‹  Menu', btn_refresh:'↻  Refresh', btn_cancel:'✕  Cancel',
    btn_confirm_yes:'✓  Yes, confirm', btn_confirm_no:'✕  Cancel',
    welcome_title:'Welcome to Mozlince Nebula',
    welcome_desc:'To purchase a premium license, click below:',
    contact:'✆  CONTACT SUPPORT',
    support_title:'✆  Support', support_write:'Write your message now:',
    support_hint:'(the next text will be forwarded to support)',
    support_exp:'Session expires in 10 minutes',
    support_sent:'✓  MESSAGE SENT',
    support_sent_desc:'Your message was forwarded.\nResponse time: up to 24h',
    support_cancelled:'✕  Support cancelled',
    gen_title:'⚡  Generate License', gen_sub:'Choose a plan below:',
    gen_success:'✓  LICENSE ISSUED', gen_key:'Key', gen_plan:'Plan', gen_price:'Price',
    gen_issued:'Issued', gen_expires:'Expires', gen_duration:'Duration',
    gen_lifetime:'Lifetime', gen_never:'Never', gen_yes:'Yes', gen_no:'No',
    list_title:'◈  My Licenses', list_empty:'No licenses found.', list_more:'+{n} hidden',
    stats_title:'◧  Statistics', stats_total:'Total', stats_active:'Active',
    stats_expired:'Expired', stats_linked:'Linked', stats_lifetime:'Lifetime',
    stats_revenue:'Revenue', stats_rate:'Active rate',
    detail_title:'◉  License Details', detail_key:'Key', detail_status:'Status',
    detail_active:'● Active', detail_revoked:'○ Revoked', detail_install:'Install ID',
    detail_not_linked:'not linked', detail_remaining:'Remaining',
    act_link:'⟡ Link', act_unlink:'⌬ Unlink', act_revoke:'✕ Revoke', act_delete:'✕ Delete',
    prices_title:'✦  Price List', prices_currency:'USD (US Dollar)',
    help_title:'?  Help Center', help_cmds:'Available commands',
    danger_title:'⚠  Danger Zone', danger_warn:'Irreversible actions',
    danger_del_active:'Delete active only', danger_del_all:'Delete ALL licenses',
    danger_confirm_active:'Delete all <b>active</b> licenses?',
    danger_confirm_all:'⚠ DELETE ALL licenses? This action is irreversible.',
    danger_done:'{n} licenses removed.',
    lang_select:'Choose your language / Escolha seu idioma:', lang_saved:'✓ Language updated',
    status_active:'● Active', status_revoked:'○ Revoked', status_expired:'✕ Expired',
    expired_msg:'This license expired. Renew to continue.',
    btn_dm:'✉  Send Message', btn_convs:'💬  Conversations',
    dm_title:'✉  SEND MESSAGE', dm_sub:'Pick a user or type /dm @user msg',
    dm_users_title:'◈  KNOWN USERS', dm_users_empty:'No users registered yet.',
    dm_sent:'✓  Message sent', dm_not_found:'✕  User not found',
    conv_title:'💬  CONVERSATION', conv_empty:'No history with this user.', conv_cleared:'✓  History cleared',
    inbox_title:'📥  NEW MESSAGE RECEIVED',
    inbox_reply_hint:'Reply with: /resp &lt;chatId&gt; &lt;msg&gt;',
    dm_type_msg:'✎  Send the message now to',
    dm_next_is_msg:'(the next text will be sent)',
    users_hint:'Use /dm &lt;@user|chatId&gt; &lt;msg&gt;'
  }
};
function t(lang, key, vars={}) { let s = (T[lang] || T.pt)[key] || T.pt[key] || key; for (const k in vars) s = s.replace(`{${k}}`, vars[k]); return s; }

/* ═══ TELEGRAM ═══ */
const SUPPORT_SESSIONS = new Map();
const DM_SESSIONS = new Map();
const USER_LANG = new Map();
const sessionsInterval = setInterval(() => {
  const now = Date.now();
  for (const [k,v] of SUPPORT_SESSIONS.entries()) if (now - v.ts > 10*60*1000) SUPPORT_SESSIONS.delete(k);
  for (const [k,v] of DM_SESSIONS.entries()) if (now - v.ts > 10*60*1000) DM_SESSIONS.delete(k);
}, 60000);
if (sessionsInterval.unref) sessionsInterval.unref();
const TG_API = TELEGRAM_TOKEN ? `https://api.telegram.org/bot${TELEGRAM_TOKEN}` : null;
async function tgSend(chatId, text, keyboard=null) {
  if (!TG_API) return false;
  try { const body={chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true}; if(keyboard)body.reply_markup=keyboard; const r = await fetch(`${TG_API}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const d = await r.json(); return d.ok === true; } catch(e){ log('TG','send erro: '+e.message); return false; }
}
async function tgEdit(chatId, messageId, text, keyboard=null) {
  if (!TG_API) return;
  try { const body={chat_id:chatId,message_id:messageId,text,parse_mode:'HTML',disable_web_page_preview:true}; if(keyboard)body.reply_markup=keyboard; await fetch(`${TG_API}/editMessageText`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); } catch(e){ log('TG','edit erro: '+e.message); }
}
async function tgAnswer(id, text='') { if (!TG_API) return; try { await fetch(`${TG_API}/answerCallbackQuery`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callback_query_id:id,text})}); } catch {} }

const USER_DB_KEY = 'ASHEO-USER-REGISTRY';
const CONV_PREFIX = 'ASHEO-CONV-';
async function registrarUsuario(from, chatId) {
  try {
    const reg = (await redisGetRaw(USER_DB_KEY)) || {};
    const id = String(chatId);
    reg[id] = { chatId: id, nome: `${from.first_name||''} ${from.last_name||''}`.trim() || 'Sem nome', username: from.username ? '@'+from.username : null, lang: USER_LANG.get(id) || 'pt', lastSeen: Date.now() };
    await redisSet(USER_DB_KEY, reg);
  } catch (e) { log('DBG', 'registrarUsuario: ' + e.message); }
}
async function buscarUsuario(termo) {
  const reg = (await redisGetRaw(USER_DB_KEY).catch(()=>null)) || {};
  const raw = String(termo || '').trim();
  if (!raw) return null;
  if (reg[raw]) return reg[raw];
  const tt = raw.toLowerCase().replace(/^@/, '');
  for (const id in reg) {
    const u = reg[id];
    if (u.username && u.username.toLowerCase().replace('@','') === tt) return u;
    if (u.nome && u.nome.toLowerCase() === tt) return u;
  }
  return null;
}
async function listarUsuarios() { const reg = (await redisGetRaw(USER_DB_KEY).catch(()=>null)) || {}; return Object.values(reg).sort((a,b) => (b.lastSeen||0) - (a.lastSeen||0)); }
async function salvarConversa(chatId, direcao, texto) {
  try {
    const k = CONV_PREFIX + String(chatId);
    const arr = (await redisGetRaw(k).catch(()=>null)) || [];
    arr.push({ dir: direcao, txt: texto, ts: Date.now() });
    if (arr.length > 200) arr.splice(0, arr.length - 200);
    await redisSet(k, arr);
  } catch (e) { log('DBG','salvarConversa: '+e.message); }
}
async function lerConversa(chatId) { try { return (await redisGetRaw(CONV_PREFIX + String(chatId)).catch(()=>null)) || []; } catch { return []; } }
async function limparConversa(chatId) { await redisDel(CONV_PREFIX + String(chatId)).catch(()=>{}); }

const UI = {
  header: (lang='pt') => {
    const subtitle = lang === 'en' ? 'Premium License Engine' : 'Motor de Licenças Premium';
    return `<b>⌬ ───────────────────── ⌬</b>\n<b>◈  MOZLINCE NEBULA  v9.0.0</b>\n<i>${subtitle} · Asheo Systems</i>\n<b>⌬ ───────────────────── ⌬</b>`;
  },
  sep: '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  kv: (icon, label, value) => `<b>${icon}</b>  <b>${label}:</b>  ${value}`
};

function menuPrincipal(lang='pt') {
  const hora = new Date().toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo', hour:'2-digit', minute:'2-digit' });
  return {
    texto: `${UI.header(lang)}\n\n<b>${t(lang,'menu_title')}</b>\n<code>${UI.sep}</code>\n<b>◔</b> ${hora}   <b>◉</b> ${t(lang,'online')}   <b>⟡</b> ${t(lang,'secure')} ES256\n<code>${UI.sep}</code>\n\n<i>${t(lang,'menu_sub')}</i>`,
    teclado: { inline_keyboard: [
      [{ text: t(lang,'btn_generate'), callback_data:'m_gerar' }],
      [{ text: t(lang,'btn_mykeys'), callback_data:'m_listar' }, { text: t(lang,'btn_stats'), callback_data:'m_stats' }],
      [{ text: t(lang,'btn_link'), callback_data:'m_vincular' }, { text: t(lang,'btn_unlink'), callback_data:'m_desvincular' }],
      [{ text: t(lang,'btn_query'), callback_data:'m_consultar' }],
      [{ text: t(lang,'btn_prices'), callback_data:'m_precos' }],
      [{ text: t(lang,'btn_dm'), callback_data:'m_dm' }, { text: t(lang,'btn_convs'), callback_data:'m_convs' }],
      [{ text: t(lang,'btn_support'), callback_data:'m_contacto' }],
      [{ text: t(lang,'btn_lang'), callback_data:'m_lang' }],
      [{ text: t(lang,'btn_help'), callback_data:'m_ajuda' }, { text: t(lang,'btn_danger'), callback_data:'m_perigo' }]
    ]}
  };
}
async function cmdStart(chatId, msgId=null) { const lang = USER_LANG.get(String(chatId)) || 'pt'; const m = menuPrincipal(lang); if (msgId) await tgEdit(chatId, msgId, m.texto, m.teclado); else await tgSend(chatId, m.texto, m.teclado); }

async function handleCallback(cb) {
  const chatId = cb.message.chat.id, msgId = cb.message.message_id, data = cb.data, userId = String(cb.from.id);
  const isOwner = OWNER_ID && userId === String(OWNER_ID);
  const lang = USER_LANG.get(String(chatId)) || 'pt';
  if (data === 'm_lang') { await tgAnswer(cb.id); await tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>◐  ${t(lang,'lang_select')}</b>\n<code>${UI.sep}</code>`, { inline_keyboard: [[{ text:'▸ Português (BR)', callback_data:'lang_pt' }, { text:'▸ English (US)', callback_data:'lang_en' }],[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] }); return; }
  if (data === 'lang_pt' || data === 'lang_en') { const novo = data === 'lang_pt' ? 'pt' : 'en'; USER_LANG.set(String(chatId), novo); await tgAnswer(cb.id, t(novo,'lang_saved')); const m = menuPrincipal(novo); await tgEdit(chatId, msgId, m.texto, m.teclado); return; }
  if (!isOwner) {
    if (data === 'm_contacto') { SUPPORT_SESSIONS.set(String(chatId), { step:'waiting', ts: Date.now() }); await tgAnswer(cb.id, '✎'); await tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'support_title')}</b>\n<code>${UI.sep}</code>\n\n<b>✎</b> ${t(lang,'support_write')}\n<i>${t(lang,'support_hint')}</i>\n\n<code>${UI.sep}</code>\n<b>◔</b> ${t(lang,'support_exp')}`, { inline_keyboard: [[{ text: t(lang,'btn_cancel'), callback_data:'m_cancelar_suporte' }]] }); return; }
    if (data === 'm_cancelar_suporte') { SUPPORT_SESSIONS.delete(String(chatId)); await tgAnswer(cb.id, '✕'); await tgEdit(chatId, msgId, `<b>${t(lang,'support_cancelled')}</b>`, { inline_keyboard: [[{ text: t(lang,'contact'), callback_data:'m_contacto' }]] }); return; }
    if (data === 'm_home') { await tgAnswer(cb.id); await tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>◈  ${t(lang,'welcome_title')}</b>\n<code>${UI.sep}</code>\n\n<i>${t(lang,'welcome_desc')}</i>`, { inline_keyboard: [[{ text: t(lang,'contact'), callback_data:'m_contacto' }],[{ text: t(lang,'btn_lang'), callback_data:'m_lang' }]] }); return; }
    await tgAnswer(cb.id, '⛔'); return;
  }
  try {
    if (data === 'm_home') { await tgAnswer(cb.id); return cmdStart(chatId, msgId); }
    if (data === 'm_dm') {
      await tgAnswer(cb.id, '✉');
      const users = await listarUsuarios();
      if (users.length === 0) return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'dm_title')}</b>\n<code>${UI.sep}</code>\n<i>${t(lang,'dm_users_empty')}</i>`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] });
      const kb = { inline_keyboard: [] };
      for (const u of users.slice(0, 20)) kb.inline_keyboard.push([{ text: '✉ ' + ((u.username || u.nome) + ' · ' + u.chatId).substring(0, 45), callback_data: `dm_${u.chatId}` }]);
      kb.inline_keyboard.push([{ text: t(lang,'btn_back'), callback_data:'m_home' }]);
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'dm_users_title')}</b>  <code>(${users.length})</code>\n<code>${UI.sep}</code>`, kb);
    }
    if (data.startsWith('dm_')) {
      const target = data.substring(3);
      const u = await buscarUsuario(target);
      if (!u) { await tgAnswer(cb.id, t(lang,'dm_not_found')); return; }
      await tgAnswer(cb.id, '✉');
      DM_SESSIONS.set(String(chatId), { step: 'await_msg', target, ts: Date.now() });
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'dm_title')}</b>\n<code>${UI.sep}</code>\n\n<b>✎</b>  ${t(lang,'dm_type_msg')} <code>${target}</code>\n<i>${t(lang,'dm_next_is_msg')}</i>`, { inline_keyboard: [[{ text: t(lang,'btn_cancel'), callback_data:'m_dm_cancel' }]] });
    }
    if (data === 'm_dm_cancel') { DM_SESSIONS.delete(String(chatId)); await tgAnswer(cb.id, '✕'); return cmdStart(chatId, msgId); }
    if (data === 'm_convs') {
      await tgAnswer(cb.id, '💬');
      const users = await listarUsuarios();
      if (users.length === 0) return tgEdit(chatId, msgId, `<i>${t(lang,'dm_users_empty')}</i>`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] });
      const kb = { inline_keyboard: [] };
      for (const u of users.slice(0, 20)) kb.inline_keyboard.push([{ text: `💬 ${u.username || u.nome}`, callback_data: `cv_${u.chatId}` }]);
      kb.inline_keyboard.push([{ text: t(lang,'btn_back'), callback_data:'m_home' }]);
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'btn_convs')}</b>\n<code>${UI.sep}</code>`, kb);
    }
    if (data.startsWith('cv_')) {
      const target = data.substring(3);
      await tgAnswer(cb.id);
      const hist = await lerConversa(target);
      let txt = `${UI.header(lang)}\n\n<b>${t(lang,'conv_title')}</b> <code>${target}</code>\n<code>${UI.sep}</code>\n\n`;
      if (hist.length === 0) txt += `<i>${t(lang,'conv_empty')}</i>`;
      else for (const m of hist.slice(-15)) { const hora = new Date(m.ts).toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo', hour:'2-digit', minute:'2-digit' }); txt += `${m.dir === 'in' ? '👤' : '👑'} <i>${hora}</i>\n${escapeHtml(String(m.txt||'').substring(0,300))}\n\n`; }
      return tgEdit(chatId, msgId, txt, { inline_keyboard: [[{ text: '✉ ' + t(lang,'btn_dm'), callback_data: `dm_${target}` }],[{ text: '🗑 Limpar', callback_data: `cvc_${target}` }],[{ text: t(lang,'btn_back'), callback_data:'m_convs' }]] });
    }
    if (data.startsWith('cvc_')) { const target = data.substring(4); await limparConversa(target); await tgAnswer(cb.id, t(lang,'conv_cleared')); return tgEdit(chatId, msgId, `✓ ${t(lang,'conv_cleared')}`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:'m_convs' }]] }); }
    if (data === 'm_gerar') {
      await tgAnswer(cb.id, '⚡');
      const kb = { inline_keyboard: [] };
      const entries = Object.entries(PACOTES);
      for (let i = 0; i < entries.length; i += 2) {
        const linha = [{ text: `${entries[i][1].emoji} ${entries[i][1].nome} · ${precoFmt(entries[i][1].preco)}`, callback_data:`g_${entries[i][0]}` }];
        if (entries[i+1]) linha.push({ text: `${entries[i+1][1].emoji} ${entries[i+1][1].nome} · ${precoFmt(entries[i+1][1].preco)}`, callback_data:`g_${entries[i+1][0]}` });
        kb.inline_keyboard.push(linha);
      }
      kb.inline_keyboard.push([{ text: t(lang,'btn_back'), callback_data:'m_home' }]);
      let tabela = '';
      for (const [,p] of Object.entries(PACOTES)) { const dur = p.lifetime ? '∞' : `${p.dias}d`; tabela += `<b>${p.emoji}</b>  ${p.nome.padEnd(11)}  <code>${precoFmt(p.preco)}</code>  <i>${dur}</i>\n`; }
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'gen_title')}</b>\n<code>${UI.sep}</code>\n<i>${t(lang,'gen_sub')}</i>\n\n${tabela}\n<code>${UI.sep}</code>`, kb);
    }
    if (data.startsWith('g_')) {
      const pk = data.substring(2), p = PACOTES[pk];
      if (!p) { await tgAnswer(cb.id, '✕'); return; }
      const chave = generateLicenseKey();
      const agora = Date.now();
      const expira = p.lifetime ? (agora + 100*365*24*60*60*1000) : (agora + p.dias*24*60*60*1000);
      await redisSet(chave, { chave, plano: pk, planoNome: p.nome, preco: p.preco, preco_usd: p.preco, preco_fmt: precoFmt(p.preco), dias: p.dias, lifetime: p.lifetime === true, ilimitada: p.lifetime === true, criadaEm: agora, expiraEm: expira, ativa: true, installId: null, ativadaEm: null, activationCount: 0, v: 9 });
      log('OK', `Chave ${pk} gerada: ${chave}`);
      await tgAnswer(cb.id, '✓');
      const restaTxt = p.lifetime ? '∞  LIFETIME' : humanTime(p.dias*24*60*60*1000);
      const barra = p.lifetime ? '▰▰▰▰▰▰▰▰▰▰' : progressBar(100);
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'gen_success')}</b>\n<code>${UI.sep}</code>\n\n<b>⌬  ${t(lang,'gen_key')}</b>\n<code>${chave}</code>\n\n<code>${UI.sep}</code>\n${UI.kv(p.emoji, t(lang,'gen_plan'), `<b>${p.nome}</b>`)}\n${UI.kv('◆', t(lang,'gen_price'), `<code>${precoFmt(p.preco)}</code>`)}\n${UI.kv('◔', t(lang,'gen_issued'), formatDate(agora))}\n${UI.kv('◕', t(lang,'gen_expires'), p.lifetime ? `<b>${t(lang,'gen_never')}</b>` : formatDate(expira))}\n${UI.kv('⟡', t(lang,'gen_duration'), `<b>${restaTxt}</b>`)}\n${UI.kv('∞', t(lang,'gen_lifetime'), p.lifetime ? `✓ ${t(lang,'gen_yes')}` : `✕ ${t(lang,'gen_no')}`)}\n<code>${UI.sep}</code>\n<code>${barra}</code>`, { inline_keyboard: [[{ text: t(lang,'btn_query'), callback_data:`c_${chave}` }],[{ text: t(lang,'btn_menu'), callback_data:'m_home' }]] });
    }
    if (data === 'm_listar') {
      await tgAnswer(cb.id, '◈');
      const keys = await redisScan('ASHEO-*');
      const licKeys = [];
      for (const k of keys) { if (k.startsWith('ASHEO-INSTALL-') || k.startsWith('ASHEO-USER') || k.startsWith('ASHEO-CONV-') || k.startsWith('ASHEO-CAMPAIGN') || k.startsWith('ASHEO-NONCE-') || k.startsWith('ASHEO-ENCGW-')) continue; licKeys.push(k); }
      if (licKeys.length === 0) return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'list_title')}</b>\n<code>${UI.sep}</code>\n<i>${t(lang,'list_empty')}</i>`, { inline_keyboard: [[{ text: t(lang,'btn_generate'), callback_data:'m_gerar' }],[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] });
      let txt = `<b>${t(lang,'list_title')}</b>  <code>(${licKeys.length})</code>\n<code>${UI.sep}</code>\n\n`;
      const inlineKb = [];
      for (let i = 0; i < Math.min(licKeys.length, 15); i++) {
        const l = await redisGet(licKeys[i]).catch(()=>null); if (!l) continue;
        const exp = l.lifetime ? '∞' : humanTime((l.expiraEm||0) - Date.now());
        const emoji = l.lifetime ? '∞' : (l.ativa ? '●' : '○');
        txt += `<b>${emoji}</b> ${l.installId?'⟡':'○'} <code>${licKeys[i]}</code>\n   <i>${l.planoNome} · ${exp}</i>\n\n`;
        inlineKb.push([{ text:`▸ ${licKeys[i].substring(0,18)}…`, callback_data:`c_${licKeys[i]}` }]);
      }
      if (licKeys.length > 15) txt += `<i>${t(lang,'list_more',{n:licKeys.length-15})}</i>\n`;
      inlineKb.push([{ text: t(lang,'btn_refresh'), callback_data:'m_listar' }, { text: t(lang,'btn_back'), callback_data:'m_home' }]);
      return tgEdit(chatId, msgId, txt, { inline_keyboard: inlineKb });
    }
    if (data === 'm_stats') {
      await tgAnswer(cb.id, '◧');
      const keys = await redisScan('ASHEO-*');
      let ativas=0, expiradas=0, vinc=0, life=0, receita=0, total=0;
      for (const k of keys) { if (k.startsWith('ASHEO-INSTALL-') || k.startsWith('ASHEO-USER') || k.startsWith('ASHEO-CONV-') || k.startsWith('ASHEO-CAMPAIGN') || k.startsWith('ASHEO-NONCE-') || k.startsWith('ASHEO-ENCGW-')) continue; const l = await redisGet(k).catch(()=>null); if (!l) continue; total++; if (l.ativa) ativas++; if (!l.lifetime && l.expiraEm < Date.now()) expiradas++; if (l.installId) vinc++; if (l.lifetime) life++; if (l.ativa && l.preco) receita += Number(l.preco) || 0; }
      const taxa = total ? Math.round((ativas/total)*100) : 0;
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'stats_title')}</b>\n<code>${UI.sep}</code>\n\n${UI.kv('◈', t(lang,'stats_total'), `<code>${total}</code>`)}\n${UI.kv('●', t(lang,'stats_active'), `<code>${ativas}</code>`)}\n${UI.kv('○', t(lang,'stats_expired'), `<code>${expiradas}</code>`)}\n${UI.kv('⟡', t(lang,'stats_linked'), `<code>${vinc}</code>`)}\n${UI.kv('∞', t(lang,'stats_lifetime'), `<code>${life}</code>`)}\n\n<code>${UI.sep}</code>\n${UI.kv('◆', t(lang,'stats_revenue'), `<code>${precoFmt(receita)}</code>`)}\n${UI.kv('◔', t(lang,'stats_rate'), `<b>${taxa}%</b>`)}\n<code>${progressBar(taxa, 15)}</code>`, { inline_keyboard: [[{ text: t(lang,'btn_refresh'), callback_data:'m_stats' }, { text: t(lang,'btn_back'), callback_data:'m_home' }]] });
    }
    if (data === 'm_vincular') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'act_link')}</b>\n<code>${UI.sep}</code>\n<code>/activate &lt;installId&gt; &lt;chave&gt;</code>`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] }); }
    if (data === 'm_desvincular') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'act_unlink')}</b>\n<code>${UI.sep}</code>\n<code>/desvincular &lt;chave&gt;</code>`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] }); }
    if (data === 'm_consultar') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'btn_query')}</b>\n<code>${UI.sep}</code>\n<code>/status &lt;chave&gt;</code>`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] }); }
    if (data === 'm_precos') {
      await tgAnswer(cb.id);
      let txt = `${UI.header(lang)}\n\n<b>${t(lang,'prices_title')}</b>\n<code>${UI.sep}</code>\n\n`;
      for (const [,p] of Object.entries(PACOTES)) { const dur = p.lifetime ? '∞' : `${p.dias} dias`; txt += `<b>${p.emoji}</b>  ${p.nome.padEnd(11)}  <code>${precoFmt(p.preco)}</code>\n      <i>${dur}</i>\n`; }
      txt += `\n<code>${UI.sep}</code>\n<i>◆ ${t(lang,'prices_currency')}</i>`;
      return tgEdit(chatId, msgId, txt, { inline_keyboard: [[{ text: t(lang,'btn_support'), callback_data:'m_contacto' }],[{ text: t(lang,'btn_generate'), callback_data:'m_gerar' }, { text: t(lang,'btn_back'), callback_data:'m_home' }]] });
    }
    if (data === 'm_contacto') { await tgAnswer(cb.id, '✆'); SUPPORT_SESSIONS.set(String(chatId), { step:'waiting', ts: Date.now() }); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'support_title')}</b>\n<code>${UI.sep}</code>\n\n<b>✎</b> ${t(lang,'support_write')}\n<i>${t(lang,'support_hint')}</i>\n\n<code>${UI.sep}</code>\n<b>◔</b> ${t(lang,'support_exp')}`, { inline_keyboard: [[{ text: t(lang,'btn_cancel'), callback_data:'m_cancelar_suporte' }]] }); }
    if (data === 'm_cancelar_suporte') { SUPPORT_SESSIONS.delete(String(chatId)); await tgAnswer(cb.id, '✕'); return cmdStart(chatId, msgId); }
    if (data === 'm_ajuda') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'help_title')}</b>\n<code>${UI.sep}</code>\n\n<code>/start /gerar /listar /stats /status /activate /desvincular /revogar /deletar /deletartudo /usuarios /dm /conversa /resp /lang</code>\n\n<code>${UI.sep}</code>`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] }); }
    if (data === 'm_perigo') { await tgAnswer(cb.id, '⚠'); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'danger_title')}</b>\n<code>${UI.sep}</code>\n<b>⚠  ${t(lang,'danger_warn')}</b>`, { inline_keyboard: [[{ text: t(lang,'danger_del_active'), callback_data:'danger_ativas' }],[{ text: t(lang,'danger_del_all'), callback_data:'danger_tudo' }],[{ text: t(lang,'btn_back'), callback_data:'m_home' }]] }); }
    if (data === 'danger_ativas') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>⚠  CONFIRMAR</b>\n<code>${UI.sep}</code>\n${t(lang,'danger_confirm_active')}`, { inline_keyboard: [[{ text: t(lang,'btn_confirm_yes'), callback_data:'confirm_ativas' }],[{ text: t(lang,'btn_confirm_no'), callback_data:'m_perigo' }]] }); }
    if (data === 'danger_tudo') { await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>💣  CONFIRMAR</b>\n<code>${UI.sep}</code>\n${t(lang,'danger_confirm_all')}`, { inline_keyboard: [[{ text: t(lang,'btn_confirm_yes'), callback_data:'confirm_tudo' }],[{ text: t(lang,'btn_confirm_no'), callback_data:'m_perigo' }]] }); }
    if (data === 'confirm_ativas') { await tgAnswer(cb.id, '…'); const keys = await redisScan('ASHEO-*'); let n = 0; for (const k of keys) { if (k.startsWith('ASHEO-INSTALL-') || k.startsWith('ASHEO-USER') || k.startsWith('ASHEO-CONV-') || k.startsWith('ASHEO-CAMPAIGN') || k.startsWith('ASHEO-NONCE-') || k.startsWith('ASHEO-ENCGW-')) continue; const l = await redisGet(k).catch(()=>null); if (l && l.ativa) { await redisDel(k); if (l.installId) await redisDelIndexInstall(l.installId).catch(()=>{}); n++; } } return tgEdit(chatId, msgId, `✓  <b>${t(lang,'danger_done',{n})}</b>`, { inline_keyboard: [[{ text: t(lang,'btn_menu'), callback_data:'m_home' }]] }); }
    if (data === 'confirm_tudo') { await tgAnswer(cb.id, '💣'); const keys = await redisScan('ASHEO-*'); let n = 0; for (const k of keys) { if (k.startsWith('ASHEO-USER') || k.startsWith('ASHEO-CONV-') || k.startsWith('ASHEO-CAMPAIGN') || k.startsWith('ASHEO-NONCE-') || k.startsWith('ASHEO-ENCGW-')) continue; await redisDel(k); n++; } return tgEdit(chatId, msgId, `💣  <b>${t(lang,'danger_done',{n})}</b>`, { inline_keyboard: [[{ text: t(lang,'btn_menu'), callback_data:'m_home' }]] }); }
    if (data.startsWith('c_')) {
      const k = data.substring(2), l = await redisGet(k).catch(()=>null);
      if (!l) { await tgAnswer(cb.id, '✕'); return; }
      await tgAnswer(cb.id);
      const resta = l.lifetime ? '∞  Lifetime' : humanTime((l.expiraEm||0) - Date.now());
      const pct = l.lifetime ? 100 : Math.max(0, Math.min(100, Math.round(((l.expiraEm-Date.now())/((l.dias||30)*86400000))*100)));
      const pk = PACOTES[l.plano] || { emoji:'◆' };
      const statusTxt = !l.ativa ? t(lang,'detail_revoked') : (Date.now() > l.expiraEm && !l.lifetime ? t(lang,'status_expired') : t(lang,'detail_active'));
      return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'detail_title')}</b>\n<code>${UI.sep}</code>\n<b>⌬  ${t(lang,'detail_key')}</b>\n<code>${k}</code>\n<code>${UI.sep}</code>\n${UI.kv(pk.emoji, t(lang,'gen_plan'), `<b>${l.planoNome}</b>`)}\n${UI.kv('◆', t(lang,'gen_price'), `<code>${precoFmt(l.preco)}</code>`)}\n${UI.kv('◔', t(lang,'gen_issued'), formatDate(l.criadaEm))}\n${UI.kv('◕', t(lang,'gen_expires'), l.lifetime ? `<b>${t(lang,'gen_never')}</b>` : formatDate(l.expiraEm))}\n${UI.kv('⟡', t(lang,'detail_remaining'), `<b>${resta}</b>`)}\n${UI.kv('∞', t(lang,'gen_lifetime'), l.lifetime ? `✓ ${t(lang,'gen_yes')}` : `✕ ${t(lang,'gen_no')}`)}\n${UI.kv('◉', t(lang,'detail_status'), statusTxt)}\n${UI.kv('⟡', t(lang,'detail_install'), l.installId?`<code>${l.installId.substring(0,16)}…</code>`:`<i>${t(lang,'detail_not_linked')}</i>`)}\n<code>${UI.sep}</code>\n<code>${progressBar(pct)}</code> ${pct}%`, { inline_keyboard: [[{ text: l.installId ? t(lang,'act_unlink') : t(lang,'act_link'), callback_data: l.installId?`dv_${k}`:`v_${k}` }],[{ text: t(lang,'act_revoke'), callback_data:`rv_${k}` }, { text: t(lang,'act_delete'), callback_data:`dl_${k}` }],[{ text: t(lang,'btn_menu'), callback_data:'m_home' }]] });
    }
    if (data.startsWith('v_')) { const k = data.substring(2); await tgAnswer(cb.id); return tgEdit(chatId, msgId, `${UI.header(lang)}\n\n<b>${t(lang,'act_link')}</b>\n<code>/activate &lt;installId&gt; ${k}</code>`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:`c_${k}` }]] }); }
    if (data.startsWith('dv_')) { const k = data.substring(3), l = await redisGet(k).catch(()=>null); if (l) { if (l.installId) await redisDelIndexInstall(l.installId).catch(()=>{}); l.installId = null; l.ativadaEm = null; await redisSet(k, l); } await tgAnswer(cb.id, '⌬'); return tgEdit(chatId, msgId, `✓ ${t(lang,'act_unlink')}`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:`c_${k}` }]] }); }
    if (data.startsWith('rv_')) { const k = data.substring(3), l = await redisGet(k).catch(()=>null); if (l) { l.ativa = false; await redisSet(k, l); } await tgAnswer(cb.id, '✕'); return tgEdit(chatId, msgId, `✕ ${t(lang,'act_revoke')}`, { inline_keyboard: [[{ text: t(lang,'btn_back'), callback_data:`c_${k}` }]] }); }
    if (data.startsWith('dl_')) { const k = data.substring(3); const l = await redisGet(k).catch(()=>null); if (l && l.installId) await redisDelIndexInstall(l.installId).catch(()=>{}); await redisDel(k); await tgAnswer(cb.id, '✕'); return tgEdit(chatId, msgId, `✕ ${t(lang,'act_delete')}`, { inline_keyboard: [[{ text: t(lang,'btn_menu'), callback_data:'m_home' }]] }); }
    await tgAnswer(cb.id);
  } catch (e) { log('ERRO', 'Callback: ' + e.message); try { await tgAnswer(cb.id, '✕ Erro'); } catch {} }
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = String(msg.from?.id || '');
  const texto = (msg.text || '').trim();
  const args = texto.replace(/\n/g,' ').split(' ').filter(a=>a.length>0);
  const cmd = (args[0] || '').toLowerCase();
  const isOwner = OWNER_ID && userId === String(OWNER_ID);
  const lang = USER_LANG.get(String(chatId)) || 'pt';
  if (msg.from) registrarUsuario(msg.from, chatId).catch(()=>{});
  const dmSess = DM_SESSIONS.get(String(chatId));
  if (dmSess && dmSess.step === 'await_msg' && isOwner && texto) {
    DM_SESSIONS.delete(String(chatId));
    const alvo = dmSess.target;
    const targetLang = USER_LANG.get(String(alvo)) || 'pt';
    await tgSend(alvo, `<b>◈ ──『 ✉ MENSAGEM DO SUPORTE 』── ◈</b>\n<code>${UI.sep}</code>\n\n${escapeHtml(texto)}\n\n<code>${UI.sep}</code>\n<i>Mozlince Nebula · Asheo Systems</i>`, { inline_keyboard: [[{ text: t(targetLang,'contact'), callback_data:'m_contacto' }]] });
    await salvarConversa(alvo, 'out', texto);
    await tgSend(chatId, `✓ ${t(lang,'dm_sent')} → <code>${alvo}</code>`);
    return;
  }
  const sessao = SUPPORT_SESSIONS.get(String(chatId));
  if (sessao && sessao.step === 'waiting') {
    if (cmd === '/cancelar' || cmd === '/cancel' || cmd === 'cancelar' || cmd === 'cancel') { SUPPORT_SESSIONS.delete(String(chatId)); await tgSend(chatId, `<b>${t(lang,'support_cancelled')}</b>`); return; }
    SUPPORT_SESSIONS.delete(String(chatId));
    const userInfo = `${msg.from?.first_name||''} ${msg.from?.last_name||''}`.trim() || 'Sem nome';
    const username = msg.from?.username ? `@${msg.from.username}` : 'sem username';
    await tgSend(chatId, `${UI.header(lang)}\n\n<b>${t(lang,'support_sent')}</b>\n<code>${UI.sep}</code>\n\n${t(lang,'support_sent_desc')}`, { inline_keyboard: [[{ text: t(lang,'btn_menu'), callback_data:'m_home' }]] });
    if (!isOwner && OWNER_ID) {
      await salvarConversa(chatId, 'in', texto);
      await tgSend(OWNER_ID, `<b>◈ ──『 ✆ NOVA MENSAGEM 』── ◈</b>\n<code>${UI.sep}</code>\n<b>◉  Nome:</b> ${escapeHtml(userInfo)}\n<b>◈  User:</b> ${escapeHtml(username)}\n<b>⌬  Chat ID:</b> <code>${chatId}</code>\n<code>${UI.sep}</code>\n<b>✎  Mensagem:</b>\n${escapeHtml(texto)}\n\n<code>${UI.sep}</code>\n<i>Responda com:</i>\n<code>/resp ${chatId} sua mensagem</code>`);
    }
    return;
  }
  if (!isOwner) {
    if (cmd === '/start' || cmd === '/contacto' || cmd === '/contact' || cmd === '/ajuda' || cmd === '/help' || cmd === '/lang') {
      if (cmd === '/lang') { await tgSend(chatId, `<b>◐  ${t(lang,'lang_select')}</b>`, { inline_keyboard: [[{ text:'▸ Português (BR)', callback_data:'lang_pt' }, { text:'▸ English (US)', callback_data:'lang_en' }]] }); return; }
      await tgSend(chatId, `${UI.header(lang)}\n\n<b>◈  ${t(lang,'welcome_title')}</b>\n<code>${UI.sep}</code>\n<i>${t(lang,'welcome_desc')}</i>`, { inline_keyboard: [[{ text: t(lang,'contact'), callback_data:'m_contacto' }],[{ text: t(lang,'btn_lang'), callback_data:'m_lang' }]] });
      return;
    }
    await salvarConversa(chatId, 'in', texto);
    const userInfo = `${msg.from?.first_name||''} ${msg.from?.last_name||''}`.trim() || 'Sem nome';
    const username = msg.from?.username ? '@'+msg.from.username : 'sem username';
    if (OWNER_ID) await tgSend(OWNER_ID, `${t('pt','inbox_title')}\n<code>${UI.sep}</code>\n<b>◉</b> ${escapeHtml(userInfo)}\n<b>◈</b> ${escapeHtml(username)}\n<b>⌬</b> <code>${chatId}</code>\n<code>${UI.sep}</code>\n${escapeHtml(texto)}\n\n<code>${UI.sep}</code>\n<i>${t('pt','inbox_reply_hint')}</i>`);
    return;
  }
  try {
    if (cmd === '/start' || cmd === '/menu') { await cmdStart(chatId); return; }
    if (cmd === '/lang') { await tgSend(chatId, `<b>◐  ${t(lang,'lang_select')}</b>`, { inline_keyboard: [[{ text:'▸ Português (BR)', callback_data:'lang_pt' }, { text:'▸ English (US)', callback_data:'lang_en' }]] }); return; }
    if (cmd === '/usuarios' || cmd === '/users') {
      const users = await listarUsuarios();
      if (users.length === 0) { await tgSend(chatId, `<i>${t(lang,'dm_users_empty')}</i>`); return; }
      let txt = `<b>${t(lang,'dm_users_title')}</b>  <code>(${users.length})</code>\n<code>${UI.sep}</code>\n\n`;
      for (const u of users.slice(0, 30)) { const last = new Date(u.lastSeen).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); txt += `<b>◉</b> ${escapeHtml(u.nome)}  ${u.username ? '(<code>'+escapeHtml(u.username)+'</code>)' : ''}\n   ⌬ <code>${u.chatId}</code> · <i>${last}</i>\n`; }
      txt += `\n${t(lang,'users_hint')}`;
      await tgSend(chatId, txt);
      return;
    }
    if (cmd === '/dm') {
      const targetTerm = args[1], msgTxt = args.slice(2).join(' ');
      if (!targetTerm || !msgTxt) { await tgSend(chatId, `⚠  <code>/dm &lt;@usuario|chatId&gt; &lt;mensagem&gt;</code>`); return; }
      const u = await buscarUsuario(targetTerm);
      if (!u) { await tgSend(chatId, `✕  ${t(lang,'dm_not_found')}: <code>${escapeHtml(targetTerm)}</code>`); return; }
      const targetLang = USER_LANG.get(String(u.chatId)) || 'pt';
      await tgSend(u.chatId, `<b>◈ ──『 ✉ MENSAGEM DO SUPORTE 』── ◈</b>\n<code>${UI.sep}</code>\n\n${escapeHtml(msgTxt)}\n\n<code>${UI.sep}</code>\n<i>Mozlince Nebula · Asheo Systems</i>`, { inline_keyboard: [[{ text: t(targetLang,'contact'), callback_data:'m_contacto' }]] });
      await salvarConversa(u.chatId, 'out', msgTxt);
      await tgSend(chatId, `${t(lang,'dm_sent')} → ${escapeHtml(u.username || u.nome)} (<code>${u.chatId}</code>)`);
      return;
    }
    if (cmd === '/conversa' || cmd === '/conv') {
      const target = args[1];
      if (!target) { await tgSend(chatId, `⚠  /conversa &lt;chatId&gt;`); return; }
      const hist = await lerConversa(target);
      let txt = `<b>${t(lang,'conv_title')}</b> <code>${target}</code>\n<code>${UI.sep}</code>\n\n`;
      if (hist.length === 0) txt += `<i>${t(lang,'conv_empty')}</i>`;
      else for (const m of hist.slice(-20)) { const hora = new Date(m.ts).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); txt += `${m.dir==='in'?'👤':'👑'} <i>${hora}</i>\n${escapeHtml(m.txt)}\n\n`; }
      await tgSend(chatId, txt);
      return;
    }
    if (cmd === '/limparconversa' || cmd === '/clearchat') {
      const target = args[1];
      if (!target) { await tgSend(chatId, `⚠  /limparconversa &lt;chatId&gt;`); return; }
      await limparConversa(target);
      await tgSend(chatId, `✓ ${t(lang,'conv_cleared')}`);
      return;
    }
    if (cmd === '/resp') {
      const target = args[1], resposta = args.slice(2).join(' ');
      if (!target || !resposta) { await tgSend(chatId, `⚠  <code>/resp &lt;chatId&gt; &lt;mensagem&gt;</code>`); return; }
      const targetLang = USER_LANG.get(String(target)) || 'pt';
      await tgSend(target, `<b>◈ ──『 ✆ RESPOSTA DO SUPORTE 』── ◈</b>\n<code>${UI.sep}</code>\n\n${escapeHtml(resposta)}\n\n<code>${UI.sep}</code>\n<i>Mozlince Nebula Support</i>`, { inline_keyboard: [[{ text: t(targetLang,'contact'), callback_data:'m_contacto' }]] });
      await salvarConversa(target, 'out', resposta);
      await tgSend(chatId, `✓  Resposta enviada para <code>${target}</code>`);
      return;
    }
    if (cmd === '/gerar') { const kb = { inline_keyboard: [] }; const entries = Object.entries(PACOTES); for (let i = 0; i < entries.length; i += 2) { const linha = [{ text: `${entries[i][1].emoji} ${entries[i][1].nome} · ${precoFmt(entries[i][1].preco)}`, callback_data:`g_${entries[i][0]}` }]; if (entries[i+1]) linha.push({ text: `${entries[i+1][1].emoji} ${entries[i+1][1].nome} · ${precoFmt(entries[i+1][1].preco)}`, callback_data:`g_${entries[i+1][0]}` }); kb.inline_keyboard.push(linha); } await tgSend(chatId, `<b>⚡  ${t(lang,'gen_title')}</b>`, kb); return; }
    if (cmd === '/listar') { const keys = (await redisScan('ASHEO-*')).filter(k => !k.startsWith('ASHEO-INSTALL-') && !k.startsWith('ASHEO-USER') && !k.startsWith('ASHEO-CONV-') && !k.startsWith('ASHEO-CAMPAIGN') && !k.startsWith('ASHEO-NONCE-') && !k.startsWith('ASHEO-ENCGW-')); if (keys.length === 0) { await tgSend(chatId, `<i>${t(lang,'list_empty')}</i>`); return; } let txt = `<b>${t(lang,'list_title')} (${keys.length})</b>\n<code>${UI.sep}</code>\n`; for (let i = 0; i < Math.min(keys.length, 30); i++) { const l = await redisGet(keys[i]).catch(()=>null); if (!l) continue; const exp = l.lifetime ? '∞' : humanTime((l.expiraEm||0) - Date.now()); const emoji = l.lifetime ? '∞' : (l.ativa ? '●' : '○'); txt += `<b>${emoji}</b> <code>${keys[i]}</code>\n   <i>${l.planoNome} · ${exp}</i>\n`; } await tgSend(chatId, txt); return; }
    if (cmd === '/status') { const k = args[1]; if (!k) { await tgSend(chatId, `/status &lt;chave&gt;`); return; } const l = await redisGet(k).catch(()=>null); if (!l) { await tgSend(chatId, `✕  Não encontrada`); return; } const resta = l.lifetime ? '∞' : humanTime((l.expiraEm||0) - Date.now()); const pk = PACOTES[l.plano] || { emoji:'◆' }; await tgSend(chatId, `<b>◉  ${t(lang,'detail_title')}</b>\n<code>${UI.sep}</code>\n<b>⌬  ${t(lang,'detail_key')}:</b> <code>${k}</code>\n<b>${pk.emoji}  ${t(lang,'gen_plan')}:</b> ${l.planoNome}\n<b>◆  ${t(lang,'gen_price')}:</b> ${precoFmt(l.preco)}\n<b>◔  ${t(lang,'gen_issued')}:</b> ${formatDate(l.criadaEm)}\n<b>◕  ${t(lang,'gen_expires')}:</b> ${l.lifetime?t(lang,'gen_never'):formatDate(l.expiraEm)}\n<b>⟡  ${t(lang,'detail_remaining')}:</b> ${resta}\n<b>∞  ${t(lang,'gen_lifetime')}:</b> ${l.lifetime?'✓':'✕'}\n<b>◉  ${t(lang,'detail_status')}:</b> ${l.ativa?t(lang,'detail_active'):t(lang,'detail_revoked')}`); return; }
    if (cmd === '/activate') { const chave = args[args.length-1], installId = args.slice(1, args.length-1).join(' '); if (!installId || !chave) { await tgSend(chatId, `/activate &lt;id&gt; &lt;chave&gt;`); return; } const l = await redisGet(chave).catch(()=>null); if (!l) { await tgSend(chatId, `✕  Inválida`); return; } if (l.installId) { await tgSend(chatId, `⚠  Já vinculada`); return; } l.installId = installId; l.ativadaEm = Date.now(); l.activationCount = (l.activationCount||0)+1; await redisSet(chave, l); await redisIndexInstall(installId, chave).catch(()=>{}); await tgSend(chatId, `✓  Vinculada!\n⌬ <code>${chave}</code>\n⟡ <code>${installId}</code>`); return; }
    if (cmd === '/desvincular') { const k = args[1]; if (!k) { await tgSend(chatId, `⚠`); return; } const l = await redisGet(k).catch(()=>null); if (!l) { await tgSend(chatId, `✕`); return; } if (l.installId) await redisDelIndexInstall(l.installId).catch(()=>{}); l.installId = null; l.ativadaEm = null; await redisSet(k, l); await tgSend(chatId, `⌬  Desvinculada`); return; }
    if (cmd === '/revogar') { const k = args[1]; if (!k) { await tgSend(chatId, `⚠`); return; } const l = await redisGet(k).catch(()=>null); if (!l) { await tgSend(chatId, `✕`); return; } l.ativa = false; await redisSet(k, l); await tgSend(chatId, `✕  Revogada`); return; }
    if (cmd === '/deletar') { const k = args[1]; if (!k) { await tgSend(chatId, `⚠  <code>/deletar &lt;chave&gt;</code>`); return; } const l = await redisGet(k).catch(()=>null); if (!l) { await tgSend(chatId, `✕  Não encontrada`); return; } if (l.installId) await redisDelIndexInstall(l.installId).catch(()=>{}); await redisDel(k); await tgSend(chatId, `✕  Deletada: <code>${k}</code>`); return; }
    if (cmd === '/deletartudo') { const keys = await redisScan('ASHEO-*'); let n = 0; for (const k of keys) { if (k.startsWith('ASHEO-USER') || k.startsWith('ASHEO-CONV-') || k.startsWith('ASHEO-CAMPAIGN') || k.startsWith('ASHEO-NONCE-') || k.startsWith('ASHEO-ENCGW-')) continue; await redisDel(k); n++; } await tgSend(chatId, `💣  <b>${n}</b> licenças apagadas.`); return; }
    if (cmd === '/stats') { const keys = (await redisScan('ASHEO-*')).filter(k => !k.startsWith('ASHEO-INSTALL-') && !k.startsWith('ASHEO-USER') && !k.startsWith('ASHEO-CONV-') && !k.startsWith('ASHEO-CAMPAIGN') && !k.startsWith('ASHEO-NONCE-') && !k.startsWith('ASHEO-ENCGW-')); let ativas=0, exp=0, vinc=0, life=0, receita=0; for (const k of keys) { const l = await redisGet(k).catch(()=>null); if (!l) continue; if (l.ativa) ativas++; if (!l.lifetime && l.expiraEm < Date.now()) exp++; if (l.installId) vinc++; if (l.lifetime) life++; if (l.ativa && l.preco) receita += Number(l.preco) || 0; } await tgSend(chatId, `<b>◧  ${t(lang,'stats_title')}</b>\n<code>${UI.sep}</code>\n<b>◈</b> ${t(lang,'stats_total')}: <code>${keys.length}</code>\n<b>●</b> ${t(lang,'stats_active')}: <code>${ativas}</code>\n<b>○</b> ${t(lang,'stats_expired')}: <code>${exp}</code>\n<b>⟡</b> ${t(lang,'stats_linked')}: <code>${vinc}</code>\n<b>∞</b> ${t(lang,'stats_lifetime')}: <code>${life}</code>\n<b>◆</b> ${t(lang,'stats_revenue')}: <code>${precoFmt(receita)}</code>`); return; }
    await tgSend(chatId, `❓ Use /start`);
  } catch (e) { log('ERRO', 'Message: ' + e.message); }
}

app.post('/telegram-webhook', async (req, res) => {
  if (TELEGRAM_WEBHOOK_SECRET) {
    const got = req.headers['x-telegram-bot-api-secret-token'];
    if (got !== TELEGRAM_WEBHOOK_SECRET) { log('WARN', 'Webhook Telegram: secret inválido'); return res.sendStatus(403); }
  }
  const update = req.body || {};
  try {
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message && update.message.text) await handleMessage(update.message);
  } catch (e) { log('ERRO', 'Webhook: ' + e.message); }
  res.sendStatus(200);
});

/* ═══ ACTIVATE ═══ */
async function activateHandler(req, res) {
  const inicio = Date.now();
  const { installId, licenseKey, clientTag, deviceLabel, buildFingerprint, installType } = req.body || {};
  const ip = req.headers['x-forwarded-for'] || req.ip;
  if (!rateLimit('act:' + (installId||ip), 20, 60000)) { log('WARN', `Rate limit: ${installId ? String(installId).substring(0,12) : ip}`); return res.status(429).json({ error: 'rate_limited' }); }
  log('INFO', `Activate: installId=${installId ? String(installId).substring(0,12)+'…' : '?'} | key=${licenseKey ? normalizeKey(licenseKey).substring(0,18)+'…' : '(vazia)'}`);
  if (!installId || typeof installId !== 'string' || installId.length < 5 || installId.length > 256) return res.status(400).json({ error: 'missing_installId' });
  if (!PRIVATE_KEY) return res.status(500).json({ error: 'server_misconfigured' });

  if (licenseKey !== undefined && licenseKey !== null && typeof licenseKey !== 'string') {
    return res.status(400).json({ error: 'invalid_license_type' });
  }

  if (!licenseKey || typeof licenseKey !== 'string' || licenseKey.trim() === '') {
    const now = Math.floor(Date.now()/1000);
    const ent = buildEntitlement(null, installId, 0);
    const secret = buildSecret(installId, 'guest');
    const exp = now + 900; // [FIX #16] margem sobre isTokenUsable (10min)
    const claims = { sub: installId, iss: 'asheo.api', aud: 'mozlince-client', installId, plan:'free', planDisplayName:'Free', tier:'free', kind:'license', status:'inactive', active:false, isPremium:false, isVerified:false, source:'free', sourceType:'server', isFounder:false, lifetime:false, scope:['free'], features: mapFeatures(false), capabilities: mapCapabilities(false), limits:{...FREE_LIMITS}, secret, iat:now, nbf:now-5, exp, jti: crypto.randomUUID() };
    const token = signToken(claims, 'ASHEO-FREEREF');
    const gwPass = buildGwPass(installId, now + 82800, 'ASHEO-FREEREF');
    log('ATIV', `Guest token ${String(installId).substring(0,12)}… | ${Date.now()-inicio}ms`);
    return res.json({ token, tier:'free', secret, kind:'event', seat:0, seats:1, deviceId: installId, entitlement: ent, sub: installId, kid: null, keyName: null, jti: claims.jti, iat: now, exp, gwPass });
  }
  if (!licenseKey.toUpperCase().startsWith('ASHEO-')) return res.status(401).json({ error: 'missing_license' });
  const keyNorm = normalizeKey(licenseKey);
  const lic = await redisGet(keyNorm).catch(()=>null);
  if (!lic) { log('WARN', `NAO ENCONTRADA: ${keyNorm.substring(0,18)}…`); return res.status(404).json({ error: 'invalid_license' }); }
  if (!lic.ativa) return res.status(403).json({ error: 'revoked' });
  if (!lic.lifetime && Date.now() > lic.expiraEm) { log('WARN', `EXPIRADA: ${keyNorm.substring(0,18)}…`); return res.status(403).json({ error:'expired', message:'Esta licença expirou. Renove para continuar.', expiredAt: lic.expiraEm, expiredAtISO: new Date(lic.expiraEm).toISOString() }); }
  if (!lic.installId) { lic.installId = installId; lic.ativadaEm = Date.now(); lic.activationCount = (lic.activationCount||0)+1; await redisSet(keyNorm, lic); await redisIndexInstall(installId, keyNorm).catch(()=>{}); log('OK', `Vinculada: ${keyNorm.substring(0,18)}… → ${installId}`); }
  else if (lic.installId !== installId) return res.status(403).json({ error: 'already_used' });
  else { await redisIndexInstall(installId, keyNorm).catch(()=>{}); }
  try {
    const now = Math.floor(Date.now()/1000);
    const seatsUsed = Math.max(1, lic.activationCount || 1);
    const ent = buildEntitlement(lic, installId, seatsUsed);
    const isLife = lic.plano === 'life';
    const secret = buildSecret(installId, keyNorm);
    const kid = buildKid(keyNorm);
    const exp = now + 900; // [FIX #16]
    const claims = { sub: installId, iss: 'asheo.api', aud: 'mozlince-client', installId, plan: ent.plan, planDisplayName: ent.planDisplayName, tier: ent.tier, kind: 'license', status: ent.status, active: true, isPremium: true, isVerified: true, source:'premium', sourceType:'server', isFounder: false, lifetime: isLife, plano: lic.plano, licenseKey: keyNorm, issuedAt: lic.criadaEm, expiresAt: lic.expiraEm, scope: PREMIUM_SCOPE, features: mapFeatures(true), capabilities: mapCapabilities(true), limits:{...PREMIUM_LIMITS}, secret, iat: now, nbf: now-5, exp, jti: crypto.randomUUID() };
    const token = signToken(claims, kid);
    const gwPass = buildGwPass(installId, now + 82800, kid); // [FIX #3]
    const expiresIn = isLife ? -1 : Math.max(0, Math.floor((lic.expiraEm - Date.now())/1000));
    log('ATIV', `${String(installId).substring(0,12)}… | ${keyNorm.substring(0,18)}… | kid=${kid} | exp=+900s | ${Date.now()-inicio}ms`);
    return res.json({ token, tier: ent.tier, secret, kind:'event', seat:1, seats: ent.seatsAllowed, deviceId: installId, entitlement: ent, sub: installId, kid, keyName: null, jti: claims.jti, iat: now, exp, gwPass, expiresIn, expiresAt: lic.expiraEm, issuedAt: lic.criadaEm, licenseKey: keyNorm, welcome: { pt:'🎉 Parabéns! Licença ativada com sucesso.', en:'🎉 Congratulations! License successfully activated.' } });
  } catch (e) { log('ERRO', 'activate: ' + e.message); return res.status(500).json({ error:'internal', message: e.message }); }
}
app.post('/v1/activate', activateHandler); app.post('/api/v1/activate', activateHandler); app.post('/api/v1/license/activate', activateHandler);

/* ═══ FEATURE ACTIVATE ═══ */
async function featureActivateHandler(req, res) {
  const auth = validateAnyAuth(req);
  let hmac = { ok: false };
  if (!auth.ok) hmac = await validateHmac(req, req.rawBody);
  if (!auth.ok && !hmac.ok) return res.status(401).json({ ok:false, error:'missing_auth' });
  const feature = (req.body && req.body.feature) || req.query.feature;
  const buildDigest = (req.body && req.body.buildDigest) || req.headers['x-asheo-build'] || null;
  if (!feature) return res.status(400).json({ ok:false, error:'missing_feature' });
  const isKnown = FEATURE_KEYS.includes(feature) || CAPABILITY_KEYS.includes(feature) || Object.keys(PREMIUM_FEATURES_DEF).includes(feature);
  if (!isKnown) { log('WARN', `Feature desconhecida: ${feature}`); return res.status(404).json({ ok:false, error:'unknown_feature', got: feature }); }
  const isPremium = (auth.ok && auth.decoded.tier === 'premium' && !!(auth.decoded.licenseKey || auth.decoded.plano)) || hmac.ok;
  if (!isPremium) return res.status(403).json({ ok:false, error:'premium_required' });
  const now = Math.floor(Date.now()/1000);
  const exp = now + 300;
  const installId = auth.ok ? auth.decoded.sub : (hmac.ok ? (req.headers['x-asheo-install'] || 'hmac-user') : 'unknown');
  const kid = (auth.ok ? buildKid(auth.decoded.licenseKey || '') : buildKid(hmac.licenseKey || '')) || 'ASHEO-FREEREF';
  const nonce = jwt.sign({ sub: installId, installId, feature, kind:'feature', type:'feature', purpose:'feature-activation', tier:'premium', source:'premium', scope:[feature,'premium'], buildDigest, attestationOk:true, iat:now, nbf:now-5, exp, jti: crypto.randomUUID() }, PRIVATE_KEY, { algorithm:'ES256', keyid: kid });
  log('FEAT', `${feature} | ${String(installId).substring(0,12)}… | kid=${kid}`);
  res.json({ nonce, feature, expiresAt: exp*1000, attestationOk: true });
}
app.post('/v1/feature/activate', featureActivateHandler); app.get('/v1/feature/activate', featureActivateHandler);
app.post('/api/v1/feature/activate', featureActivateHandler); app.get('/api/v1/feature/activate', featureActivateHandler);

/* ═══ DEACTIVATE · VERIFY · HEARTBEAT ═══ */
// [FIX #13] deactivate exige auth e valida installId
async function deactivateHandler(req,res){
  const auth = validateAnyAuth(req);
  let hmac = { ok: false };
  if (!auth.ok) hmac = await validateHmac(req, req.rawBody);
  if (!auth.ok && !hmac.ok) return res.status(401).json({ ok:false, error:'missing_auth' });
  const installId = req.body && req.body.installId;
  if (!installId) return res.status(400).json({ ok:false, error:'missing_installId' });
  if (auth.ok && auth.decoded.sub !== installId) return res.status(403).json({ ok:false, error:'install_mismatch' });
  if (hmac.ok && req.headers['x-asheo-install'] !== installId) return res.status(403).json({ ok:false, error:'install_mismatch' });
  const licenseKey = hmac.ok ? hmac.licenseKey : (auth.ok ? (auth.decoded.licenseKey || '') : '');
  if (!licenseKey) return res.status(400).json({ ok:false, error:'no_license' });
  const k = normalizeKey(licenseKey);
  const lic = await redisGet(k).catch(()=>null);
  if (lic && lic.installId === installId) { await redisDelIndexInstall(installId).catch(()=>{}); lic.installId = null; lic.ativadaEm = null; await redisSet(k, lic); }
  res.json({ ok:true, message:'Desativado' });
}
app.post('/v1/deactivate',deactivateHandler); app.post('/api/v1/deactivate',deactivateHandler); app.post('/api/v1/license/deactivate',deactivateHandler);

function verifyHandler(req,res){ const {token} = req.body||{}; if (!token) return res.status(400).json({ok:false,error:'missing_token'}); try { const d = jwt.verify(token, PUBLIC_KEY||PRIVATE_KEY, {algorithms:['ES256'], clockTolerance:30}); return res.json({ok:true,valido:true,dados:d}); } catch(e) { return res.status(401).json({ok:false,valido:false,erro:e.message}); } }
app.post('/v1/verify',verifyHandler); app.post('/api/v1/verify',verifyHandler); app.post('/api/v1/license/verify',verifyHandler);

function heartbeatHandler(req,res){ const auth = validateAnyAuth(req); if (!auth.ok) return res.status(401).json({ok:false,error:'missing_auth'}); res.json({ ok:true, alive:true, serverTime: Date.now(), expiresAt: auth.decoded.expiresAt, expiresIn: auth.decoded.expiresAt ? Math.max(0, Math.floor((auth.decoded.expiresAt - Date.now())/1000)) : -1, lifetime: auth.decoded.lifetime === true, maxServer: Date.now() }); }
app.post('/v1/heartbeat',heartbeatHandler); app.get('/v1/heartbeat',heartbeatHandler);
app.post('/api/v1/heartbeat',heartbeatHandler); app.get('/api/v1/heartbeat',heartbeatHandler);

/* ═══ ATTEST · BUILD VERIFY ═══ */
app.post('/v1/attest', (req, res) => { const auth = validateAnyAuth(req); const { buildDigest, files, manifestHash } = req.body || {}; log('API', `/v1/attest digest=${String(buildDigest||'').substring(0,16)||'∅'}`); res.json({ ok:true, attestationOk:true, digest: buildDigest || 'asheo-deobfuscated-v1.6.2', verified:true }); });
app.get('/v1/attest', (req, res) => res.json({ ok:true, attestationOk:true, verified:true }));
app.post('/v1/build/verify', (req, res) => { res.json({ ok:true, valid:true, buildDigest: req.body?.buildDigest || 'asheo-deobfuscated-v1.6.2' }); });

/* ═══ ENTITLEMENT REFRESH · SESSION · PREMIUM UNLOCK ═══ */
app.post('/v1/entitlement/refresh', (req, res) => { const auth = validateAnyAuth(req); if (!auth.ok) return res.status(401).json({ ok:false, error:'missing_auth' }); const isPremium = auth.decoded.tier === 'premium' && !!(auth.decoded.licenseKey || auth.decoded.plano); res.json({ ok:true, source: isPremium?'premium':'free', tier: isPremium?'premium':'free', active: isPremium, isPremium, features: mapFeatures(isPremium), capabilities: mapCapabilities(isPremium), limits: isPremium?{...PREMIUM_LIMITS}:{...FREE_LIMITS}, scope: isPremium?PREMIUM_SCOPE:['free'], serverTime: Date.now() }); });
app.post('/v1/session/start', (req, res) => { const auth = validateAnyAuth(req); const isPremium = auth.ok && auth.decoded.tier === 'premium' && !!(auth.decoded.licenseKey || auth.decoded.plano); res.json({ ok:true, sessionId: crypto.randomUUID(), source: isPremium?'premium':'free', tier: isPremium?'premium':'free', startedAt: Date.now(), expiresAt: Date.now() + 3600000, features: mapFeatures(isPremium), capabilities: mapCapabilities(isPremium) }); });
app.post('/v1/premium/unlock', (req, res) => { const auth = validateAnyAuth(req); if (!auth.ok) return res.status(401).json({ ok:false, error:'missing_auth' }); const isPremium = auth.decoded.tier === 'premium' && !!(auth.decoded.licenseKey || auth.decoded.plano); if (!isPremium) return res.status(403).json({ ok:false, error:'premium_required' }); const { feature } = req.body || {}; res.json({ ok:true, unlocked:true, feature: feature||'all', tier:'premium', serverTime: Date.now() }); });

/* ═══════════════════════════════════════════════════════════════
   GATEWAY PROXY — alinhado com inject.js ORIGINAL
   ───────────────────────────────────────────────────────────────
   - Parseia {__asheo, body} JSON E form-urlencoded
   - Respeita x-asheo-swap-only, x-asheo-3ds-strip, x-asheo-remove-cvv
   - Usa x-asheo-auth, x-asheo-bt-host, x-asheo-special-hosts (validado)
   - Seta x-asheo-swapped e x-asheo-proxied corretos
   - Repassa location em redirects
   - NÃO injeta cartão (o gatewayEngine.js já faz no client)
   ═══════════════════════════════════════════════════════════════ */
const FORWARD_HEADER_ALLOWLIST = new Set(['accept','accept-language','origin','referer','user-agent','x-requested-with','x-api-key','authorization','x-adyen-api-key','stripe-version']);

// [FIX #9] aceita JSON E form-urlencoded
function parseAsheoWrapper(bodyOut, ctype) {
  if (!bodyOut || !ctype) return null;
  if (ctype.includes('json')) {
    try {
      const parsed = JSON.parse(bodyOut);
      if (parsed && typeof parsed === 'object' && parsed.__asheo && typeof parsed.body === 'string') return { meta: parsed.__asheo, realBody: parsed.body };
    } catch {}
  }
  if (ctype.includes('form-urlencoded') || ctype.includes('application/x-www-form-urlencoded')) {
    try {
      const p = new URLSearchParams(bodyOut);
      if (p.has('__asheo') && p.has('body')) {
        let meta = {};
        try { meta = JSON.parse(p.get('__asheo')); } catch {}
        return { meta, realBody: p.get('body') };
      }
    } catch {}
  }
  return null;
}

// [FIX #11] NÃO remover browserInfo (Adyen precisa)
function strip3dsFields(body) {
  if (!body) return body;
  try {
    const j = JSON.parse(body);
    if (!j || typeof j !== 'object') return body;
    const strip = (o) => {
      if (!o || typeof o !== 'object') return;
      for (const k of Object.keys(o)) {
        if (/^threeDS|^challenge|^redirectResult/i.test(k)) { delete o[k]; }
        else if (typeof o[k] === 'object') strip(o[k]);
      }
    };
    strip(j);
    return JSON.stringify(j);
  } catch { return body; }
}

function stripCvvFields(body, ctype) {
  if (!body) return body;
  if (ctype.includes('form-urlencoded')) {
    try {
      const p = new URLSearchParams(body);
      for (const k of ['cvv','cvc','csc','security_code','card[cvv]','card[cvc]']) p.delete(k);
      return p.toString();
    } catch { return body; }
  }
  if (ctype.includes('json')) {
    try {
      const j = JSON.parse(body);
      if (!j || typeof j !== 'object') return body;
      const strip = (o) => {
        if (!o || typeof o !== 'object') return;
        for (const k of Object.keys(o)) {
          if (/^(cvv|cvc|csc|security_?code)$/i.test(k)) { delete o[k]; }
          else if (typeof o[k] === 'object') strip(o[k]);
        }
      };
      strip(j);
      return JSON.stringify(j);
    } catch { return body; }
  }
  return body;
}

// [FIX #8] mapeia path → tipo de gateway para x-asheo-proxied
function pathToProxiedType(p) {
  if (p.startsWith('/v1/process/adyen') || p.startsWith('/v1/gw/adyen')) return 'adyen';
  if (p.startsWith('/v1/process/tebex') || p.startsWith('/v1/gw/tebex')) return 'tebex';
  if (p.startsWith('/v1/process/tebex-creq') || p.startsWith('/v1/gw/tebex-creq')) return 'tebex-creq';
  if (p.startsWith('/v1/process/basistheory') || p.startsWith('/v1/gw/basistheory')) return 'basistheory';
  if (p.startsWith('/v1/process/stripe-3ds2')) return 'stripe-3ds2';
  if (p.startsWith('/v1/gw/chess')) return 'chess';
  if (p.startsWith('/v1/gw/boosteroid')) return 'boosteroid';
  if (p.startsWith('/v1/gw/gog')) return 'gog';
  if (p.startsWith('/v1/gw/encgw')) return 'encgw';
  return '1';
}

async function gwProxyHandler(req, res) {
  const inicio = Date.now();
  const auth = validateAnyAuth(req);
  let hmac = { ok: false };
  if (!auth.ok) hmac = await validateHmac(req, req.rawBody);
  const target = req.headers['x-asheo-target'];
  const method = (req.headers['x-asheo-method'] || req.method || 'POST').toUpperCase();
  const headersRaw = req.headers['x-asheo-headers'];
  const origin = req.headers['x-asheo-origin'] || '';
  const install = req.headers['x-asheo-install'] || '';
  const swapOnly = req.headers['x-asheo-swap-only'] === 'true';
  const threeDsStrip = req.headers['x-asheo-3ds-strip'];
  const removeCvv = req.headers['x-asheo-remove-cvv'] === 'true';
  const btHost = req.headers['x-asheo-bt-host'];
  const asheoAuth = req.headers['x-asheo-auth'];
  const path = req.path;
  log('GW', `→ ${path} | target=${String(target||'').substring(0,70)} | inst=${String(install).substring(0,12)} | auth=${auth.ok?auth.mode||'bearer':(hmac.ok?'hmac:'+hmac.format:'✕')} | swap=${swapOnly} 3ds=${threeDsStrip||'-'} cvv=${removeCvv}`);

  if (!target) { log('WARN', `${path} — missing x-asheo-target`); return res.status(400).json({ ok:false, error:'missing_target' }); }

  let specialHosts = [];
  try {
    const raw = req.headers['x-asheo-special-hosts'];
    if (raw) {
      const claimed = JSON.parse(raw);
      const licenseKey = hmac.ok ? hmac.licenseKey : (auth.ok ? (auth.decoded.licenseKey || '') : '');
      specialHosts = await validateSpecialHosts(licenseKey, claimed); // [FIX #6]
      if (claimed.length !== specialHosts.length) {
        log('WARN', `${path} — specialHosts bloqueados: ${claimed.length - specialHosts.length} (${claimed.map(s=>s.host).join(',')})`);
      }
    }
  } catch {}

  let effectiveTarget = target;
  if (btHost && typeof target === 'string' && target.startsWith('/')) {
    effectiveTarget = `https://${btHost}${target}`;
  }

  if (!isAllowedTarget(effectiveTarget, specialHosts)) { log('WARN', `${path} — target NÃO PERMITIDO: ${String(effectiveTarget).substring(0,80)}`); return res.status(403).json({ ok:false, error:'target_not_allowed', target: effectiveTarget }); }
  if (!rateLimit('gw:' + (install || req.ip), 60, 60000)) { log('WARN', `${path} — rate limit ${install}`); return res.status(429).json({ ok:false, error:'rate_limited' }); }

  let forwardHeaders = { 'user-agent': req.headers['user-agent'] || 'Mozilla/5.0', 'accept': 'application/json, text/plain, */*', 'accept-language': req.headers['accept-language'] || 'en-US,en;q=0.9' };
  // [FIX #12] content-type vem do req atual, não de origHeaders
  const currentCtype = String(req.headers['content-type'] || 'application/json').toLowerCase();
  let origCtype = null;
  try {
    if (headersRaw) {
      const parsed = JSON.parse(headersRaw);
      for (const [k, v] of Object.entries(parsed)) {
        const lk = String(k).toLowerCase();
        if (typeof v === 'string' && !lk.startsWith(':') && FORWARD_HEADER_ALLOWLIST.has(lk)) {
          if (lk === 'content-type') { origCtype = v; continue; } // [FIX #12] não sobrescreve
          forwardHeaders[lk] = v;
        }
      }
    }
  } catch (e) { log('WARN', `${path} — x-asheo-headers inválido`); }
  forwardHeaders['content-type'] = currentCtype;
  if (origin) { try { const ou = new URL(origin); forwardHeaders['origin'] = ou.origin; forwardHeaders['referer'] = ou.origin + '/'; } catch {} }
  if (asheoAuth) forwardHeaders['authorization'] = asheoAuth;

  let bodyOut = null;
  if (method !== 'GET' && method !== 'HEAD') {
    if (req.rawBody && req.rawBody.length > 0) {
      // [FIX #4] multipart/binário: preserva Buffer cru; texto: toString
      if (currentCtype.includes('multipart') || currentCtype.includes('octet-stream')) bodyOut = req.rawBody;
      else bodyOut = req.rawBody.toString('utf8');
    }
    else if (typeof req.body === 'string') bodyOut = req.body;
    else if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      if (currentCtype.includes('json')) bodyOut = JSON.stringify(req.body);
      else { const p = new URLSearchParams(); for (const [k,v] of Object.entries(req.body)) p.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v)); bodyOut = p.toString(); }
    } else if (Buffer.isBuffer(req.body)) bodyOut = req.body;
  }
  const ctype = currentCtype;

  const wrapper = (typeof bodyOut === 'string') ? parseAsheoWrapper(bodyOut, ctype) : null;
  let modified = false;
  if (wrapper) {
    log('GW', `${path} — __asheo wrapper detectado (meta keys: ${Object.keys(wrapper.meta||{}).join(',')})`);
    bodyOut = wrapper.realBody;
    modified = true;
    if (wrapper.meta.removeCvv || removeCvv) { bodyOut = stripCvvFields(bodyOut, ctype); modified = true; }
  } else if (removeCvv && typeof bodyOut === 'string') {
    bodyOut = stripCvvFields(bodyOut, ctype);
    modified = true;
  }

  if (threeDsStrip === 'true' && typeof bodyOut === 'string' && ctype.includes('json')) {
    bodyOut = strip3dsFields(bodyOut);
    modified = true;
    log('GW', `${path} — 3ds fields stripped`);
  }

  // [FIX #10] ajusta content-type do realBody se wrapper mudou
  if (wrapper && typeof bodyOut === 'string') {
    const t = bodyOut.trim();
    if (t.startsWith('{') || t.startsWith('[')) forwardHeaders['content-type'] = 'application/json';
    else if (t.includes('=') && !ctype.includes('json')) forwardHeaders['content-type'] = 'application/x-www-form-urlencoded';
  }

  const ctrl = new AbortController(); // [FIX #17]
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const upstream = await fetch(effectiveTarget, { method, headers: forwardHeaders, body: bodyOut, redirect: 'manual', signal: ctrl.signal });
    clearTimeout(timer);
    const respCt = upstream.headers.get('content-type') || 'application/json';
    const respBody = await upstream.text();
    const elapsed = Date.now() - inicio;
    log('OK', `${path} ← ${upstream.status} | ${elapsed}ms${modified?' (modified)':''}`);
    res.status(upstream.status);
    res.setHeader('content-type', respCt);
    res.setHeader('x-asheo-upstream-status', String(upstream.status));
    res.setHeader('x-asheo-proxied', pathToProxiedType(path)); // [FIX #8]
    res.setHeader('x-asheo-elapsed-ms', String(elapsed));
    // [FIX #7] sinaliza swap quando modificamos o body
    if (modified) res.setHeader('x-asheo-swapped', 'true');
    if (hmac.ok) res.setHeader('x-asheo-hmac-format', hmac.format || 'unknown');
    // [FIX #18] repassa location
    const loc = upstream.headers.get('location');
    if (loc) res.setHeader('location', loc);
    for (const h of ['x-asheo-swap-ok','x-asheo-adyen-verdict','x-asheo-adyen-result','x-asheo-adyen-reason','x-asheo-3ds2-verdict','x-asheo-3ds2-attempts','x-asheo-3ds2-trail']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    return res.send(respBody);
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') { log('ERRO', `${path} upstream timeout`); return res.status(504).json({ ok:false, error:'upstream_timeout', target: effectiveTarget }); }
    log('ERRO', `${path} upstream erro: ${e.message}`);
    return res.status(502).json({ ok:false, error:'upstream_failed', message: e.message, target: effectiveTarget });
  }
}

// Rotas do proxy — Express 4 usa '*' (não '*splat')
app.all('/v1/gw/3ds2/authenticate', gwProxyHandler);
app.all('/v1/gw/3ds2/challenge', gwProxyHandler);
app.all('/v1/gw/3ds2/setup', gwProxyHandler);
app.all('/v1/gw/3ds2/*', gwProxyHandler);
app.all('/v1/gw/adyen/*', gwProxyHandler);
app.all('/v1/gw/chess/*', gwProxyHandler);
app.all('/v1/gw/boosteroid/*', gwProxyHandler);
app.all('/v1/gw/gog/*', gwProxyHandler);
app.all('/v1/gw/tebex/*', gwProxyHandler);
app.all('/v1/gw/tebex-creq/*', gwProxyHandler);
app.all('/v1/gw/basistheory/*', gwProxyHandler);
app.all('/v1/gw/encgw/*', gwProxyHandler);
app.all('/v1/gw/*', gwProxyHandler);
app.all('/v1/process', gwProxyHandler);
app.all('/v1/process/adyen/:id', gwProxyHandler);
app.all('/v1/process/tebex/:id', gwProxyHandler);
app.all('/v1/process/tebex-creq/:id', gwProxyHandler);
app.all('/v1/process/basistheory/tokens', gwProxyHandler);
app.all('/v1/process/basistheory/:id', gwProxyHandler);
app.all('/v1/process/stripe-3ds2/:id', gwProxyHandler);
app.all('/v1/process/encgw/:id', gwProxyHandler);
app.all('/v1/process/*', gwProxyHandler);

/* ═══ CAMPAIGN CLICK ═══ */
app.post('/v1/campaign/click', async (req, res) => {
  const { campaignId, installId } = req.body || {};
  log('API', `/v1/campaign/click id=${campaignId||'∅'}`);
  if (campaignId) { try { await redisIncr(`ASHEO-CAMPAIGN-CLICKS-${normalizeKey(campaignId)}`); } catch {} } // [FIX #20]
  res.json({ ok:true, received:true, serverTime: Date.now() });
});

/* ═══ 404 ═══ */
app.use((req,res)=>{ res.status(404).json({ok:false,error:'not_found',path:req.path}); });

/* ═══ START ═══ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  banner();
  log('SYS', `Mozlince Nebula v9.0.0 Quantum+ Hardened na porta ${PORT}`);
  log('SYS', `Server URL: ${SERVER_URL}`);
  log('SYS', `Extensão v1.6.2 aponta para: ${EXT_API_BASE_DEFAULT}`);
  log('SYS', `Chave: ${ORIGEM}`);
  if (JWK_PUBLIC) log('SYS', `JWK público: x=${(JWK_PUBLIC.x||'').slice(0,20)}… y=${(JWK_PUBLIC.y||'').slice(0,20)}…`);
  log('SYS', `Redis: ${UPSTASH_URL && UPSTASH_TOKEN ? 'OK' : 'FALTA'}`);
  log('SYS', `Telegram: ${TELEGRAM_TOKEN ? 'OK' : 'FALTA'}`);
  log('SYS', `OWNER_ID: ${OWNER_ID ? 'OK' : 'FALTA'}`);
  log('SYS', `Webhook secret: ${TELEGRAM_WEBHOOK_SECRET ? 'ATIVO' : 'ausente'}`);
  log('SYS', `Planos: ${Object.keys(PACOTES).length} (USD)`);
  log('RULES', `Payment Rules: ${PAYMENT_RULES.length} (v${RULES_VERSION})`);
  log('RULES', `Exclusive Targets: ${EXCLUSIVE_TARGETS.length}`);
  log('OK', `✔ [FIX #1] JWK alinhada + abort no mismatch`);
  log('OK', `✔ [FIX #2] /v1/bootstrap inclui campaign + manifest`);
  log('OK', `✔ [FIX #3] gwPass exp=+82800s (23h) alinhado ao cache`);
  log('OK', `✔ [FIX #4] tier/features/limits condicionais a ok`);
  log('OK', `✔ [FIX #5] HMAC checa licença ativa/expirada`);
  log('OK', `✔ [FIX #6] specialHosts validado contra Redis`);
  log('OK', `✔ [FIX #7] x-asheo-swapped=true quando modifica`);
  log('OK', `✔ [FIX #8] x-asheo-proxied=<tipo>`);
  log('OK', `✔ [FIX #9] parseAsheoWrapper aceita form-urlencoded`);
  log('OK', `✔ [FIX #10] content-type do realBody ajustado`);
  log('OK', `✔ [FIX #11] strip3dsFields não remove browserInfo`);
  log('OK', `✔ [FIX #12] content-type do req atual, não origHeaders`);
  log('OK', `✔ [FIX #13] deactivate exige auth + valida installId`);
  log('OK', `✔ [FIX #14] redisLookupInstall auto-recupera via SCAN`);
  log('OK', `✔ [FIX #15] (N/A) entry30.proxy ignorado — ver nota no README`);
  log('OK', `✔ [FIX #16] token exp=+900s (margem sobre isTokenUsable)`);
  log('OK', `✔ [FIX #17] fetch com AbortController 30s`);
  log('OK', `✔ [FIX #18] location repassado`);
  log('OK', `✔ [FIX #19] trust proxy`);
  log('OK', `✔ [FIX #20] campaign.click INCR atômico`);
  log('OK', `✔ [FIX #21] escapeHtml no Telegram`);
  log('OK', `✔ [FIX #22] isAllowedTarget simplificado`);
  log('OK', `✔ HMAC 3 formatos (inject/session/deactivate) + legacy`);
  log('OK', `✔ encPack AES-256-GCM base64 PADRÃO (não base64url)`);
  log('OK', `✔ Redis com timeout 5s + retry`);
  log('OK', `✔ Bot Telegram + DM + Suporte + /resp`);
  if (JWK_PUBLIC && JWK_PUBLIC.x === EXPECTED_JWK.x) log('OK', `✔ JWK match — extensão vai aceitar os tokens`);
});

process.on('uncaughtException', e => log('ERRO', 'Uncaught: ' + (e && e.stack || e)));
process.on('unhandledRejection', e => log('ERRO', 'Rejection: ' + (e && e.stack || e)));
process.on('SIGTERM', () => { log('SYS','SIGTERM — encerrando'); process.exit(0); });
process.on('SIGINT', () => { log('SYS','SIGINT — encerrando'); process.exit(0); });
