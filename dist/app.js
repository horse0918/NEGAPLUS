const byId = id => document.getElementById(id);
const form = byId('reminders');
const controls = ['flip','prev','shuffle','next'].map(byId);
let cards = [], index = 0, revealed = false;
const worker = navigator.serviceWorker?.register('./sw.js').catch(() => null);
function draw() {
  const card = cards[index];
  byId('word').textContent = card.word;
  byId('tag').textContent = card.tag;
  byId('count').textContent = (index + 1) + ' / ' + cards.length;
  byId('meaning').textContent = card.meaning;
  byId('example').textContent = card.example;
  byId('answer').hidden = !revealed;
  byId('flip').textContent = revealed ? '藏起解答' : '翻開卡片';
  byId('flip').setAttribute('aria-expanded', revealed);
}
function move(step) {
  index = (index + step + cards.length) % cards.length;
  revealed = false;
  draw();
}
controls.forEach(button => button.disabled = true);
byId('flip').onclick = () => { revealed = !revealed; draw(); };
byId('prev').onclick = () => move(-1);
byId('next').onclick = () => move(1);
byId('shuffle').onclick = () => {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  index = 0;
  revealed = false;
  draw();
};
fetch('./words.json', {cache:'no-cache'}).then(response => {
  if (!response.ok) throw Error();
  return response.json();
}).then(deck => {
  if (!Array.isArray(deck) || !deck.length) throw Error();
  cards = deck;
  controls.forEach(button => button.disabled = false);
  draw();
}).catch(() => byId('word').textContent = '目前無法載入單字庫');
const status = message => byId('status').textContent = message;
const storageKey = 'nega-reminder';
const local = JSON.parse(localStorage.getItem(storageKey) || '{}');
for (const key of ['start','end','interval']) if (local[key] != null) form.elements[key].value = local[key];
let publicKey;
async function api(path, data) {
  const response = await fetch('./api/' + path, data === undefined ? {} : {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)
  });
  if (!response.ok) throw Error('推播服務暫時無法使用。');
  return response.json();
}
if (local.enabled) status('每日提醒已啟用。');
api('key').then(result => { publicKey = result.key; }).catch(() => {
  status('此部署尚未連接定時推播服務。');
});
async function change(action) {
  const buttons = [...form.querySelectorAll('button')];
  buttons.forEach(button => button.disabled = true);
  try {
    if (!publicKey) throw Error('此部署尚未連接定時推播服務。');
    if (!worker || !('PushManager' in window)) throw Error('請先將 NEGA+ 加入 iPhone 主畫面，再從圖示開啟。');
    if (action !== 'stop' && await Notification.requestPermission() !== 'granted') throw Error('請允許 NEGA+ 發送通知。');
    if (!await worker) throw Error('無法啟動通知服務。');
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    const token = local.token || crypto.randomUUID();
    if (action !== 'stop' && !subscription) {
      const key = publicKey.replace(/-/g,'+').replace(/_/g,'/');
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly:true, applicationServerKey:Uint8Array.from(atob(key.padEnd(Math.ceil(key.length / 4) * 4,'=')), c => c.charCodeAt(0))
      });
    }
    if (action === 'stop') {
      if (local.token) await api('stop',{token});
      if (subscription) await subscription.unsubscribe();
      local.enabled = false;
      status('提醒已關閉。');
    } else if (action === 'test') {
      await api('test',{token,subscription});
      status('已發送測試通知。');
    } else {
      const config = Object.fromEntries(new FormData(form));
      config.interval = Number(config.interval);
      await api('save',{token,subscription,...config,zone:Intl.DateTimeFormat().resolvedOptions().timeZone});
      Object.assign(local,config,{enabled:true});
      status('每日提醒已啟用。');
    }
    local.token = token;
    localStorage.setItem(storageKey,JSON.stringify(local));
  } catch (error) { status(error.message); }
  finally { buttons.forEach(button => button.disabled = false); }
}
form.onsubmit = event => { event.preventDefault(); change('save'); };
byId('test').onclick = () => change('test');
byId('stop').onclick = () => change('stop');
