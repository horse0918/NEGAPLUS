import { createServer } from 'node:http';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = new URL('./dist/', import.meta.url);
const stateFile = resolve(process.env.NEGA_STATE || 'subscriptions.json');
const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
const enabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
const webpush = enabled ? (await import('web-push')).default : null;
if (enabled) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
const subscriptions = new Map();
try {
  for (const [key, value] of JSON.parse(await readFile(stateFile, 'utf8'))) subscriptions.set(key, value);
} catch (error) { if (error.code !== 'ENOENT') throw error; }

let writes = Promise.resolve();
function persist() {
  const snapshot = JSON.stringify([...subscriptions]);
  const write = writes.then(async () => {
    await writeFile(stateFile + '.tmp', snapshot, {mode:0o600});
    await rename(stateFile + '.tmp', stateFile);
  });
  writes = write.catch(() => {});
  return write;
}
const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
const minuteOf = value => Number(value.slice(0,2)) * 60 + Number(value.slice(3));
function due(config, time) {
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone:config.zone, hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(time);
  const minute = Number(parts.find(part => part.type === 'hour').value) * 60 + Number(parts.find(part => part.type === 'minute').value);
  const elapsed = (minute - config.start + 1440) % 1440;
  return elapsed <= (config.end - config.start + 1440) % 1440 && elapsed % config.interval === 0;
}
async function deck() {
  return JSON.parse(await readFile(new URL('words.json',root),'utf8'));
}
async function send(subscription, word) {
  await webpush.sendNotification(subscription, word, {TTL:120, timeout:8000});
}
let running = false;
let lastMinute = -1;
if (enabled) setInterval(async () => {
  const now = new Date();
  const minute = Math.floor(now.getTime()/60000);
  if (running || minute === lastMinute) return;
  lastMinute = minute;
  running = true;
  try {
    const words = await deck();
    const jobs = [...subscriptions].filter(([,config]) => due(config,now));
    for (let i = 0; i < jobs.length; i += 12) {
      await Promise.all(jobs.slice(i,i+12).map(async ([token, config]) => {
        if (subscriptions.get(token) !== config) return;
        let word = words[Math.floor(Math.random()*words.length)].word;
        if (word === config.lastWord && words.length > 1) word = words.find(entry => entry.word !== word).word;
        try {
          await send(config.subscription,word);
          config.lastWord = word;
        } catch (error) {
          if ([404,410].includes(error.statusCode) && subscriptions.get(token) === config) subscriptions.delete(token);
          else console.error('Scheduled notification failed', error.statusCode ?? error.code ?? '');
        }
      }));
    }
    if (jobs.length) await persist();
  } catch (error) { console.error('Reminder cycle failed',error.code ?? error.name); }
  finally { running = false; }
}, 5000).unref();

function permitted(subscription) {
  try {
    const url = new URL(subscription.endpoint);
    const hosts = ['fcm.googleapis.com','updates.push.services.mozilla.com'];
    const apple = url.hostname === 'web.push.apple.com' || url.hostname.endsWith('.push.apple.com');
    return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      (apple || hosts.includes(url.hostname) || url.hostname.endsWith('.notify.windows.com')) &&
      /^[\w-]{87}$/.test(subscription.keys.p256dh) && /^[\w-]{22}$/.test(subscription.keys.auth);
  } catch { return false; }
}
const files = new Map([
  ['','text/html'],['index.html','text/html'],['style.css','text/css'],['app.js','text/javascript'],
  ['sw.js','text/javascript'],['manifest.webmanifest','application/manifest+json'],['words.json','application/json'],
  ['icon-192.png','image/png'],['icon-512.png','image/png']
]);
function json(res,status,value) {
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(value));
}
async function request(req,res) {
  const path = new URL(req.url,'http://localhost').pathname.slice(1);
  if ((req.method === 'GET' || req.method === 'HEAD') && files.has(path)) {
    const bytes = await readFile(new URL(path || 'index.html',root));
    res.writeHead(200,{'Content-Type':files.get(path),'Cache-Control':'no-cache'});
    res.end(req.method === 'HEAD' ? undefined : bytes);
    return;
  }
  if (!path.startsWith('api/')) return json(res,404,{error:'Not found'});
  if (!enabled) return json(res,503,{error:'Push is unavailable'});
  if (req.method === 'GET' && path === 'api/key') return json(res,200,{key:VAPID_PUBLIC_KEY});
  if (req.method !== 'POST' || !['api/save','api/test','api/stop'].includes(path)) return json(res,404,{error:'Not found'});
  if (req.headers['sec-fetch-site'] === 'cross-site' || !req.headers['content-type']?.startsWith('application/json')) return json(res,403,{error:'Forbidden'});
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 8192) return json(res,413,{error:'Request too large'});
  }
  let data;
  try { data = JSON.parse(body); } catch { return json(res,400,{error:'Invalid JSON'}); }
  if (!/^[a-f0-9-]{36}$/.test(data?.token)) return json(res,400,{error:'Invalid token'});
  if (path === 'api/stop') {
    const previous = subscriptions.get(data.token);
    subscriptions.delete(data.token);
    try { await persist(); } catch (error) {
      if (previous && !subscriptions.has(data.token)) subscriptions.set(data.token,previous);
      throw error;
    }
    return json(res,200,{ok:true});
  }
  if (!permitted(data.subscription)) return json(res,400,{error:'Invalid subscription'});
  if (path === 'api/test') {
    const endpoint = data.subscription.endpoint;
    const now = Date.now();
    for (const [key,time] of tests) if (now - time > 60000) tests.delete(key);
    if (tests.has(endpoint) || tests.size >= 100) return json(res,429,{error:'Try again shortly'});
    tests.set(endpoint,now);
    const words = await deck();
    await send(data.subscription,words[Math.floor(Math.random()*words.length)].word);
    return json(res,200,{ok:true});
  }
  if (!clock.test(data.start) || !clock.test(data.end) || !Number.isInteger(data.interval) ||
      data.interval < 1 || data.interval > 1440 || typeof data.zone !== 'string') return json(res,400,{error:'Invalid schedule'});
  try { new Intl.DateTimeFormat('en',{timeZone:data.zone}); } catch { return json(res,400,{error:'Invalid timezone'}); }
  const previous = subscriptions.get(data.token);
  if (!previous && subscriptions.size >= 500) return json(res,429,{error:'Subscription capacity reached'});
  const config = {start:minuteOf(data.start),end:minuteOf(data.end),interval:data.interval,zone:data.zone,subscription:data.subscription};
  subscriptions.set(data.token,config);
  try { await persist(); } catch (error) {
    if (subscriptions.get(data.token) === config) {
      if (previous) subscriptions.set(data.token,previous);
      else subscriptions.delete(data.token);
    }
    throw error;
  }
  json(res,200,{ok:true});
}
const tests = new Map();
createServer((req,res) => request(req,res).catch(error => {
  console.error('Request failed',error.statusCode ?? error.code ?? error.name);
  if (!res.headersSent) json(res,500,{error:'Server error'});
  else res.end();
})).listen(Number(process.env.PORT || 8787),process.env.HOST || '127.0.0.1');
