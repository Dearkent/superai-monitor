#!/usr/bin/env node
'use strict';
/**
 * GPT/OpenAI 状态监控示例：
 * - 轮询 status.openai.com 的 summary.json
 * - 状态变化时 POST 到通知中心 /push/gpt
 *
 * 用法：
 *   HUB_URL=http://127.0.0.1:8898 PUSH_API_KEY=xxx node gpt-monitor.js --once
 *   HUB_URL=... node gpt-monitor.js --interval=300
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const HUB = process.env.HUB_URL || 'http://127.0.0.1:8898';
const KEY = process.env.PUSH_API_KEY || '';
const STATE = path.join(__dirname, 'gpt-state.json');

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, timeout: 20000 }, res => {
      let s = '';
      res.on('data', c => s += c);
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : require('http');
    const req = lib.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, timeout: 20000 }, res => {
      let s = '';
      res.on('data', c => s += c);
      res.on('end', () => resolve({ status: res.statusCode, body: s }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function check() {
  const d = await getJSON('https://status.openai.com/api/v2/summary.json');
  const status = d.status && d.status.indicator;
  const desc = d.status && d.status.description;
  const prev = (() => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { return null; } })();
  const cur = { status, desc, at: new Date().toISOString() };
  if (prev && prev.status !== status) {
    console.log('[GPT STATUS]', prev.status, '->', status);
    const body = `OpenAI 状态：${prev.status} -> ${status}\n${desc || ''}`;
    const payload = { title: 'GPT 状态变化', body, topic: 'gpt', url: '/', priority: 'high' };
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.PUSH_SUBSCRIPTION) {
      try {
        const webpush = require('web-push');
        webpush.setVapidDetails('mailto:admin@superai.local', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
        await webpush.sendNotification(JSON.parse(process.env.PUSH_SUBSCRIPTION), JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
        console.log('direct push sent');
      } catch (e) { console.error('direct push error', e.statusCode || '', e.message || e); }
    } else {
      const r = await post(`${HUB}/push/gpt`, payload, KEY ? { 'X-API-Key': KEY } : {});
      console.log('push', r.status, r.body);
    }
  } else {
    console.log('[GPT] status', status, desc || '');
  }
  fs.writeFileSync(STATE, JSON.stringify(cur, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  const intervalArg = args.find(a => a.startsWith('--interval='));
  const interval = intervalArg ? Number(intervalArg.split('=')[1]) : 0;
  if (args.includes('--once') || !interval) { await check(); return; }
  console.log('[GPT START] interval=' + interval);
  await check();
  setInterval(() => check().catch(e => console.error('ERR', e.message || e)), interval * 1000);
}
main().catch(e => { console.error('FATAL', e.message || e); process.exit(1); });
