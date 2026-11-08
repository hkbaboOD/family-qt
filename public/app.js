// 우리 가족 큐티 — Firebase(아이디·비밀번호 로그인 + Firestore) 버전
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, setDoc, getDoc, deleteDoc, onSnapshot, query, orderBy, limit } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

let fbApp = null, auth = null, fdb = null;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const str = (v, max) => typeof v === 'string' ? v.slice(0, max || 4000) : '';
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
const parse = s => { const p = s.split('-').map(Number); return new Date(p[0], p[1]-1, p[2]); };
const todayStr = () => ymd(new Date());
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate()+n); return ymd(d); };
const WD = ['일','월','화','수','목','금','토'];
const fmtDate = s => { const d = parse(s); return (d.getMonth()+1) + '월 ' + d.getDate() + '일 (' + WD[d.getDay()] + ')'; };
const fmtShort = s => { const d = parse(s); return d.getFullYear() + '. ' + (d.getMonth()+1) + '. ' + d.getDate() + '.'; };
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const timeStr = t => { if (typeof t !== 'number') return ''; const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const seg = s => String(s).replace(/[^A-Za-z0-9_\-.~:@+]/g, '_');
const COLORS = ['#2F6DB5','#C2553D','#3E8E6A','#8A5BB8','#B8801A','#2A8C9C'];
const FIELDS = ['passage','observe','insight','apply','prayer','verseRef','verseText'];
const MAX = {passage:120, verseRef:60, verseText:1000};
const LS_KEY = 'family-qt-local-v1';
const draftKey = d => 'family-qt-draft-' + d;

const S = {
  mode:'loading', db:null, user:null, uid:null, canWrite:true, timer:0,
  entries:new Map(), priv:new Map(), plans:new Map(), reactions:new Map(), members:new Map(), prayers:new Map(), pprayers:new Map(),
  prTab:'active', prWho:'all', editPrayer:null, answering:null, confirmPr:null,
  fid:null, family:null, fbUser:null, unsubs:[], confirmLeave:false,
  date: todayStr(), view:'today', calMonth: todayStr().slice(0,7),
  cardFilter:'all', recite:false, open:new Set(), editingPlan:false, planOpen:false, notes:null, bgClosed:new Set(),
  dirty:false, formKey:'', confirmDel:false, pickColor:null, raf:0
};

/* ---------- storage helpers ---------- */
function lsGet(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
function lsSet(k,v){ try { localStorage.setItem(k,v); } catch(e){} }
function lsDel(k){ try { localStorage.removeItem(k); } catch(e){} }
const COLS = ['entries','priv','plans','reactions','members','prayers','pprayers'];
function loadLocal(){
  try { const o = JSON.parse(lsGet(LS_KEY) || '{}'); COLS.forEach(k => { S[k] = new Map(Object.entries(o[k] || {})); }); } catch(e){}
}
function persistLocal(){ const o = {}; COLS.forEach(k => { o[k] = Object.fromEntries(S[k]); }); lsSet(LS_KEY, JSON.stringify(o)); }

function ref(col, id){
  if (col === 'priv') return doc(fdb, 'users', S.uid, 'entries', id);
  if (col === 'pprayers') return doc(fdb, 'users', S.uid, 'prayers', id);
  return doc(fdb, 'families', S.fid, col, id);
}
async function attempt(fn, retried){
  try { await fn(); return true; }
  catch(e){
    const code = e && e.code;
    if (code === 'unavailable' && !retried){ await new Promise(r => setTimeout(r, 500 + Math.random()*700)); return attempt(fn, true); }
    if (code === 'permission-denied') toast('권한이 없어요. 가족에 참여한 계정인지 확인해 주세요.');
    else if (code === 'resource-exhausted') toast('오늘 사용량을 넘었어요. 내일 다시 시도해 주세요.');
    else toast('저장하지 못했어요. 연결을 확인한 뒤 다시 눌러 주세요.');
    return false;
  }
}
async function put(col, id, data){
  if (!fdb || !S.fid || !S.uid){ toast('아직 연결 중이에요. 잠시 후 다시 눌러 주세요.'); return false; }
  return attempt(() => setDoc(ref(col, id), data));
}
async function del(col, id){
  if (!fdb || !S.fid || !S.uid) return false;
  return attempt(() => deleteDoc(ref(col, id)));
}

/* ---------- selectors ---------- */
const sharedId = date => date + '_' + seg(S.uid);
function myShared(date){ return S.uid ? S.entries.get(sharedId(date)) : null; }
function myPriv(date){ return S.priv.get(date) || null; }
function myEntry(date){
  const s = myShared(date); if (s) return {d:s, shared:true};
  const p = myPriv(date); if (p) return {d:p, shared:false};
  return null;
}
function sharedList(){ return [...S.entries.entries()].filter(([, e]) => e && isDate(e.date) && typeof e.uid === 'string'); }
function privList(){ return [...S.priv.entries()].filter(([id, e]) => isDate(id) && e && typeof e === 'object').map(([id, e]) => ['p:' + id, Object.assign({}, e, {date:id, uid:S.uid, _priv:true})]); }
function myDates(){
  const set = new Set();
  sharedList().forEach(([, e]) => { if (e.uid === S.uid) set.add(e.date); });
  privList().forEach(([, e]) => set.add(e.date));
  return set;
}
function streak(){
  const set = myDates(); let d = todayStr(); if (!set.has(d)) d = addDays(d, -1);
  let n = 0; while (set.has(d)){ n++; d = addDays(d, -1); } return n;
}
function member(uid){ const m = S.members.get(seg(uid)); return m && typeof m === 'object' ? m : {}; }
function nameOf(uid){
  const m = member(uid);
  const nick = str(m.nick, 12).trim(); if (nick) return nick;
  const name = str(m.name, 30).trim(); if (name) return name;
  return uid === S.uid ? '나' : '가족';
}
function colorIdx(uid){
  const c = member(uid).color; if (Number.isInteger(c) && c >= 0 && c < COLORS.length) return c;
  let h = 0; for (const ch of String(uid)) h = (h*31 + ch.charCodeAt(0)) >>> 0; return h % COLORS.length;
}
const colorOf = uid => COLORS[colorIdx(uid)];
function allUids(){
  const set = new Set(); if (S.uid) set.add(S.uid);
  sharedList().forEach(([, e]) => set.add(e.uid));
  S.members.forEach(m => { if (m && typeof m.uid === 'string') set.add(m.uid); });
  S.reactions.forEach(r => { if (r && typeof r.uid === 'string') set.add(r.uid); });
  S.prayers.forEach(r => { if (r && typeof r.uid === 'string') set.add(r.uid); });
  return [...set];
}
function resolveNames(){}

/* ---------- ui helpers ---------- */
function setHTML(el, html){ if (el._h !== html){ el._h = html; el.innerHTML = html; return true; } return false; }
let toastT = 0;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2800); }
function status(msg, kind){ const el = $('#status'); el.textContent = msg || ''; el.hidden = !msg; el.className = 'status' + (kind === 'warn' ? ' warn' : ''); }
function schedule(){ if (!S.raf) S.raf = requestAnimationFrame(() => { S.raf = 0; renderAll(); }); }
function autosize(el){ if (CSS.supports && CSS.supports('field-sizing','content')) return; el.style.height = 'auto'; el.style.height = Math.max(el.scrollHeight + 2, 60) + 'px'; }
function setSaveState(t){ $('#saveState').textContent = t; }

function gate(){
  const ro = !S.canWrite;
  $('#roNote').hidden = !ro;
  document.querySelectorAll('#qtForm input, #qtForm textarea, #qtForm button, #prForm input, #prForm textarea, #prForm button, #nick, #nickSave, .sw').forEach(el => { el.disabled = ro; });
}

/* ---------- my entry form ---------- */
function formKeyFor(date){ const m = myEntry(date); return date + '|' + (m ? (m.shared ? 's' : 'p') + (m.d.updatedAt || 0) : 'none'); }
function readForm(){ const v = {}; FIELDS.forEach(f => { v[f] = $('#f-' + f).value.trim().slice(0, MAX[f] || 4000); }); return v; }
function loadFormFor(date){
  const m = myEntry(date);
  let draft = null; try { draft = JSON.parse(lsGet(draftKey(date)) || 'null'); } catch(e){}
  let src = m ? m.d : null, note = '';
  if (draft && draft.v && (!src || (draft.t || 0) > (src.updatedAt || 0))){ src = draft.v; note = '저장하지 않은 작성 내용을 불러왔어요.'; S.dirty = true; }
  else { S.dirty = false; if (draft) lsDel(draftKey(date)); }
  FIELDS.forEach(f => { $('#f-' + f).value = src ? str(src[f], MAX[f]) : ''; });
  const plan = S.plans.get(date);
  if (!$('#f-passage').value && plan) $('#f-passage').value = str(plan.passage, 120);
  $('#f-share').checked = m ? m.shared : !(draft && draft.v && draft.v.share === false);
  S.formKey = formKeyFor(date); S.confirmDel = false;
  $('#delBtn').hidden = !m; $('#delBtn').textContent = '삭제';
  setSaveState(note || (m ? (m.shared ? '가족과 나눔' : '나만 보기') + ' · ' + timeStr(m.d.updatedAt) + ' 저장' : '아직 작성하지 않았어요'));
  document.querySelectorAll('#qtForm textarea').forEach(autosize);
}
function syncForm(){
  if (S.dirty) return;
  if (formKeyFor(S.date) !== S.formKey) { loadFormFor(S.date); return; }
  const plan = S.plans.get(S.date);
  if (plan && !$('#f-passage').value) $('#f-passage').value = str(plan.passage, 120);
}
let draftT = 0;
function flushDraft(){
  clearTimeout(draftT); draftT = 0;
  if (!S.dirty) return;
  const v = readForm(); v.share = $('#f-share').checked;
  lsSet(draftKey(S.date), JSON.stringify({t:Date.now(), v}));
}
function onFormInput(e){
  if (e.target.tagName === 'TEXTAREA') autosize(e.target);
  S.dirty = true; setSaveState('작성 중 · 저장을 눌러야 가족에게 보여요');
  clearTimeout(draftT); draftT = setTimeout(flushDraft, 600);
}
async function save(e){
  if (e) e.preventDefault();
  if (!S.canWrite || !S.uid) return;
  const v = readForm();
  if (!['observe','insight','apply','prayer','verseText'].some(f => v[f])){ toast('관찰·묵상·적용·기도 중 하나는 적어 주세요.'); return; }
  const share = $('#f-share').checked, date = S.date, prev = myEntry(date), now = Date.now();
  const data = Object.assign({}, v, {date, uid:S.uid, createdAt: prev ? (prev.d.createdAt || now) : now, updatedAt: now});
  const btn = $('#saveBtn'); btn.disabled = true; btn.textContent = '저장 중…';
  let ok;
  if (share){ ok = await put('entries', sharedId(date), data); if (ok && myPriv(date)) await del('priv', date); }
  else { ok = await put('priv', date, data); if (ok && myShared(date)) await del('entries', sharedId(date)); }
  btn.disabled = !S.canWrite; btn.textContent = '저장';
  if (ok){
    clearTimeout(draftT); lsDel(draftKey(date)); S.dirty = false; S.formKey = '';
    toast(share ? '가족과 나눴어요.' : '나만 보기로 저장했어요.');
    schedule();
  }
}
async function removeMine(){
  if (!S.confirmDel){
    S.confirmDel = true; $('#delBtn').textContent = '한 번 더 누르면 삭제';
    setTimeout(() => { S.confirmDel = false; $('#delBtn').textContent = '삭제'; }, 4000);
    return;
  }
  const date = S.date;
  if (myShared(date)) await del('entries', sharedId(date));
  if (myPriv(date)) await del('priv', date);
  lsDel(draftKey(date)); S.dirty = false; S.formKey = ''; toast('삭제했어요.'); schedule();
}

/* ---------- plan card ---------- */
function renderPlan(){
  const el = $('#planCard');
  const p = S.plans.get(S.date);
  const label = S.date === todayStr() ? '오늘 함께 읽을 본문' : fmtDate(S.date) + ' 함께 읽을 본문';
  if (S.editingPlan){
    if (el.dataset.mode === 'edit') return;
    el.dataset.mode = 'edit'; el._h = null;
    el.innerHTML = '<p class="eyebrow">' + esc(label) + '</p>' +
      '<form id="planForm"><div><label class="lbl" for="p-passage">본문 범위</label><input type="text" id="p-passage" maxlength="120" placeholder="예: 요한복음 15:1–8"></div>' +
      '<div><label class="lbl" for="p-title">제목 (선택)</label><input type="text" id="p-title" maxlength="120" placeholder="예: 참포도나무 되신 예수님"></div>' +
      '<div><label class="lbl" for="p-text">본문 내용 (선택)</label><textarea id="p-text" maxlength="20000" placeholder="성경이나 큐티책 본문을 붙여 넣으면 가족 모두 같이 볼 수 있어요"></textarea></div>' +
      '<div class="row"><button type="submit" class="btn">가족 본문으로 저장</button><button type="button" class="btn line" data-act="cancelPlan">취소</button></div></form>';
    if (p){ $('#p-passage').value = str(p.passage, 120); $('#p-title').value = str(p.title, 120); $('#p-text').value = str(p.text, 20000); }
    autosize($('#p-text'));
    $('#p-passage').focus();
    return;
  }
  el.dataset.mode = 'view';
  let html;
  const SUM = 'https://sum.su.or.kr:8888/bible/today';
  const linkUrl = p && typeof p.link === 'string' && p.link.indexOf('https://sum.su.or.kr') === 0 ? p.link : (S.date === todayStr() ? SUM : '');
  const sumLink = linkUrl ? '<a class="ext" href="' + esc(linkUrl) + '" target="_blank" rel="noopener">매일성경에서 본문·해설 읽기 ↗</a>' : '';
  if (!p || !str(p.passage)){
    html = '<p class="eyebrow">' + esc(label) + '</p><p class="plan-empty">가족이 함께 묵상할 본문이 아직 정해지지 않았어요.</p>' +
      '<div class="row">' + (S.canWrite ? '<button type="button" class="btn ghost" data-act="editPlan">본문 정하기</button>' : '') + sumLink + '</div>';
  } else if (p.source === '매일성경'){
    html = '<div class="plan-head"><p class="eyebrow">' + esc(label) + '</p>' + (S.canWrite ? '<button type="button" class="link" data-act="editPlan">수정</button>' : '') + '</div>' +
      '<h2 class="plan-ref">' + esc(str(p.passage, 120)) + '</h2>' +
      (str(p.title) ? '<p class="plan-title">' + esc(str(p.title, 120)) + '</p>' : '') +
      (str(p.text) ? '<details class="plan-text" id="planDetails"' + (S.planOpen ? ' open' : '') + '><summary>본문 펼치기</summary><p>' + esc(str(p.text, 20000)) + '</p></details>' : '') +
      '<div class="row" style="justify-content:space-between;margin-top:6px"><span class="src">성서유니온 매일성경</span>' + sumLink + '</div>';
  } else {
    html = '<div class="plan-head"><p class="eyebrow">' + esc(label) + '</p>' + (S.canWrite ? '<button type="button" class="link" data-act="editPlan">수정</button>' : '') + '</div>' +
      '<h2 class="plan-ref">' + esc(str(p.passage, 120)) + '</h2>' +
      (str(p.title) ? '<p class="plan-title">' + esc(str(p.title, 120)) + '</p>' : '') +
      (str(p.text) ? '<details class="plan-text" id="planDetails"' + (S.planOpen ? ' open' : '') + '><summary>본문 펼치기</summary><p>' + esc(str(p.text, 20000)) + '</p></details>' : '') +
      (typeof p.uid === 'string' ? '<p class="meta" style="margin:6px 0 0">정한 사람 · <span class="dot" style="background:' + colorOf(p.uid) + '"></span>' + esc(nameOf(p.uid)) + '</p>' : '') +
      (sumLink ? '<div style="margin-top:8px">' + sumLink + '</div>' : '');
  }
  if (p && str(p.passage)) html += studyHTML(str(p.passage, 120));
  setHTML(el, html);
}

/* ---------- bible link & background notes ---------- */
const BOOKS = [
  ['gen','창세기','창'],['exo','출애굽기','출'],['lev','레위기','레'],['num','민수기','민'],['deu','신명기','신'],
  ['jos','여호수아','수'],['jdg','사사기','삿'],['rut','룻기','룻'],['1sa','사무엘상','삼상'],['2sa','사무엘하','삼하'],
  ['1ki','열왕기상','왕상'],['2ki','열왕기하','왕하'],['1ch','역대상','대상'],['2ch','역대하','대하'],['ezr','에스라','스'],
  ['neh','느헤미야','느'],['est','에스더','에'],['job','욥기','욥'],['psa','시편','시'],['pro','잠언','잠'],
  ['ecc','전도서','전'],['sng','아가','아'],['isa','이사야','사'],['jer','예레미야','렘'],['lam','예레미야애가','애'],
  ['ezk','에스겔','겔'],['dan','다니엘','단'],['hos','호세아','호'],['jol','요엘','욜'],['amo','아모스','암'],
  ['oba','오바댜','옵'],['jnh','요나','욘'],['mic','미가','미'],['nam','나훔','나'],['hab','하박국','합'],
  ['zep','스바냐','습'],['hag','학개','학'],['zec','스가랴','슥'],['mal','말라기','말'],
  ['mat','마태복음','마'],['mrk','마가복음','막'],['luk','누가복음','눅'],['jhn','요한복음','요'],['act','사도행전','행'],
  ['rom','로마서','롬'],['1co','고린도전서','고전'],['2co','고린도후서','고후'],['gal','갈라디아서','갈'],['eph','에베소서','엡'],
  ['php','빌립보서','빌'],['col','골로새서','골'],['1th','데살로니가전서','살전'],['2th','데살로니가후서','살후'],['1ti','디모데전서','딤전'],
  ['2ti','디모데후서','딤후'],['tit','디도서','딛'],['phm','빌레몬서','몬'],['heb','히브리서','히'],['jas','야고보서','약'],
  ['1pe','베드로전서','벧전'],['2pe','베드로후서','벧후'],['1jn','요한일서','요일'],['2jn','요한이서','요이'],['3jn','요한삼서','요삼'],
  ['jud','유다서','유'],['rev','요한계시록','계']
];
const BOOK_KEYS = BOOKS.flatMap(([c, full, ab]) => [[full, c, full], [ab, c, full]]).sort((a, b) => b[0].length - a[0].length);
function parsePassage(ref){
  const s = String(ref || '').replace(/\s+/g, ' ').trim()
    .replace(/(\d+)\s*(?:장|편)\s*(\d+)/g, '$1:$2').replace(/(\d)\s*(?:장|편|절)/g, '$1');
  const hit = BOOK_KEYS.find(([k]) => s.startsWith(k) && /^서?\s*\d/.test(s.slice(k.length)));
  if (!hit) return null;
  const m = s.slice(hit[0].length).replace(/^서/, '').match(/^\s*(\d+)(?::(\d+))?(?:\s*[-–~]\s*(?:(\d+):)?(\d+))?/);
  if (!m) return null;
  const ch = Number(m[1]); let endCh = m[3] ? Number(m[3]) : ch;
  let sv = 0, ev = 0;                       // 0 = whole chapter
  if (m[2]){ sv = Number(m[2]); ev = m[4] ? Number(m[4]) : sv; }
  else if (m[4]) endCh = Number(m[4]);
  if (endCh < ch || endCh - ch > 5){ endCh = ch; if (m[3]) ev = 0; }
  if (endCh === ch && sv && ev < sv) ev = sv;
  return {code:hit[1], name:hit[2], ch, endCh, sv, ev};
}

/* ---------- 개역한글 본문 (1961, 저작권 만료 · 퍼블릭 도메인) ---------- */
const BIBLE = {}, BIBLE_LOADING = {};
async function loadBook(code){
  if (BIBLE[code] || BIBLE_LOADING[code]) return;
  BIBLE_LOADING[code] = true;
  try {
    const r = await fetch('bible/' + code + '.json');
    if (r.ok){ BIBLE[code] = await r.json(); $('#planCard')._h = null; schedule(); }
    else BIBLE[code] = {error:true};
  } catch(e){ BIBLE_LOADING[code] = false; BIBLE[code] = {error:true, retry:true}; }
}
function verseHTML(ref){
  const b = BIBLE[ref.code];
  const id = 'txt-' + ref.code + '-' + ref.ch + '-' + ref.sv + '-' + ref.endCh + '-' + ref.ev;
  const open = S.bgClosed.has(id) ? '' : ' open';
  const head = '<summary><span class="bg-tag txt">개역한글</span>본문 읽기</summary>';
  if (!b){ loadBook(ref.code); return '<details class="bv-box" id="' + id + '"' + open + '>' + head + '<p class="bv-wait">본문 불러오는 중…</p></details>'; }
  if (b.error || !Array.isArray(b.chapters)) return '';
  let body = '', partial = false;
  for (let c = ref.ch; c <= ref.endCh; c++){
    const vs = b.chapters[c - 1]; if (!Array.isArray(vs)) continue;
    // 대한성서공회 화면처럼 장 전체를 보여 주고, 오늘 범위는 강조
    let from = 1, to = vs.length;
    if (ref.sv){ if (c === ref.ch) from = ref.sv; if (c === ref.endCh && ref.ev) to = Math.min(ref.ev, vs.length); }
    body += '<h4 class="bv-ch">' + esc(b.name || ref.name) + ' ' + c + '장</h4>';
    if (ref.sv && (from > 1 || to < vs.length)) partial = true;
    for (let v = 1; v <= vs.length; v++) body += '<p class="bv' + (ref.sv && v >= from && v <= to ? ' on' : '') + '"><sup>' + v + '</sup>' + esc(str(vs[v - 1], 2000)) + '</p>';
  }
  if (!body) return '';
  if (!partial) body = body.split('<p class="bv on">').join('<p class="bv">');
  return '<details class="bv-box" id="' + id + '"' + open + '>' + head + '<div class="bv-list">' + body + '</div><p class="src" style="margin:10px 0 0">개역한글판(1961) · 저작권 만료 본문</p></details>';
}

function studyHTML(passage){
  const ref = parsePassage(passage); if (!ref) return '';
  let html = verseHTML(ref) + '<div class="study-links"><a class="ext" href="https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE&amp;book=' + ref.code + '&amp;chap=' + ref.ch + '" target="_blank" rel="noopener">' + esc(ref.name + ' ' + ref.ch + '장') + ' 개역개정으로 읽기 · 대한성서공회 ↗</a></div>';
  for (let c = ref.ch; c <= ref.endCh; c++){
    const n = S.notes && S.notes[ref.code + '-' + c];
    if (!n || typeof n !== 'object') continue;
    const id = 'bg-' + ref.code + '-' + c;
    const open = S.bgClosed && S.bgClosed.has(id) ? '' : ' open';
    html += '<details class="bg-note" id="' + id + '"' + open + '><summary><span class="bg-tag">시대배경·역사</span>' + esc(str(n.title, 120)) + '</summary>' +
      (str(n.era) ? '<p class="bg-era">' + esc(str(n.era, 300)) + '</p>' : '') +
      (str(n.background) ? '<p class="bg-body">' + esc(str(n.background, 3000)) + '</p>' : '') +
      (Array.isArray(n.facts) && n.facts.length ? '<h4 class="bg-h">역사적 사실</h4><ul class="bg-facts">' + n.facts.map(f => '<li>' + esc(str(f, 800)) + '</li>').join('') + '</ul>' : '') +
      ((Array.isArray(n.places) && n.places.length) || (Array.isArray(n.people) && n.people.length) ?
        '<div class="bg-chips">' + (n.places || []).map(x => '<span class="bg-chip place">' + esc(str(x, 60)) + '</span>').join('') + (n.people || []).map(x => '<span class="bg-chip person">' + esc(str(x, 60)) + '</span>').join('') + '</div>' : '') +
      '</details>';
  }
  return html;
}
async function loadNotes(){
  try { const r = await fetch('notes.json', {cache:'no-cache'}); if (r.ok){ S.notes = await r.json(); $('#planCard')._h = null; schedule(); } } catch(e){}
}
async function savePlan(e){
  e.preventDefault();
  const passage = $('#p-passage').value.trim(), title = $('#p-title').value.trim(), text = $('#p-text').value.trim();
  const date = S.date;
  let ok;
  if (!passage && !text){ ok = await del('plans', date); }
  else if (!passage){ toast('본문 범위를 적어 주세요.'); return; }
  else ok = await put('plans', date, {date, passage:passage.slice(0,120), title:title.slice(0,120), text:text.slice(0,20000), uid:S.uid, updatedAt:Date.now()});
  if (ok){
    S.editingPlan = false;
    if (!S.dirty && !$('#f-passage').value) $('#f-passage').value = passage;
    toast('가족 본문을 정했어요.'); schedule();
  }
}

/* ---------- family sharing ---------- */
function entryCard(id, e){
  const uid = e.uid, me = uid === S.uid;
  const reacts = [...S.reactions.entries()].filter(([, r]) => r && r.entryId === id && typeof r.uid === 'string');
  const amens = reacts.filter(([, r]) => r.type === 'amen');
  const iAmen = amens.some(([, r]) => r.uid === S.uid);
  const cmts = reacts.filter(([, r]) => r.type === 'comment' && str(r.text)).sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
  const sec = (k, label) => str(e[k]) ? '<div class="sec"><h4>' + label + '</h4><p>' + esc(str(e[k])) + '</p></div>' : '';
  const name = nameOf(uid);
  return '<article class="card entry" style="--who:' + colorOf(uid) + '">' +
    '<header class="entry-head"><span class="avatar" aria-hidden="true">' + esc(Array.from(name)[0] || '·') + '</span><div><strong>' + esc(name) + (me ? ' <span class="me">나</span>' : '') + '</strong>' +
    '<span class="meta">' + (esc(str(e.passage, 120)) || '본문 미기재') + (timeStr(e.updatedAt) ? ' · ' + timeStr(e.updatedAt) : '') + '</span></div></header>' +
    sec('observe','관찰') + sec('insight','묵상') + sec('apply','적용') + sec('prayer','기도') +
    ((str(e.verseText) || str(e.verseRef)) ? '<blockquote class="verse">' + (str(e.verseText) ? '<p>' + esc(str(e.verseText, 1000)) + '</p>' : '') + '<cite>' + esc(str(e.verseRef, 60)) + '</cite></blockquote>' : '') +
    '<footer class="entry-foot"><button type="button" class="amen' + (iAmen ? ' on' : '') + '" data-act="amen" data-id="' + esc(id) + '" aria-pressed="' + iAmen + '"' + (S.canWrite ? '' : ' disabled') + '>아멘 <b>' + (amens.length || '') + '</b></button>' +
    (amens.length ? '<span class="amen-who">' + amens.map(([, r]) => esc(nameOf(r.uid))).join(', ') + '</span>' : '') + '</footer>' +
    commentsHTML(id, reacts, '격려 한마디 남기기') + '</article>';
}
function commentsHTML(id, reacts, ph){
  const cmts = reacts.filter(([, r]) => r.type === 'comment' && str(r.text)).sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
  return '<div class="comments">' + cmts.map(([rid, r]) => '<p class="cmt"><span class="dot" style="background:' + colorOf(r.uid) + '"></span><b>' + esc(nameOf(r.uid)) + '</b> ' + esc(str(r.text, 300)) +
      (r.uid === S.uid && S.canWrite ? '<button type="button" class="x" data-act="delCmt" data-id="' + esc(rid) + '" aria-label="댓글 삭제">×</button>' : '') + '</p>').join('') +
    (S.canWrite ? '<form class="cmt-form" data-id="' + esc(id) + '"><input type="text" id="c-' + esc(id) + '" data-cmt="' + esc(id) + '" maxlength="300" placeholder="' + esc(ph) + '" aria-label="댓글"><button type="submit" class="btn small">남기기</button></form>' : '') +
    '</div>';
}
function keepInputs(el, fn){
  const kept = {}; let focus = null;
  el.querySelectorAll('input[data-cmt], input[data-keep]').forEach(i => { const k = i.dataset.cmt || i.dataset.keep; if (i.value) kept[k] = i.value; if (document.activeElement === i) focus = k; });
  if (fn()) el.querySelectorAll('input[data-cmt], input[data-keep]').forEach(i => { const k = i.dataset.cmt || i.dataset.keep; if (kept[k]) i.value = kept[k]; if (focus === k) i.focus(); });
}

/* ---------- prayer requests ---------- */
const daysBetween = (a, b) => Math.max(0, Math.round((parse(b) - parse(a)) / 86400000));
function prayerList(){
  const a = [...S.prayers.entries()].filter(([, p]) => p && typeof p.uid === 'string' && str(p.text)).map(([id, p]) => ({id, p, shared:true}));
  const b = [...S.pprayers.entries()].filter(([, p]) => p && str(p.text)).map(([id, p]) => ({id, p:Object.assign({}, p, {uid:S.uid}), shared:false}));
  return a.concat(b);
}
const findPrayer = id => prayerList().find(x => x.id === id);
const writtenOn = p => isDate(p.writtenOn) ? p.writtenOn : (typeof p.createdAt === 'number' ? ymd(new Date(p.createdAt)) : todayStr());
function prayerCard(x){
  const id = x.id, p = x.p, me = p.uid === S.uid, name = nameOf(p.uid), on = writtenOn(p);
  const ansOn = p.answered && isDate(p.answeredOn) ? p.answeredOn : null;
  const days = daysBetween(on, ansOn || todayStr()) + 1;
  const reacts = x.shared ? [...S.reactions.entries()].filter(([, r]) => r && r.entryId === id && typeof r.uid === 'string') : [];
  const prays = reacts.filter(([, r]) => r.type === 'pray'), iPray = prays.some(([, r]) => r.uid === S.uid);
  let html = '<article class="card prayer' + (p.answered ? ' done' : '') + '" style="--who:' + colorOf(p.uid) + '">' +
    '<header class="entry-head"><span class="avatar" aria-hidden="true">' + esc(Array.from(name)[0] || '·') + '</span><div><strong>' + esc(name) + (me ? ' <span class="me">나</span>' : '') + (x.shared ? '' : ' <span class="lock">나만 보기</span>') + '</strong>' +
    '<span class="meta"><time datetime="' + on + '">' + fmtShort(on) + ' 적음</time>' + (ansOn ? '' : ' · ' + days + '일째 기도 중') + '</span></div></header>' +
    '<p class="pr-text">' + esc(str(p.text, 500)) + '</p>';
  if (ansOn) html += '<div class="answer"><b>' + fmtShort(ansOn) + ' 응답 · ' + days + '일 만에</b>' + (str(p.answerNote) ? '<p>' + esc(str(p.answerNote, 300)) + '</p>' : '') + '</div>';
  if (me && S.answering === id){
    html += '<div class="ans-form"><label class="lbl" for="ans-' + esc(id) + '">어떻게 응답하셨나요? (선택)</label><input type="text" id="ans-' + esc(id) + '" data-keep="ans-' + esc(id) + '" maxlength="300" placeholder="예: 검사 결과가 좋게 나왔어요">' +
      '<div class="row"><button type="button" class="btn small" data-act="ansSave" data-id="' + esc(id) + '">오늘 날짜로 응답 기록</button><button type="button" class="btn line small" data-act="ansCancel">취소</button></div></div>';
  }
  html += '<footer class="entry-foot">';
  if (x.shared) html += '<button type="button" class="amen' + (iPray ? ' on' : '') + '" data-act="pray" data-id="' + esc(id) + '" aria-pressed="' + iPray + '"' + (S.canWrite ? '' : ' disabled') + '>함께 기도해요 <b>' + (prays.length || '') + '</b></button>' +
    (prays.length ? '<span class="amen-who">' + prays.map(([, r]) => esc(nameOf(r.uid))).join(', ') + '</span>' : '');
  if (me && S.canWrite){
    html += '<span class="pr-acts">' +
      (p.answered ? '<button type="button" class="link" data-act="unanswer" data-id="' + esc(id) + '">기도 중으로</button>' : (S.answering === id ? '' : '<button type="button" class="link" data-act="answer" data-id="' + esc(id) + '">응답받았어요</button>')) +
      '<button type="button" class="link" data-act="editPr" data-id="' + esc(id) + '">수정</button>' +
      '<button type="button" class="link danger" data-act="delPr" data-id="' + esc(id) + '">' + (S.confirmPr === id ? '한 번 더 누르면 삭제' : '삭제') + '</button></span>';
  }
  html += '</footer>';
  if (x.shared) html += commentsHTML(id, reacts, '응원 한마디 남기기');
  return html + '</article>';
}
function renderPray(){
  const all = prayerList();
  const active = all.filter(x => !x.p.answered), done = all.filter(x => x.p.answered);
  const uids = [...new Set(all.map(x => x.p.uid))];
  if (S.prWho !== 'all' && !uids.includes(S.prWho)) S.prWho = 'all';
  setHTML($('#prFilters'),
    '<div class="seg" role="group" aria-label="기도제목 상태"><button type="button" class="chip" data-act="prTab" data-v="active" aria-pressed="' + (S.prTab === 'active') + '">기도 중 ' + active.length + '</button>' +
    '<button type="button" class="chip" data-act="prTab" data-v="done" aria-pressed="' + (S.prTab === 'done') + '">응답받음 ' + done.length + '</button></div>' +
    (uids.length > 1 ? '<div class="chips"><button type="button" class="chip" data-act="prWho" data-uid="all" aria-pressed="' + (S.prWho === 'all') + '">모두</button>' +
      uids.map(u => '<button type="button" class="chip" data-act="prWho" data-uid="' + esc(u) + '" aria-pressed="' + (S.prWho === u) + '"><span class="dot" style="background:' + colorOf(u) + '"></span>' + esc(nameOf(u)) + '</button>').join('') + '</div>' : ''));
  let list = (S.prTab === 'done' ? done : active).filter(x => S.prWho === 'all' || x.p.uid === S.prWho);
  list.sort(S.prTab === 'done'
    ? (a, b) => String(b.p.answeredOn || '').localeCompare(String(a.p.answeredOn || ''))
    : (a, b) => writtenOn(b.p).localeCompare(writtenOn(a.p)) || ((b.p.createdAt || 0) - (a.p.createdAt || 0)));
  const el = $('#prList');
  const html = list.length ? list.map(prayerCard).join('')
    : '<p class="empty">' + (S.prTab === 'done' ? '응답받은 기도제목이 여기에 모여요. 응답받으면 카드에서 \'응답받았어요\'를 눌러 주세요.' : '아직 기도제목이 없어요. 위에 적어서 가족과 함께 기도해 보세요.') + '</p>';
  keepInputs(el, () => setHTML(el, html));
}
function resetPrayerForm(){
  S.editPrayer = null;
  $('#pr-text').value = ''; $('#pr-date').value = todayStr(); $('#pr-share').checked = true;
  $('#prSave').textContent = '기도제목 추가'; $('#prCancel').hidden = true; $('#prFormTitle').textContent = '기도제목 적기';
  autosize($('#pr-text'));
}
function editPrayer(id){
  const x = findPrayer(id); if (!x) return;
  S.editPrayer = id;
  $('#pr-text').value = str(x.p.text, 500); $('#pr-date').value = writtenOn(x.p); $('#pr-share').checked = x.shared;
  $('#prSave').textContent = '수정 저장'; $('#prCancel').hidden = false; $('#prFormTitle').textContent = '기도제목 고치기';
  autosize($('#pr-text')); window.scrollTo(0, 0); $('#pr-text').focus();
}
async function savePrayer(e){
  e.preventDefault();
  if (!S.canWrite || !S.uid) return;
  const text = $('#pr-text').value.trim().slice(0, 500);
  if (!text){ toast('기도제목을 적어 주세요.'); return; }
  let on = $('#pr-date').value; if (!isDate(on)) on = todayStr();
  const share = $('#pr-share').checked, now = Date.now();
  const editing = S.editPrayer, old = editing ? findPrayer(editing) : null, base = old ? old.p : {};
  const id = editing || ('pr' + now.toString(36) + Math.random().toString(36).slice(2, 6));
  const data = {uid:S.uid, text, writtenOn:on, createdAt:base.createdAt || now, updatedAt:now, answered:!!base.answered};
  if (base.answered){ data.answeredOn = str(base.answeredOn, 10); data.answerNote = str(base.answerNote, 300); }
  const btn = $('#prSave'); btn.disabled = true;
  const ok = await put(share ? 'prayers' : 'pprayers', id, data);
  if (ok && old && old.shared !== share) await del(old.shared ? 'prayers' : 'pprayers', id);
  btn.disabled = !S.canWrite;
  if (ok){
    toast(editing ? '기도제목을 고쳤어요.' : (share ? '가족과 기도제목을 나눴어요.' : '나만 보는 기도제목으로 저장했어요.'));
    resetPrayerForm(); S.prTab = base.answered ? 'done' : 'active'; schedule();
  }
}
async function setAnswered(id, yes){
  const x = findPrayer(id); if (!x || x.p.uid !== S.uid) return;
  const p = x.p;
  const data = {uid:S.uid, text:str(p.text, 500), writtenOn:writtenOn(p), createdAt:p.createdAt || Date.now(), updatedAt:Date.now(), answered:yes};
  if (yes){
    const inp = document.getElementById('ans-' + id);
    data.answeredOn = todayStr(); data.answerNote = inp ? inp.value.trim().slice(0, 300) : '';
  }
  const ok = await put(x.shared ? 'prayers' : 'pprayers', id, data);
  if (ok){ S.answering = null; toast(yes ? '응답을 기록했어요.' : '다시 기도 중으로 옮겼어요.'); schedule(); }
}
async function deletePrayer(id){
  if (S.confirmPr !== id){
    S.confirmPr = id; schedule();
    setTimeout(() => { if (S.confirmPr === id){ S.confirmPr = null; schedule(); } }, 4000);
    return;
  }
  const x = findPrayer(id); S.confirmPr = null;
  if (x){ await del(x.shared ? 'prayers' : 'pprayers', id); if (S.editPrayer === id) resetPrayerForm(); toast('기도제목을 지웠어요.'); }
  schedule();
}
async function togglePray(pid){
  if (!S.canWrite) return;
  const id = pid + '__p__' + seg(S.uid);
  if (S.reactions.has(id)) await del('reactions', id);
  else await put('reactions', id, {entryId:pid, uid:S.uid, type:'pray', at:Date.now()});
}
function renderFamily(){
  const el = $('#familyList');
  const list = sharedList().filter(([, e]) => e.date === S.date)
    .sort((a, b) => ((b[1].uid === S.uid) - (a[1].uid === S.uid)) || ((a[1].updatedAt || 0) - (b[1].updatedAt || 0)));
  let html = '<h2 class="section-title">가족 나눔 <span class="count">' + list.length + '</span></h2>';
  if (!list.length) html += '<p class="empty">아직 이 날 나눈 묵상이 없어요. 먼저 나누면 가족이 아멘으로 응답할 수 있어요.</p>';
  list.forEach(([id, e]) => { html += entryCard(id, e); });
  if (myPriv(S.date) && !myShared(S.date)) html += '<p class="empty small">내 묵상은 나만 보기로 저장돼 있어요.</p>';
  const kept = {}; let focus = null;
  el.querySelectorAll('input[data-cmt]').forEach(i => { if (i.value) kept[i.dataset.cmt] = i.value; if (document.activeElement === i) focus = i.dataset.cmt; });
  if (setHTML(el, html)){
    el.querySelectorAll('input[data-cmt]').forEach(i => { if (kept[i.dataset.cmt]) i.value = kept[i.dataset.cmt]; if (focus === i.dataset.cmt) i.focus(); });
  }
}
async function toggleAmen(entryId){
  if (!S.canWrite) return;
  const id = entryId + '__a__' + seg(S.uid);
  if (S.reactions.has(id)) await del('reactions', id);
  else await put('reactions', id, {entryId, uid:S.uid, type:'amen', at:Date.now()});
}
async function addComment(form){
  const entryId = form.dataset.id, input = form.querySelector('input'), text = input.value.trim();
  if (!text) return;
  const id = entryId + '__c__' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  input.value = '';
  const ok = await put('reactions', id, {entryId, uid:S.uid, type:'comment', text:text.slice(0,300), at:Date.now()});
  if (!ok) input.value = text;
}

/* ---------- log ---------- */
function renderLog(){
  const mine = myDates(), ym = S.calMonth, mon = Number(ym.slice(5));
  const monthMine = [...mine].filter(d => d.startsWith(ym)).length;
  const fam = sharedList().filter(([, e]) => e.date.startsWith(ym)).length + privList().filter(([, e]) => e.date.startsWith(ym)).length;
  setHTML($('#stats'),
    '<div class="tile dawn"><b>' + streak() + '일</b><span>연속 묵상</span></div>' +
    '<div class="tile"><b>' + monthMine + '회</b><span>' + mon + '월 나의 묵상</span></div>' +
    '<div class="tile wide"><b>' + fam + '회</b><span>' + mon + '월 가족 전체</span></div>');
  const p = ym.split('-').map(Number), first = new Date(p[0], p[1]-1, 1), days = new Date(p[0], p[1], 0).getDate();
  $('#calTitle').textContent = p[0] + '년 ' + p[1] + '월';
  const by = {};
  sharedList().forEach(([, e]) => { if (e.date.startsWith(ym)) (by[e.date] = by[e.date] || new Set()).add(e.uid); });
  privList().forEach(([, e]) => { if (e.date.startsWith(ym)) (by[e.date] = by[e.date] || new Set()).add(S.uid); });
  const today = todayStr();
  let html = WD.map((w, i) => '<div class="wd' + (i === 0 ? ' sun' : '') + '">' + w + '</div>').join('');
  for (let i = 0; i < first.getDay(); i++) html += '<div></div>';
  for (let d = 1; d <= days; d++){
    const ds = ym + '-' + pad(d), who = by[ds] ? [...by[ds]] : [];
    const cls = ['day']; if (mine.has(ds)) cls.push('mine'); if (ds === today) cls.push('today'); if (ds > today) cls.push('future');
    html += '<button type="button" class="' + cls.join(' ') + '" data-act="goto" data-date="' + ds + '" aria-label="' + esc(fmtDate(ds) + (who.length ? ', ' + who.map(nameOf).join(', ') + ' 묵상' : '')) + '"><span class="n">' + d + '</span>' +
      '<span class="dots">' + who.slice(0, 5).map(u => '<i style="background:' + colorOf(u) + '"></i>').join('') + '</span></button>';
  }
  setHTML($('#calGrid'), html);
  setHTML($('#calLegend'), allUids().map(u => '<span><span class="dot" style="background:' + colorOf(u) + '"></span>' + esc(nameOf(u)) + '</span>').join(''));
  renderSearch();
}
function hl(text, q){
  const i = text.toLowerCase().indexOf(q); if (i < 0) return esc(text.slice(0, 80));
  const s = Math.max(0, i - 28), e = Math.min(text.length, i + q.length + 40);
  return (s > 0 ? '…' : '') + esc(text.slice(s, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length, e)) + (e < text.length ? '…' : '');
}
function renderSearch(){
  const q = $('#search').value.trim().toLowerCase(), el = $('#results');
  if (!q){ setHTML(el, ''); return; }
  const keys = ['passage','observe','insight','apply','prayer','verseRef','verseText'];
  const hits = sharedList().concat(privList()).filter(([, e]) => keys.some(k => str(e[k]).toLowerCase().includes(q)))
    .sort((a, b) => b[1].date.localeCompare(a[1].date)).slice(0, 40);
  if (!hits.length){ setHTML(el, '<p class="empty">찾는 내용이 없어요.</p>'); return; }
  setHTML(el, hits.map(([, e]) => {
    const k = keys.find(k => str(e[k]).toLowerCase().includes(q));
    return '<button type="button" class="result" data-act="goto" data-date="' + e.date + '"><span class="r-top"><span class="dot" style="background:' + colorOf(e.uid) + '"></span>' + esc(nameOf(e.uid)) + ' · ' + fmtShort(e.date) + (str(e.passage) ? ' · ' + esc(str(e.passage, 60)) : '') + '</span><p>' + hl(str(e[k]), q) + '</p></button>';
  }).join(''));
}

/* ---------- verse cards ---------- */
function renderCards(){
  const all = sharedList().concat(privList()).filter(([, e]) => str(e.verseText) || str(e.verseRef)).sort((a, b) => b[1].date.localeCompare(a[1].date));
  const uids = [...new Set(all.map(([, e]) => e.uid))];
  if (S.cardFilter !== 'all' && !uids.includes(S.cardFilter)) S.cardFilter = 'all';
  setHTML($('#cardFilters'), '<button type="button" class="chip" data-act="filter" data-uid="all" aria-pressed="' + (S.cardFilter === 'all') + '">전체 ' + all.length + '</button>' +
    uids.map(u => '<button type="button" class="chip" data-act="filter" data-uid="' + esc(u) + '" aria-pressed="' + (S.cardFilter === u) + '"><span class="dot" style="background:' + colorOf(u) + '"></span>' + esc(nameOf(u)) + '</button>').join(''));
  const list = S.cardFilter === 'all' ? all : all.filter(([, e]) => e.uid === S.cardFilter);
  const grid = $('#verseGrid');
  grid.classList.toggle('recite', S.recite);
  $('#reciteHint').hidden = !S.recite;
  if (!list.length){ setHTML(grid, '<p class="empty">묵상할 때 기억할 구절을 적으면 여기에 카드로 모여요.</p>'); return; }
  setHTML(grid, list.map(([id, e]) => '<button type="button" class="vcard' + (S.open.has(id) ? ' open' : '') + '" data-act="flip" data-id="' + esc(id) + '" style="--who:' + colorOf(e.uid) + '">' +
    '<span class="ref">' + (esc(str(e.verseRef, 60)) || esc(str(e.passage, 60)) || '구절') + '</span>' +
    (str(e.verseText) ? '<span class="txt">' + esc(str(e.verseText, 1000)) + '</span>' : '') +
    '<span class="who"><span class="dot" style="background:' + colorOf(e.uid) + '"></span>' + esc(nameOf(e.uid)) + ' · ' + fmtShort(e.date) + '</span></button>').join(''));
}

/* ---------- family tab ---------- */
function fillNickForm(){
  if (!S.uid) return;
  $('#nick').value = str(member(S.uid).nick, 12);
  S.pickColor = colorIdx(S.uid);
  renderSwatches();
}
function renderSwatches(){
  setHTML($('#swatches'), COLORS.map((c, i) => '<button type="button" class="sw" data-act="color" data-i="' + i + '" style="background:' + c + '" aria-label="색 ' + (i+1) + '" aria-pressed="' + (S.pickColor === i) + '"' + (S.canWrite ? '' : ' disabled') + '></button>').join(''));
}
async function saveNick(){
  if (!S.uid || !S.fid) return;
  const nick = $('#nick').value.trim().slice(0, 12);
  const ok = await attempt(() => setDoc(doc(fdb, 'families', S.fid, 'members', S.uid), {uid:S.uid, nick, color:S.pickColor, updatedAt:Date.now()}, {merge:true}));
  if (ok){ toast('호칭을 저장했어요.'); schedule(); }
}
const inviteUrl = (fid, code) => location.origin + location.pathname + '?join=' + fid + '.' + code;
function renderFamilyView(){
  const counts = {}, last = {};
  sharedList().forEach(([, e]) => { counts[e.uid] = (counts[e.uid] || 0) + 1; if (!last[e.uid] || e.date > last[e.uid]) last[e.uid] = e.date; });
  setHTML($('#members'), allUids().map(u => '<div class="mrow"><span class="avatar" style="background:' + colorOf(u) + '">' + esc(Array.from(nameOf(u))[0] || '·') + '</span>' +
    '<div><strong>' + esc(nameOf(u)) + (u === S.uid ? ' <span class="me">나</span>' : '') + (S.family && S.family.ownerUid === u ? ' <span class="lock">만든 사람</span>' : '') + '</strong><div class="meta">' + (last[u] ? '최근 나눔 ' + fmtShort(last[u]) : '아직 나눈 묵상 없음') + '</div></div>' +
    '<span class="num2">나눔 ' + (counts[u] || 0) + '회</span></div>').join('') || '<p class="empty">아직 구성원이 없어요.</p>');
  const fam = S.family;
  $('#famTitle').textContent = fam && str(fam.name, 30) ? str(fam.name, 30) + ' 초대하기' : '가족 초대하기';
  $('#inviteLink').textContent = fam && fam.inviteCode ? inviteUrl(S.fid, fam.inviteCode) : '초대 링크를 불러오는 중…';
  $('#regenCode').hidden = !(fam && fam.ownerUid === S.uid);
  $('#acctLine').textContent = S.fbUser ? '아이디 ' + idFromEmail(S.fbUser.email) + ' 로 로그인됨' : '';
  $('#leaveFam').textContent = S.confirmLeave ? '한 번 더 누르면 가족에서 나가요' : '가족에서 나가기';
  $('#modeLine').textContent = '나만 보기로 저장한 묵상과 기도제목은 본인 계정에만 저장돼요.';
}

/* ---------- render ---------- */
function renderHeader(){
  const t = todayStr();
  $('#dateText').innerHTML = esc(fmtDate(S.date)) + (S.date === t ? '<small>오늘</small>' : '');
  $('#datePick').value = S.date;
  $('#nextDay').disabled = false;
  const n = streak();
  $('#streak').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 4v3M4.9 9.9l2 2M19.1 9.9l-2 2"/></svg>' + (n ? '연속 ' + n + '일' : '오늘 첫걸음');
  $('#datenav').hidden = S.view !== 'today';
}
function renderAll(){
  renderHeader();
  if (S.view === 'today'){ syncForm(); renderPlan(); renderFamily(); }
  else if (S.view === 'pray') renderPray();
  else if (S.view === 'log') renderLog();
  else if (S.view === 'cards') renderCards();
  else if (S.view === 'family') renderFamilyView();
  resolveNames();
}
function setDate(d){
  if (!isDate(d)) return;
  flushDraft(); S.date = d; S.editingPlan = false; S.planOpen = false;
  loadFormFor(d); setView('today');
}
const TITLES = {today:'오늘의 큐티', pray:'기도제목', log:'기록', cards:'말씀카드', family:'가족'};
function setView(v){
  S.view = v;
  $('#pageTitle').textContent = TITLES[v] || '';
  ['today','pray','log','cards','family'].forEach(k => { $('#view-' + k).hidden = k !== v; });
  document.querySelectorAll('.tab').forEach(b => { if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (v === 'family') fillNickForm();
  if (v === 'log' && !S.calMonth) S.calMonth = todayStr().slice(0, 7);
  window.scrollTo(0, 0);
  schedule();
}

/* ---------- events ---------- */
function bind(){
  $('#prevDay').addEventListener('click', () => setDate(addDays(S.date, -1)));
  $('#nextDay').addEventListener('click', () => setDate(addDays(S.date, 1)));
  $('#datePick').addEventListener('change', e => setDate(e.target.value));
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#qtForm').addEventListener('input', onFormInput);
  $('#qtForm').addEventListener('submit', save);
  $('#delBtn').addEventListener('click', removeMine);
  $('#calPrev').addEventListener('click', () => { const p = S.calMonth.split('-').map(Number); S.calMonth = ymd(new Date(p[0], p[1]-2, 1)).slice(0, 7); schedule(); });
  $('#calNext').addEventListener('click', () => { const p = S.calMonth.split('-').map(Number); S.calMonth = ymd(new Date(p[0], p[1], 1)).slice(0, 7); schedule(); });
  $('#search').addEventListener('input', renderSearch);
  $('#recite').addEventListener('change', e => { S.recite = e.target.checked; S.open.clear(); schedule(); });
  $('#nickSave').addEventListener('click', saveNick);
  $('#prForm').addEventListener('submit', savePrayer);
  $('#prCancel').addEventListener('click', resetPrayerForm);
  $('#pr-text').addEventListener('input', e => autosize(e.target));
  resetPrayerForm();
  document.addEventListener('toggle', e => {
    const t = e.target; if (!t || !t.id) return;
    if (t.id === 'planDetails') S.planOpen = t.open;
    else if (t.id.startsWith('bg-') || t.id.startsWith('txt-')){ if (t.open) S.bgClosed.delete(t.id); else S.bgClosed.add(t.id); }
  }, true);
  document.addEventListener('submit', e => {
    const f = e.target;
    if (f.id === 'planForm'){ savePlan(e); return; }
    if (f.classList && f.classList.contains('cmt-form')){ e.preventDefault(); addComment(f); }
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'editPlan'){ S.editingPlan = true; renderPlan(); }
    else if (act === 'cancelPlan'){ S.editingPlan = false; $('#planCard')._h = null; renderPlan(); }
    else if (act === 'amen') toggleAmen(b.dataset.id);
    else if (act === 'delCmt') del('reactions', b.dataset.id);
    else if (act === 'goto') setDate(b.dataset.date);
    else if (act === 'filter'){ S.cardFilter = b.dataset.uid; schedule(); }
    else if (act === 'flip'){ if (!S.recite) return; const id = b.dataset.id; if (S.open.has(id)) S.open.delete(id); else S.open.add(id); schedule(); }
    else if (act === 'color'){ S.pickColor = Number(b.dataset.i); renderSwatches(); }
    else if (act === 'prTab'){ S.prTab = b.dataset.v; schedule(); }
    else if (act === 'prWho'){ S.prWho = b.dataset.uid; schedule(); }
    else if (act === 'pray') togglePray(b.dataset.id);
    else if (act === 'answer'){ S.answering = b.dataset.id; schedule(); }
    else if (act === 'ansCancel'){ S.answering = null; schedule(); }
    else if (act === 'ansSave') setAnswered(b.dataset.id, true);
    else if (act === 'unanswer') setAnswered(b.dataset.id, false);
    else if (act === 'editPr') editPrayer(b.dataset.id);
    else if (act === 'delPr') deletePrayer(b.dataset.id);
  });
  window.addEventListener('pagehide', flushDraft);
  $('#shareInvite').addEventListener('click', shareInvite);
  $('#copyInvite').addEventListener('click', () => copyText($('#inviteLink').textContent));
  $('#regenCode').addEventListener('click', regenCode);
  $('#signOut').addEventListener('click', doSignOut);
  $('#leaveFam').addEventListener('click', leaveFamily);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushDraft(); });
}

/* ---------- firebase data ---------- */
function sub(q, key){
  S.unsubs.push(onSnapshot(q, snap => {
    const m = new Map();
    snap.docs.forEach(d => { const v = d.data(); if (v && typeof v === 'object') m.set(d.id, v); });
    S[key] = m;
    if (key === 'entries' && !snap.metadata.fromCache && S.mode === 'loading'){ S.mode = 'db'; clearTimeout(S.timer); status(''); }
    schedule();
  }, err => {
    clearTimeout(S.timer); if (S.mode === 'loading') S.mode = 'db';
    const c = err && err.code;
    status(c === 'permission-denied' ? '이 가족의 기록을 볼 권한이 없어요. 초대 링크로 다시 참여해 주세요.' : '기록을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 새로고침해 주세요.', 'warn');
    schedule();
  }));
}
function stopSubs(){ S.unsubs.forEach(u => { try { u(); } catch(e){} }); S.unsubs = []; }
function subscribe(){
  const fc = c => collection(fdb, 'families', S.fid, c);
  sub(query(fc('entries'), orderBy('date', 'desc'), limit(1000)), 'entries');
  sub(query(fc('plans'), orderBy('date', 'desc'), limit(500)), 'plans');
  sub(query(fc('reactions'), orderBy('at', 'desc'), limit(1000)), 'reactions');
  sub(query(fc('members'), limit(50)), 'members');
  sub(query(fc('prayers'), orderBy('createdAt', 'desc'), limit(500)), 'prayers');
  sub(query(collection(fdb, 'users', S.uid, 'entries'), limit(1000)), 'priv');
  sub(query(collection(fdb, 'users', S.uid, 'prayers'), limit(500)), 'pprayers');
  S.unsubs.push(onSnapshot(doc(fdb, 'families', S.fid), s => { S.family = s.exists() ? s.data() : null; schedule(); }, () => {}));
}

/* ---------- gate: sign-in & family setup ---------- */
const GATES = ['loading','config','signin','family'];
function showGate(which, msg){
  $('#app').hidden = true; $('#gate').hidden = false;
  GATES.forEach(k => { $('#g-' + k).hidden = k !== which; });
  gateMsg(msg || '');
  window.scrollTo(0, 0);
}
function gateMsg(t){ $('#gateMsg').textContent = t || ''; }
function showApp(){ $('#gate').hidden = true; $('#app').hidden = false; }
const randCode = n => { const a = new Uint8Array(n), c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; crypto.getRandomValues(a); return Array.from(a, x => c[x % c.length]).join(''); };
function parseInvite(s){
  if (!s) return null;
  s = String(s).trim();
  let m = s.match(/[?&]join=([A-Za-z0-9]{10,40})\.([A-Za-z0-9]{8,40})/);
  if (!m) m = s.match(/^([A-Za-z0-9]{10,40})\.([A-Za-z0-9]{8,40})$/);
  return m ? {fid:m[1], code:m[2]} : null;
}
const ID_DOMAIN = '@family-qt.app';
const idFromEmail = em => String(em || '').replace(ID_DOMAIN, '');
const myName = () => (S.fbUser && (S.fbUser.displayName || idFromEmail(S.fbUser.email))) || '';
function clearInviteParam(){
  lsDel('family-qt-invite');
  if (location.search) try { history.replaceState(null, '', location.pathname + location.hash); } catch(e){}
}
let signupMode = false;
function setAuthMode(signup){
  signupMode = signup;
  $('#tabLogin').setAttribute('aria-pressed', String(!signup));
  $('#tabSignup').setAttribute('aria-pressed', String(signup));
  $('#pw2Wrap').hidden = !signup; $('#signupNote').hidden = !signup;
  $('#authBtn').textContent = signup ? '가입하고 시작하기' : '로그인';
  $('#authPw').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
  gateMsg('');
}
async function idAuth(e){
  e.preventDefault(); gateMsg('');
  const id = $('#authId').value.trim().toLowerCase();
  const pw = $('#authPw').value;
  if (!/^[a-z0-9][a-z0-9._-]{3,19}$/.test(id)){ gateMsg('아이디는 영문 소문자·숫자로 4~20자여야 해요.'); return; }
  if (pw.length < 6){ gateMsg('비밀번호는 6자 이상이어야 해요.'); return; }
  if (signupMode && pw !== $('#authPw2').value){ gateMsg('비밀번호 확인이 일치하지 않아요.'); return; }
  const btn = $('#authBtn'); btn.disabled = true;
  try {
    if (signupMode){
      const cred = await createUserWithEmailAndPassword(auth, id + ID_DOMAIN, pw);
      try { await updateProfile(cred.user, {displayName:id}); } catch(e2){}
    } else {
      await signInWithEmailAndPassword(auth, id + ID_DOMAIN, pw);
    }
  } catch(err){
    const c = err && err.code;
    if (c === 'auth/email-already-in-use') gateMsg('이미 있는 아이디예요. 다른 아이디를 쓰거나 로그인해 주세요.');
    else if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found' || c === 'auth/invalid-login-credentials') gateMsg(signupMode ? '가입하지 못했어요. 다시 시도해 주세요.' : '아이디 또는 비밀번호가 맞지 않아요. 처음이면 \'가입\'을 눌러 주세요.');
    else if (c === 'auth/weak-password') gateMsg('비밀번호가 너무 쉬워요. 6자 이상으로 정해 주세요.');
    else if (c === 'auth/too-many-requests') gateMsg('시도가 너무 많았어요. 잠시 후 다시 해 주세요.');
    else if (c === 'auth/operation-not-allowed') gateMsg('아이디 로그인이 아직 켜지지 않았어요. 관리자에게 알려 주세요.');
    else if (c === 'auth/network-request-failed') gateMsg('인터넷 연결을 확인해 주세요.');
    else gateMsg('로그인하지 못했어요. (' + (c || '오류') + ')');
  }
  btn.disabled = false;
}
async function afterSignIn(user){
  S.uid = user.uid; S.fbUser = user;
  showGate('loading');
  let fam = null;
  try { const u = await getDoc(doc(fdb, 'users', user.uid)); fam = u.exists() ? (u.data().familyId || null) : null; } catch(e){}
  const inv = parseInvite(location.search) || parseInvite(lsGet('family-qt-invite'));
  if (inv && inv.fid !== fam){ prepFamilyGate(inv); return; }
  if (inv) clearInviteParam();
  if (fam){
    try { await getDoc(doc(fdb, 'families', fam, 'members', user.uid)).then(s => { if (!s.exists()) throw new Error('gone'); }); startApp(fam); return; }
    catch(e){ /* removed from family or offline */ }
  }
  prepFamilyGate(null);
}
function prepFamilyGate(inv){
  showGate('family');
  const nm = myName();
  $('#joinNick').value = ''; $('#myNick').value = '';
  $('#joinNick').placeholder = '예: 엄마' + (nm ? ' (비우면 ' + nm + ')' : '');
  $('#myNick').placeholder = '예: 아빠' + (nm ? ' (비우면 ' + nm + ')' : '');
  if (inv){
    $('#joinInput').value = inviteUrl(inv.fid, inv.code);
    $('#joinCard').querySelector('h2').textContent = '가족 초대를 받았어요';
    $('#joinNick').focus();
  }
}
async function createFamily(){
  const name = $('#famName').value.trim().slice(0, 30) || '우리 가족';
  const nick = $('#myNick').value.trim().slice(0, 12) || myName().slice(0, 12) || '나';
  const btn = $('#createFam'); btn.disabled = true; gateMsg('');
  try {
    const fref = doc(collection(fdb, 'families'));
    await setDoc(fref, {name, ownerUid:S.uid, inviteCode:randCode(16), createdAt:Date.now()});
    await setDoc(doc(fdb, 'families', fref.id, 'members', S.uid), {uid:S.uid, nick, name:myName().slice(0, 30), color:0, code:'', joinedAt:Date.now()});
    await setDoc(doc(fdb, 'users', S.uid), {familyId:fref.id}, {merge:true});
    clearInviteParam();
    startApp(fref.id); setView('family');
    toast('가족을 만들었어요. 초대 링크를 보내 보세요.');
  } catch(e){
    gateMsg('가족을 만들지 못했어요. Firestore 보안 규칙이 배포됐는지 확인해 주세요. (' + ((e && e.code) || '오류') + ')');
  }
  btn.disabled = false;
}
async function joinFamily(){
  const inv = parseInvite($('#joinInput').value);
  if (!inv){ gateMsg('초대 링크를 다시 확인해 주세요. 링크 전체를 붙여 넣어야 해요.'); return; }
  const nick = $('#joinNick').value.trim().slice(0, 12) || myName().slice(0, 12) || '가족';
  const btn = $('#joinFam'); btn.disabled = true; gateMsg('');
  try {
    await setDoc(doc(fdb, 'families', inv.fid, 'members', S.uid), {uid:S.uid, nick, name:myName().slice(0, 30), code:inv.code, joinedAt:Date.now()}, {merge:true});
    await setDoc(doc(fdb, 'users', S.uid), {familyId:inv.fid}, {merge:true});
    clearInviteParam();
    startApp(inv.fid);
    toast('가족에 참여했어요!');
  } catch(e){
    gateMsg(e && e.code === 'permission-denied' ? '초대 링크가 맞지 않거나 새로 바뀌었어요. 가족에게 새 링크를 받아 주세요.' : '참여하지 못했어요. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.');
  }
  btn.disabled = false;
}
function startApp(fid){
  stopSubs();
  COLS.forEach(k => { S[k] = new Map(); });
  S.fid = fid; S.family = null; S.mode = 'loading'; S.canWrite = true; S.confirmLeave = false;
  showApp(); subscribe();
  clearTimeout(S.timer);
  S.timer = setTimeout(() => { if (S.mode === 'loading') status('가족 기록에 아직 연결되지 않았어요. 인터넷 연결을 확인해 주세요.', 'warn'); }, 10000);
  S.dirty = false; S.formKey = '';
  loadFormFor(S.date); gate(); schedule();
}
async function copyText(t){
  if (!t) return;
  try { await navigator.clipboard.writeText(t); toast('복사했어요.'); }
  catch(e){ toast('복사하지 못했어요. 링크를 길게 눌러 복사해 주세요.'); }
}
async function shareInvite(){
  const url = S.family && S.family.inviteCode ? inviteUrl(S.fid, S.family.inviteCode) : '';
  if (!url) return;
  const famName = S.family && str(S.family.name, 30) || '우리 가족';
  const text = famName + ' 큐티에 초대해요. 링크를 열고 아이디를 만들면 함께 묵상과 기도제목을 나눌 수 있어요.';
  if (navigator.share){
    try { await navigator.share({title:'우리 가족 큐티', text, url}); return; }
    catch(e){ if (e && e.name === 'AbortError') return; }
  }
  copyText(text + '\n' + url);
}
async function regenCode(){
  if (!S.family || S.family.ownerUid !== S.uid) return;
  const ok = await attempt(() => setDoc(doc(fdb, 'families', S.fid), {inviteCode:randCode(16)}, {merge:true}));
  if (ok) toast('새 초대 링크를 만들었어요. 이전 링크로는 더 이상 참여할 수 없어요.');
}
async function doSignOut(){
  flushDraft(); stopSubs(); S.fid = null;
  try { await signOut(auth); } catch(e){}
}
async function leaveFamily(){
  if (!S.confirmLeave){
    S.confirmLeave = true; schedule();
    setTimeout(() => { S.confirmLeave = false; schedule(); }, 4000);
    return;
  }
  const fid = S.fid;
  stopSubs();
  try {
    await deleteDoc(doc(fdb, 'families', fid, 'members', S.uid));
    await setDoc(doc(fdb, 'users', S.uid), {familyId:null}, {merge:true});
  } catch(e){ toast('나가지 못했어요. 다시 시도해 주세요.'); startApp(fid); return; }
  S.fid = null;
  prepFamilyGate(null);
  gateMsg('');
}

/* ---------- boot ---------- */
function init(){
  bind();
  loadNotes();
  $('#authForm').addEventListener('submit', idAuth);
  $('#tabLogin').addEventListener('click', () => setAuthMode(false));
  $('#tabSignup').addEventListener('click', () => setAuthMode(true));
  $('#createFam').addEventListener('click', createFamily);
  $('#joinFam').addEventListener('click', joinFamily);
  $('#signOut1').addEventListener('click', doSignOut);

  const inv = parseInvite(location.search);
  if (inv) lsSet('family-qt-invite', inv.fid + '.' + inv.code);

  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey || /붙여|YOUR/i.test(cfg.apiKey)){ showGate('config'); return; }

  fbApp = initializeApp(cfg);
  auth = getAuth(fbApp);
  try { fdb = initializeFirestore(fbApp, {localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})}); }
  catch(e){ fdb = getFirestore(fbApp); }

  onAuthStateChanged(auth, user => {
    if (user){ afterSignIn(user); return; }
    stopSubs(); S.uid = null; S.fbUser = null; S.fid = null;
    showGate('signin');
    const invited = !!parseInvite(lsGet('family-qt-invite'));
    $('#inviteNote').hidden = !invited;
    setAuthMode(invited);
  });
}
init();
