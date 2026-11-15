#!/usr/bin/env node
'use strict';

/**
 * SuperAI Chain 只读监测
 * - 新代币 / 新验证合约
 * - USDT / PB / FEC 总量变化
 * - 关键地址 USDT 余额变化
 * - >= 5,000 USDT 的转账
 * - UswapV5 新池子
 *
 * 用法:
 *   node monitor.js --once
 *   node monitor.js --interval=300
 *
 * 只读，不需要私钥。
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  base: 'https://scan.superaichain.ai',
  rpc: 'https://rpc.superaichain.ai',
  poolsUrl: 'https://swap.superaichain.ai/api/pools',
  ua: 'Mozilla/5.0',
  usdt: '0x8378c6E49cF01D59e532835C66caF0550EdBeEF8',
  pb: '0xCD9b3DAfc6ba89eAC2F8e9bA9774f97Cbc0dC6FC',
  fec: '0x383C65b4f4F74a1c722C65B52dAdEAA6C21E8A47',
  thresholdUsdt: 5000,       // 大额转账/余额变化阈值
  thresholdBalance: 10000,   // 关键地址余额变化阈值
  keyAddresses: {
    v3Bridge:       '0x6271B38B665a52b0BDE517DfF55f6603636Ef790',
    router:         '0x9E93E12359f20DEB41cbcb25096Ec521b0e3db69',
    pbMinter:       '0xd61e8cb21b25854b97e24d691c0c2978cb0a8df1',
    oldBridgeAdmin: '0xef6A6C990F2D0b3d63E027f0076d9f49Db80349b',
    oldBridge8725:  '0x872533e440acd4657b6aaF563095E3941153846a',
    largeReceiver:  '0x0485D812293802b5e7a1cF0d604748E248d40a8a'
  },
  // 链上质押：stVal1-4 是 Stake ValN Credit；持有者是 4 个 validator 质押 EOA
  staking: [
    { name: 'stVal1', token: '0x4AFc633E7B6bEB8e552ccddbE06Cca3754991E9A', holder: '0xEE76dcA8a1C9C37F72fa1c1CF63Fa5EF5Bd1BA2e' },
    { name: 'stVal2', token: '0xeC06CB25d9add4bDd67B61432163aFF9028Aa921', holder: '0x9aF56711D21409A5D42142037d1Efa792ba82F2C' },
    { name: 'stVal3', token: '0x2804ADA1C219E50898e75B2Bd052030580f4fbAC', holder: '0x3321e4378d13818fa0ab3aa69BF04347880872d1' },
    { name: 'stVal4', token: '0x7597E59607A1e91E5B4Af6b63c3A0c5070445A52', holder: '0xf2c4Dd414Efcf9E469821FF5531A616701958dd4' }
  ],
  // 项目方质押收款 EOA / 用户地址：只跟踪 native SUP 余额
  nativeWatch: [
    { name: 'userE28', addr: '0xeC8127661F9872816c7593834658442482499E28' },
    { name: 'stakeEOA', addr: '0xD6942bfa6b9786405b8E73e68089be4190b973d1' },
    { name: 'stakePoolEb83', addr: '0xeb83cE4a3Ba06BDf91f1e9E7b46018040831781A', minDelta: 100 },
    { name: 'rewardEf6A', addr: '0xef6A6C990F2D0b3d63E027f0076d9f49Db80349b', minDelta: 100 },
    { name: 'whale1f4e', addr: '0x1f4eB08a0A0dAA1b52495989c61D11E6CB185319' },
    { name: 'pbOtc6581', addr: '0x6581e8d747aD504D459d2D5b05a298Bb3B87F100' },
    { name: 'whale883B', addr: '0x883B611dFAc35dD7c249c0f7b187fe2950690aDE' },
    { name: 'whale2A26', addr: '0x2A266b4cC01d0473c94E978a007A948C130C2170' },
    { name: 'whale0c70', addr: '0x0c70132C8bC68d08492fE2d4f8079Feb2fDC4b70' }
  ],
  watchTokens: [
    { symbol: 'SIP',  address: '0x454da3B0Ce6798Ca80C3742D119C2e52b1e37A1E', decimals: 8 },
    { symbol: 'BNB',  address: '0x66b1a83E1D96d216157782e4B2733B9c81e51091', decimals: 18 },
    { symbol: 'sSOL', address: '0xeFd5981Ad14A24b565BFD63C830Dd2504b431568', decimals: 9 },
    { symbol: 'sTRX', address: '0x1Be3D31F0354f9Ad34444Ceb0caf025445F0F0f8', decimals: 6 },
    { symbol: 'USDC', address: '0xfFd0FE9823C17B4b2B6B3cCf4D9a288fA277e414', decimals: 6 }
  ],
  stateFile: path.join(__dirname, 'state.json'),
  logFile: path.join(__dirname, 'monitor.log')
};

function log(line) {
  const s = `[${new Date().toISOString()}] ${line}`;
  console.log(s);
  try { fs.appendFileSync(CONFIG.logFile, s + '\n'); } catch (e) {}
}

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: {
        'User-Agent': CONFIG.ua,
        'Accept': 'application/json',
        ...(opts.headers || {})
      },
      timeout: 45000
    }, res => {
      let s = '';
      res.on('data', c => s += c);
      res.on('end', () => resolve({ status: res.statusCode, body: s }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout ' + url)));
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function getJSON(url, retries = 3) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await request(url);
      if (r.status >= 200 && r.status < 300) return JSON.parse(r.body);
      last = new Error(`HTTP ${r.status} ${url}`);
    } catch (e) { last = e; }
    await new Promise(r => setTimeout(r, 1200));
  }
  throw last;
}

async function rpc(method, params, retries = 3) {
  let last;
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  for (let i = 0; i < retries; i++) {
    try {
      const r = await request(CONFIG.rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      const j = JSON.parse(r.body);
      if (j.error) throw new Error(j.error.message || 'rpc error');
      return j.result;
    } catch (e) { last = e; }
    await new Promise(r => setTimeout(r, 1200));
  }
  throw last;
}

function padAddr(a) {
  return '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

async function call(to, data) {
  const r = await rpc('eth_call', [{ to, data }, 'latest']);
  return BigInt(r);
}

async function balanceOf(token, addr) {
  return call(token, '0x70a08231' + padAddr(addr).slice(2));
}

async function totalSupply(token) {
  return call(token, '0x18160ddd');
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf8')); } catch (e) { return null; }
}

function saveState(s) {
  fs.writeFileSync(CONFIG.stateFile, JSON.stringify(s, null, 2));
}

function fmt(raw, dec = 6) {
  const v = Number(BigInt(raw)) / 10 ** dec;
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function loadEnv() {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

async function callOwner(addr) {
  try {
    const r = await rpc('eth_call', [{ to: addr, data: '0x8da5cb5b' }, 'latest']);
    return '0x' + String(r).slice(-40);
  } catch (e) { return null; }
}

async function notify(alerts) {
  if (!alerts.length) return;
  const text = alerts.join('\n');
  const env = process.env;
  if (env.NTFY_TOPIC) {
    try {
      await request('https://ntfy.sh/' + encodeURIComponent(env.NTFY_TOPIC), {
        method: 'POST',
        headers: { 'Title': 'SuperAI monitor', 'Priority': 'high', 'Tags': 'warning', 'Content-Type': 'text/plain; charset=utf-8' },
        body: text
      });
    } catch (e) { log('[NOTIFY ERR] ntfy ' + (e.message || e)); }
  }
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    try {
      await request(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage?chat_id=${encodeURIComponent(env.TELEGRAM_CHAT_ID)}&text=${encodeURIComponent(text)}`);
    } catch (e) { log('[NOTIFY ERR] telegram ' + (e.message || e)); }
  }
  if (env.WEBHOOK_URL) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (env.PUSH_API_KEY) headers['X-API-Key'] = env.PUSH_API_KEY;
      await request(env.WEBHOOK_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'SuperAI Monitor', body: text, topic: 'chain', url: '/', priority: 'high', alerts })
      });
    } catch (e) { log('[NOTIFY ERR] webhook ' + (e.message || e)); }
  }
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.PUSH_SUBSCRIPTION) {
    try {
      const webpush = require('web-push');
      webpush.setVapidDetails('mailto:admin@superai.local', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
      const sub = JSON.parse(env.PUSH_SUBSCRIPTION);
      await webpush.sendNotification(sub, JSON.stringify({ title: 'SuperAI Monitor', body: text, topic: 'chain', url: '/', priority: 'high', tag: 'superai-chain' }), { TTL: 3600, urgency: 'high' });
    } catch (e) { log('[NOTIFY ERR] direct push ' + (e.statusCode || '') + ' ' + (e.message || e)); }
  }
}

async function snapshot() {
  const [stats, tokens, pools, contracts, transfers] = await Promise.all([
    getJSON(CONFIG.base + '/api/v2/stats'),
    getJSON(CONFIG.base + '/api/v2/tokens?limit=100'),
    getJSON(CONFIG.poolsUrl),
    getJSON(CONFIG.base + '/api/v2/smart-contracts'),
    getJSON(CONFIG.base + '/api/v2/tokens/' + CONFIG.usdt + '/transfers')
  ]);

  const [usdtSupply, pbSupply, fecSupply] = await Promise.all([
    totalSupply(CONFIG.usdt),
    totalSupply(CONFIG.pb),
    totalSupply(CONFIG.fec)
  ]);

  const balances = {};
  for (const [name, addr] of Object.entries(CONFIG.keyAddresses)) {
    balances[name] = (await balanceOf(CONFIG.usdt, addr)).toString();
  }

  const staking = [];
  for (const s of CONFIG.staking) {
    const supply = await totalSupply(s.token);
    const holderBal = await balanceOf(s.token, s.holder);
    const sup = BigInt(await rpc('eth_getBalance', [s.holder, 'latest']));
    staking.push({
      name: s.name,
      token: s.token,
      holder: s.holder,
      supply: supply.toString(),
      holderBal: holderBal.toString(),
      sup: sup.toString()
    });
  }

  const native = {};
  for (const w of CONFIG.nativeWatch) {
    native[w.name] = (BigInt(await rpc('eth_getBalance', [w.addr, 'latest']))).toString();
  }

  const tokenMap = {};
  for (const t of tokens.items || []) {
    tokenMap[t.address_hash.toLowerCase()] = {
      symbol: t.symbol,
      decimals: t.decimals,
      supply: String(t.total_supply),
      holders: t.holders_count
    };
  }

  const poolMap = {};
  for (const p of pools.pools || []) {
    poolMap[p.poolId] = {
      id: p.poolId,
      t0: p.t0 && p.t0.symbol,
      t1: p.t1 && p.t1.symbol,
      price: p.price,
      change24h: p.change24h,
      tvl: p.tvlUsdt,
      vol24: p.volume24hUsdt
    };
  }

  const watch = {};
  for (const t of CONFIG.watchTokens || []) {
    try {
      let supply = null, holders = null, name = t.symbol, decimals = t.decimals;
      try {
        const d = await getJSON(CONFIG.base + '/api/v2/tokens/' + t.address);
        supply = d.total_supply;
        holders = d.holders_count;
        name = d.name || t.symbol;
        decimals = d.decimals == null ? t.decimals : d.decimals;
      } catch (e) {}
      if (supply == null) {
        try { supply = (await totalSupply(t.address)).toString(); } catch (e) {}
      }
      const owner = await callOwner(t.address);
      const pool = Object.values(poolMap).find(p => p.t0 === t.symbol || p.t1 === t.symbol);
      watch[t.symbol] = {
        address: t.address, name, decimals, supply, holders, owner,
        pool: pool ? { id: pool.id, t0: pool.t0, t1: pool.t1, price: pool.price, tvl: pool.tvl } : null
      };
    } catch (e) {
      watch[t.symbol] = { address: t.address, error: e.message || String(e) };
    }
  }

  const contractAddrs = (contracts.items || [])
    .map(x => x.address && x.address.hash && x.address.hash.toLowerCase())
    .filter(Boolean);

  const threshold = BigInt(CONFIG.thresholdUsdt) * 1000000n; // USDT 6 位
  const largeTransfers = (transfers.items || [])
    .filter(t => BigInt((t.total && t.total.value) || 0) >= threshold)
    .map(t => ({
      hash: t.transaction_hash || t.tx_hash || (t.transaction && t.transaction.hash) || '',
      timestamp: t.timestamp,
      value: String((t.total && t.total.value) || 0),
      from: t.from && t.from.hash,
      to: t.to && t.to.hash
    }));

  return {
    lastRun: new Date().toISOString(),
    lastBlock: Number(stats.total_blocks),
    stats: {
      blocks: stats.total_blocks,
      addresses: stats.total_addresses,
      transactions: stats.total_transactions
    },
    usdtSupply: usdtSupply.toString(),
    pbSupply: pbSupply.toString(),
    fecSupply: fecSupply.toString(),
    tokens: tokenMap,
    pools: poolMap,
    watch,
    contracts: contractAddrs,
    balances,
    staking,
    native,
    largeTransfers
  };
}

function diff(prev, next) {
  const alerts = [];
  if (!prev) return alerts;

  // 1. 新代币
  for (const [addr, t] of Object.entries(next.tokens)) {
    if (!prev.tokens[addr]) {
      alerts.push(`[NEW TOKEN] ${t.symbol || '?'} ${addr} supply=${t.supply} holders=${t.holders}`);
    }
  }

  // 2. 代币总量变化（列表中的）
  for (const [addr, t] of Object.entries(next.tokens)) {
    const p = prev.tokens[addr];
    if (p && String(p.supply) !== String(t.supply)) {
      alerts.push(`[SUPPLY] ${t.symbol || '?'} ${addr}: ${p.supply} -> ${t.supply}`);
    }
  }

  // 3. USDT/PB/FEC 总量（RPC 精确值）
  for (const [name, key] of [['USDT', 'usdtSupply'], ['PB', 'pbSupply'], ['FEC', 'fecSupply']]) {
    if (String(prev[key]) !== String(next[key])) {
      alerts.push(`[SUPPLY ${name}] ${prev[key]} -> ${next[key]}`);
    }
  }

  // 4. 关键地址 USDT 余额
  for (const [name, v] of Object.entries(next.balances)) {
    const p = prev.balances[name];
    if (p === undefined) continue;
    const d = BigInt(v) - BigInt(p);
    if (d >= BigInt(CONFIG.thresholdBalance) * 1000000n || -d >= BigInt(CONFIG.thresholdBalance) * 1000000n) {
      alerts.push(`[BALANCE] ${name}: ${fmt(p)} -> ${fmt(v)} USDT (${d > 0n ? '+' : ''}${fmt(d)})`);
    }
  }

  // 5. 质押：stVal 总量 / 持有者余额 / 持有者 native SUP
  const prevStake = Object.fromEntries((prev.staking || []).map(x => [x.name, x]));
  for (const s of next.staking || []) {
    const p = prevStake[s.name];
    if (!p) continue;
    if (String(p.supply) !== String(s.supply)) alerts.push(`[STAKING SUPPLY] ${s.name} ${fmt(p.supply, 18)} -> ${fmt(s.supply, 18)}`);
    if (String(p.holderBal) !== String(s.holderBal)) alerts.push(`[STAKING HOLDER] ${s.name} ${s.holder}: ${fmt(p.holderBal, 18)} -> ${fmt(s.holderBal, 18)}`);
    if (String(p.sup) !== String(s.sup)) alerts.push(`[STAKING SUP] ${s.name} ${s.holder}: ${fmt(p.sup, 18)} -> ${fmt(s.sup, 18)} SUP`);
  }

  // 6. 用户/项目质押 EOA 的 native SUP
  for (const [n, v] of Object.entries(next.native || {})) {
    const p = (prev.native || {})[n];
    if (p === undefined) continue;
    if (String(p) !== String(v)) {
      const d = BigInt(v) - BigInt(p);
      const w = (CONFIG.nativeWatch || []).find(x => x.name === n);
      const min = BigInt((w && w.minDelta) || 0) * 1000000000000000000n;
      if (min > 0n && d < min && -d < min) continue;
      alerts.push(`[NATIVE SUP] ${n}: ${fmt(p, 18)} -> ${fmt(v, 18)} (${d > 0n ? '+' : ''}${fmt(d, 18)})`);
    }
  }

  // 7. 大额 USDT 转账（新 hash）
  const prevHashes = new Set((prev.largeTransfers || []).map(t => t.hash));
  for (const t of next.largeTransfers || []) {
    if (!prevHashes.has(t.hash)) {
      alerts.push(`[USDT TRANSFER] ${t.timestamp} ${fmt(t.value)} USDT ${t.from} -> ${t.to} ${t.hash}`);
    }
  }

  // 6. 新验证合约
  const prevContracts = new Set(prev.contracts || []);
  for (const c of next.contracts || []) {
    if (!prevContracts.has(c)) alerts.push(`[NEW CONTRACT] ${c}`);
  }

  // 7. 新池子
  for (const [id, p] of Object.entries(next.pools)) {
    if (!prev.pools[id]) {
      alerts.push(`[NEW POOL] ${p.t0}/${p.t1} ${id} price=${p.price} tvl=${p.tvl}`);
    }
  }

  // 8. 指定代币：总量 / 持有人 / owner / 池子
  for (const [sym, w] of Object.entries(next.watch || {})) {
    const p = (prev.watch || {})[sym];
    if (!p) {
      alerts.push(`[WATCH] ${sym} ${w.address} supply=${w.supply} holders=${w.holders} owner=${w.owner} pool=${w.pool ? w.pool.t0 + '/' + w.pool.t1 : 'none'}`);
      continue;
    }
    if (String(p.supply) !== String(w.supply)) alerts.push(`[WATCH SUPPLY] ${sym}: ${p.supply} -> ${w.supply}`);
    if (String(p.holders) !== String(w.holders)) alerts.push(`[WATCH HOLDERS] ${sym}: ${p.holders} -> ${w.holders}`);
    if (String(p.owner) !== String(w.owner)) alerts.push(`[WATCH OWNER] ${sym}: ${p.owner} -> ${w.owner}`);
    const pp = p.pool ? p.pool.id : 'none';
    const np = w.pool ? w.pool.id : 'none';
    if (String(pp) !== String(np)) alerts.push(`[WATCH POOL] ${sym}: ${pp} -> ${np}`);
  }

  return alerts;
}

function summary(s) {
  const sup = s.pools && Object.values(s.pools).find(p => p.t0 === 'SUP' && p.t1 === 'USDT');
  return [
    `blocks=${s.stats.blocks} addresses=${s.stats.addresses} txs=${s.stats.transactions}`,
    `USDT supply=${fmt(s.usdtSupply)} PB supply=${fmt(s.pbSupply, 18)} FEC supply=${fmt(s.fecSupply, 4)}`,
    `v3Bridge=${fmt(s.balances.v3Bridge)} USDT router=${fmt(s.balances.router)} USDT pbMinter=${fmt(s.balances.pbMinter)} USDT`,
    sup ? `SUP/USDT price=${sup.price} TVL=${sup.tvl} vol24=${sup.vol24}` : '',
    (s.staking || []).map(x => `${x.name}: supply=${fmt(x.supply, 18)} holder=${fmt(x.holderBal, 18)} SUP=${fmt(x.sup, 18)}`).join('\n  '),
    Object.entries(s.native || {}).map(([n, v]) => `${n}=${fmt(v, 18)} SUP`).join(' '),
    `watch: ${Object.entries(s.watch || {}).map(([k, w]) => `${k} supply=${w.supply} holders=${w.holders} owner=${w.owner} pool=${w.pool ? w.pool.t0 + '/' + w.pool.t1 : 'none'}`).join(' | ')}`,
    `tokens=${Object.keys(s.tokens).length} pools=${Object.keys(s.pools).length} verifiedContracts=${s.contracts.length}`
  ].filter(Boolean).join('\n  ');
}

async function runOnce() {
  const prev = loadState();
  const next = await snapshot();
  const alerts = diff(prev, next);

  log('========== SuperAI monitor ==========');
  log(summary(next));
  if (!prev) {
    log('[BASELINE] 首次运行，已建立基线（不会对新代币/余额报警）。');
    for (const t of next.largeTransfers || []) {
      log(`[BASELINE LARGE] ${t.timestamp} ${fmt(t.value)} USDT ${t.from} -> ${t.to} ${t.hash}`);
    }
  } else if (alerts.length === 0) {
    log('[OK] 无新代币、无新验证合约、无大额 USDT 变化、无新池子。');
  } else {
    for (const a of alerts) log(a);
  }
  if (prev) await notify(alerts);

  saveState(next);
  return alerts;
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const once = args.includes('--once');
  const intervalArg = args.find(a => a.startsWith('--interval='));
  const interval = intervalArg ? Number(intervalArg.split('=')[1]) : 0;

  if (once || !interval) {
    await runOnce();
    return;
  }

  log(`[START] interval=${interval}s`);
  // 先建立基线，再循环
  await runOnce();
  setInterval(async () => {
    try { await runOnce(); } catch (e) { log('[ERROR] ' + (e.message || e)); }
  }, interval * 1000);
}

main().catch(e => { log('[FATAL] ' + (e.stack || e.message || e)); process.exit(1); });
