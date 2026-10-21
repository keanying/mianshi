(() => {
'use strict';
const DATA=JSON.parse(document.getElementById('questionData').textContent);
const CANDS=[];
const $=id=>document.getElementById(id);
const paths={search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z"/>',book:'<path d="M4 4h7a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4Zm16 0h-3a3 3 0 0 0-3 3v14a4 4 0 0 1 4-2h2V4Z"/>',message:'<path d="M20 15a3 3 0 0 1-3 3H8l-5 3V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9"/><path d="M7 8h10M7 12h6"/>',download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',printer:'<path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7zM17 11h.1"/>',chevron:'<path d="m6 9 6 6 6-6"/>',check:'<path d="m5 12 4 4L19 6"/>',circle:'<circle cx="12" cy="12" r="8"/>',eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',shuffle:'<path d="M3 5h3l12 14h3m-4-4 4 4-4 3M3 19h3l12-14h3m-4-3 4 3-4 4"/>'};
function icon(name){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.book}</svg>`}
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
// 下载按钮指向当前文件本身，文件改名或移动后仍然有效。
{const self=location.href.split('#')[0];if(/\.html?$/i.test(self)){$('downloadButton').href=self;$('downloadButton').download=decodeURIComponent(self.split('/').pop())}}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s).normalize('NFKC').toLocaleLowerCase().replace(/langraph/g,'langgraph');
const DIMS={pro:'专业',exp:'表达',ext:'应变'};
const POOL_TOTAL=DATA.questions.length;

// 统一的题目模型：通用题以数字字符串为 key，简历题以 "A-p1-3" 为 key。
const items=new Map(),blockIndex=new Map(),haystacks=new Map();
const indexItem=q=>{items.set(q.key,q);haystacks.set(q.key,norm([q.question,...q.points,q.follow,q.twist||'',q.good||'',q.bad||'',q.kind==='pool'?DATA.categories[q.category]:blockIndex.get(q.block).block.name].join(' ')))};
for(const q of DATA.questions)indexItem({...q,key:String(q.id),kind:'pool',dimList:q.dims||[]});
// 简历板块可能在解锁后才加入，所以单独成函数。
function addCandidates(list){for(const c of list){if(CANDS.some(x=>x.id===c.id))continue;CANDS.push(c);for(const b of c.blocks){blockIndex.set(b.id,{cand:c,block:b});for(const q of b.questions)indexItem({...q,key:q.id,kind:'resume',cand:c.id,block:b.id,dimList:[q.dim]})}}}
addCandidates(DATA.candidates||[]);
const poolByOrigin=new Map();
for(const q of DATA.questions)if(q.origin?.question)poolByOrigin.set(q.origin.question,q.id);

const STORAGE='agent-interviewer-v3';let storageAvailable=true,initial={};
try{initial=JSON.parse(localStorage.getItem(STORAGE)||'null');if(!initial){const old=JSON.parse(localStorage.getItem('agent-interviewer-v2')||'{}')||{};initial={saved:(old.saved||[]).map(String),mastered:(old.mastered||[]).map(String)}}}catch(e){storageAvailable=false;initial={}}
// 简历题在解锁前不在 items 中，记录照样保留。
const validKeys=xs=>Array.isArray(xs)?xs.map(String).filter(k=>items.has(k)||/^[A-Z]+-/.test(k)):[];
const saved=new Set(validKeys(initial.saved)),mastered=new Set(validKeys(initial.mastered));
const scores=(initial.scores&&typeof initial.scores==='object')?initial.scores:{};
// cand 为空表示简历板块总览。
const state={view:'pool',category:-1,cand:null,block:'',search:'',dims:new Set(),favorites:false,unlearned:false,coding:false,origin:false,interview:false,page:1};
const perPage=20,openIds=new Set(['1']),closedIds=new Set();let currentResults=[],toastTimer;
if(!CANDS.length&&!DATA.locked){$('resumeTab').disabled=true;$('resumeTab').title='当前版本未包含简历数据'}
const candById=id=>CANDS.find(c=>c.id===id);

// 视图状态写入 hash（#/pool/3、#/resume/A/A-p1、#/method），每个简历板块都可以单独收藏或转发。
function readHash(){
 const [view,a,b]=decodeURIComponent(location.hash.replace(/^#\/?/,'')).split('/');
 if(view==='method')state.view='method';
 else if(view==='pool'){state.view='pool';const n=Number(a);state.category=Number.isInteger(n)&&n>=0&&n<DATA.categories.length?n:-1}
 else if(view==='resume'&&(CANDS.length||DATA.locked)){state.view='resume';state.cand=candById(a)?a:null;state.block=state.cand&&blockIndex.get(b)?.cand.id===state.cand?b:''}
}
function writeHash(){
 if(state.view==='resume'&&!CANDS.length)return; // 未解锁时保留原地址，解锁后再按它打开对应板块
 const parts=state.view==='pool'?['pool',...(state.category>=0?[state.category]:[])]:state.view==='resume'?['resume',...(state.cand?[state.cand]:[]),...(state.block?[state.block]:[])]:['method'];
 const hash='#/'+parts.map(encodeURIComponent).join('/');
 if(location.hash!==hash)history.replaceState(null,'',hash);
}

function tokens(){return norm(state.search).trim().split(/\s+/).filter(Boolean)}
function matchSearch(q){return tokens().every(t=>{if(q.kind==='pool'&&/^(?:#|q)?\d{1,3}$/.test(t))return q.id===Number(t.replace(/^[#q]/,''));return haystacks.get(q.key).includes(t)})}
function matchCommon(q){if(state.dims.size&&!q.dimList.some(d=>state.dims.has(d)))return false;if(state.favorites&&!saved.has(q.key))return false;if(state.unlearned&&mastered.has(q.key))return false;return matchSearch(q)}
function matchPool(q,ignoreCategory=false){if(q.kind!=='pool')return false;if(state.coding&&!q.code)return false;if(state.origin&&!q.origin)return false;if(!ignoreCategory&&state.category>=0&&q.category!==state.category)return false;return matchCommon(q)}
function matchResume(q,ignoreBlock=false){if(q.kind!=='resume'||q.cand!==state.cand)return false;if(!ignoreBlock&&state.block&&q.block!==state.block)return false;return matchCommon(q)}
function highlight(text){let terms=state.search.trim().split(/\s+/).filter(Boolean).filter(t=>!/^#?\d+$/.test(t));if(!terms.length)return esc(text);terms=[...new Set(terms)].sort((a,b)=>b.length-a.length);const re=new RegExp(terms.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'gi');let out='',last=0;for(const m of text.matchAll(re)){out+=esc(text.slice(last,m.index))+'<mark>'+esc(m[0])+'</mark>';last=m.index+m[0].length}return out+esc(text.slice(last))}

let toastUndoAction=null;
function dismissToast(){clearTimeout(toastTimer);$('toast').hidden=true;toastUndoAction=null}
function notify(message,{type='success',description='',undo=null}={}){
 clearTimeout(toastTimer);toastUndoAction=undo;
 if(/限制|不允许|没有题目/.test(message)&&type==='success')type='warning';
 $('toast').dataset.type=type;$('toastSymbol').innerHTML=icon(type==='success'?'check':'message');
 $('toastTitle').textContent=message;$('toastDesc').textContent=description;$('toastDesc').hidden=!description;
 $('toastUndo').hidden=!undo;$('toast').hidden=false;toastTimer=setTimeout(dismissToast,undo?7000:5000);
}
$('toastClose').addEventListener('click',dismissToast);
$('toastUndo').addEventListener('click',()=>{const action=toastUndoAction;dismissToast();if(action){action();notify('操作已撤销')}});
$('toast').addEventListener('mouseenter',()=>clearTimeout(toastTimer));
$('toast').addEventListener('mouseleave',()=>{toastTimer=setTimeout(dismissToast,5000)});
let resolveDialog=null;
function confirmAction({title,description,button='确认',danger=false}){
 dismissToast();const dialog=$('confirmDialog');$('dialogTitle').textContent=title;
 $('dialogDescription').textContent=description;$('dialogConfirm').textContent=button;
 dialog.classList.toggle('dialog-danger',danger);dialog.returnValue='cancel';dialog.showModal();
 return new Promise(resolve=>{resolveDialog=resolve});
}
$('dialogCancel').addEventListener('click',()=>$('confirmDialog').close('cancel'));
$('dialogConfirm').addEventListener('click',()=>$('confirmDialog').close('confirm'));
$('confirmDialog').addEventListener('close',()=>{const resolve=resolveDialog;resolveDialog=null;if(resolve)resolve($('confirmDialog').returnValue==='confirm')});

function persist(){try{localStorage.setItem(STORAGE,JSON.stringify({saved:[...saved],mastered:[...mastered],scores}))}catch(e){storageAvailable=false;notify('浏览器不允许保存，记录仅在本次页面有效。')}updateProgress()}
function scopeKeys(){if(state.view==='resume')return [...items.values()].filter(q=>q.kind==='resume'&&(!state.cand||q.cand===state.cand)).map(q=>q.key);return [...items.values()].filter(q=>q.kind==='pool').map(q=>q.key)}
function updateProgress(){const keys=scopeKeys(),asked=keys.filter(k=>mastered.has(k)).length;$('progressLabel').textContent=`${asked} / ${keys.length}`;$('progressFill').style.width=`${keys.length?asked/keys.length*100:0}%`;$('savedCount').textContent=`${keys.filter(k=>saved.has(k)).length} 道入选题目`;if(!storageAvailable){$('storageNote').hidden=false;$('storageNote').textContent='当前浏览器限制存储，记录可能不会保留。'}}

const navButton=(value,active,num,name,count,extra='')=>`<button class="nav-item ${active?'active':''}" data-nav="${esc(value)}" ${active?'aria-current="page"':''}><span class="nav-number">${num}</span><span class="nav-name">${esc(name)}${extra}</span><span class="nav-count">${count}</span></button>`;
function renderNav(){
 document.querySelectorAll('.view-switch button').forEach(b=>{const on=b.dataset.view===state.view;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on))});
 if(state.view==='pool'){
  const pool=[...items.values()].filter(q=>matchPool(q,true));const counts=DATA.categories.map((_,i)=>pool.filter(q=>q.category===i).length);
  $('sideLabel').textContent='按能力选题';$('sideCount').textContent=`${DATA.categories.length} 分类`;
  $('categoryNav').innerHTML=navButton(-1,state.category===-1,'◎','全部问题',pool.length)+DATA.categories.map((name,i)=>navButton(i,state.category===i,String(i+1).padStart(2,'0'),name,counts[i])).join('');
  $('mobileCategory').innerHTML=`<option value="-1">全部分类 · ${POOL_TOTAL} 道</option>`+DATA.categories.map((n,i)=>`<option value="${i}">${String(i+1).padStart(2,'0')} · ${esc(n)}</option>`).join('');$('mobileCategory').value=String(state.category);
 }else if(state.view==='resume'){
  const c=candById(state.cand);const kinds={skills:'技能',work:'经历',project:'项目'};
  if(!CANDS.length){
   $('sideLabel').textContent='简历板块 · 已加密';$('sideCount').textContent='';$('categoryNav').innerHTML='';
   $('mobileCategory').innerHTML='<option value="">输入密码后显示简历板块</option>';
  }else if(!c){
   $('sideLabel').textContent='简历板块 · 每份简历独立';$('sideCount').textContent=`${CANDS.length} 份`;
   $('categoryNav').innerHTML=CANDS.map((x,i)=>navButton('cand:'+x.id,false,esc(x.id),x.label+' · '+x.headline,x.blocks.reduce((n,b)=>n+b.questions.length,0))).join('');
   $('mobileCategory').innerHTML=`<option value="">选择简历板块 · ${CANDS.length} 份</option>`+CANDS.map(x=>`<option value="cand:${esc(x.id)}">${esc(x.label)} · ${esc(x.headline)}</option>`).join('');$('mobileCategory').value='';
  }else{
   const pool=[...items.values()].filter(q=>matchResume(q,true));
   $('sideLabel').textContent=c.label+' · 按简历分块';$('sideCount').textContent=`${c.blocks.length} 块`;
   $('categoryNav').innerHTML=(`<button class="nav-item back" data-nav="back"><span class="nav-number">←</span><span class="nav-name">全部简历板块</span><span class="nav-count">${CANDS.length}</span></button>`)+navButton('',!state.block,'◎','全部分块',pool.length)+c.blocks.map((b,i)=>navButton(b.id,state.block===b.id,String(i+1).padStart(2,'0'),b.name,pool.filter(q=>q.block===b.id).length,` <span class="nav-kind">${kinds[b.kind]||''}</span>`)).join('');
   $('mobileCategory').innerHTML='<option value="back">← 全部简历板块</option>'+`<option value="">全部分块</option>`+c.blocks.map((b,i)=>`<option value="${esc(b.id)}">${String(i+1).padStart(2,'0')} · ${esc(b.name)}</option>`).join('');$('mobileCategory').value=state.block;
  }
 }else{
  const sections=[...document.querySelectorAll('#methodView section')];
  $('sideLabel').textContent='评估方法';$('sideCount').textContent=`${sections.length} 节`;
  $('categoryNav').innerHTML=sections.map((s,i)=>navButton(s.id,false,String(i+1).padStart(2,'0'),s.querySelector('h3').textContent,'')).join('');
  $('mobileCategory').innerHTML=sections.map(s=>`<option value="${s.id}">${esc(s.querySelector('h3').textContent)}</option>`).join('');
 }
}

function dimBadges(q){return q.dimList.map((d,i)=>`<span class="dim dim-${d}${i?' secondary':''}" title="${i?'兼顾':'主考'}维度">${DIMS[d]||d}</span>`).join('')}
function codePanel(q){if(!q.code)return '';return `<details class="code-panel"><summary>参考代码 · Python 3.11+ · 点击展开</summary><div class="code-toolbar"><span>q${q.id}.py · 仅使用标准库 · 含可运行入口</span><div class="code-actions"><button class="btn small" data-copy="${q.key}">复制代码</button><button class="btn small" data-code-download="${q.key}">下载 .py</button></div></div><pre class="code-block"><code>${q.codeHtml||esc(q.code)}</code></pre><p class="code-note">运行：python q${q.id}.py。适用前提与生产边界见代码开头说明。</p></details>`}
function sourceLinks(q){return q.sources?`<p class="code-note">官方资料（2026-10-13 核对）：${q.sources.map(([name,url])=>`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(name)}</a>`).join(' · ')}。具体行为以采用版本与宿主实现为准。</p>`:''}
function originBadge(q){if(!q.origin)return '';const ref=blockIndex.get(q.origin.block);return `<span class="origin" title="由简历专项题去个人化后沉淀">源自简历${ref?' · '+esc(ref.cand.label.replace('候选人 ',''))+' · '+esc(ref.block.name):''}</span>`}
function poolLinkBadge(q){const id=poolByOrigin.get(q.key);return id?`<button class="pool-link" data-pool-jump="${id}" title="已沉淀为通用题，点击查看">已沉淀 Q${String(id).padStart(3,'0')} ↗</button>`:''}
async function copyText(text){try{await navigator.clipboard.writeText(text)}catch(e){const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();const ok=document.execCommand('copy');area.remove();if(!ok)throw new Error('copy failed')}}

function card(q){
 const favorite=saved.has(q.key),learned=mastered.has(q.key);const isOpen=openIds.has(q.key)||(Boolean(state.search.trim())&&!closedIds.has(q.key));
 const label=q.kind==='pool'?`Q${String(q.id).padStart(3,'0')}`:q.key;
 const where=q.kind==='pool'?esc(DATA.categories[q.category]):'';
 const meta=`<span class="q-id">${esc(label)}</span>${dimBadges(q)}${where?`<span class="q-category">${where}</span>`:''}${q.kind==='pool'?originBadge(q):poolLinkBadge(q)}`;
 const pointsTitle=q.kind==='pool'?'参考答案要点':'考察要点（好回答应覆盖）';
 const signals=(q.good||q.bad)?`<div class="signals">${q.good?`<div class="signal good"><strong>高分信号</strong>${highlight(q.good)}</div>`:''}${q.bad?`<div class="signal bad"><strong>风险信号</strong>${highlight(q.bad)}</div>`:''}</div>`:'';
 return `<article class="card" id="q-${esc(q.key)}"><div class="card-bar"><div class="card-meta">${meta}</div><div class="card-tools"><button class="icon-btn ${learned?'mastered':''}" data-action="master" data-id="${esc(q.key)}" aria-label="${learned?'标为未问':'标记已问'} ${esc(label)}" aria-pressed="${learned}" title="${learned?'已问，点击标为未问':'标记已问'}">${icon('check')}<span>${learned?'已问':'未问'}</span></button><button class="icon-btn ${favorite?'saved':''}" data-action="save" data-id="${esc(q.key)}" aria-label="${favorite?'移出题单':'加入题单'} ${esc(label)}" aria-pressed="${favorite}" title="${favorite?'移出题单':'加入面试题单'}">${icon('star')}</button></div></div><h3 class="card-question"><span class="question-label">问题</span>${highlight(q.question)}</h3><details class="answer-wrap" data-id="${esc(q.key)}" ${isOpen?'open':''}><summary><span class="answer-title">${icon('book')}<span>${pointsTitle} · 追问 · 情景变更</span></span><span class="disclosure">查看 / 收起 ${icon('chevron')}</span></summary><div class="answer-content"><ol class="answer-points">${q.points.map((p,i)=>`<li><span class="point-no" aria-hidden="true">${i+1}</span><span>${highlight(p)}</span></li>`).join('')}</ol><div class="followup"><strong>深挖追问</strong><span>${highlight(q.follow)}</span></div>${q.twist?`<div class="twist"><strong>情景变更</strong><span>${highlight(q.twist)}</span></div>`:''}${signals}${sourceLinks(q)}${codePanel(q)}</div></details></article>`;
}

function candidatePanel(c){
 const sc=scores[c.id]||{};
 const scale=d=>`<div class="score-scale" role="group" aria-label="${DIMS[d]}评分">${[1,2,3,4].map(n=>`<button data-score="${d}" data-value="${n}" class="${sc[d]===n?'active':''}" aria-pressed="${sc[d]===n}">${n}</button>`).join('')}</div>`;
 return `<div class="cand-panel"><div class="cand-head"><h3>${esc(c.label)}</h3><span>${esc(c.headline)}</span></div><p class="cand-profile">${esc(c.profile)}</p><div class="cand-grid"><div class="cand-box"><h4>面试策略</h4><ul>${c.focus.map(f=>`<li>${esc(f)}</li>`).join('')}</ul></div><div class="cand-box"><h4>简历核实点（开场 5 分钟）</h4><ul>${c.verify.map(v=>`<li>${esc(v.point)}<span class="verify-ask">问法：${esc(v.ask)}</span></li>`).join('')}</ul></div></div><div class="score-panel"><h4><span>本场打分（1~4，锚点见「评估方法」）</span><button class="btn small" data-score-copy="${esc(c.id)}">复制评估摘要</button></h4>${Object.keys(DIMS).map(d=>`<div class="score-row"><label><span class="dim dim-${d}">${DIMS[d]}</span></label>${scale(d)}</div>`).join('')}<textarea class="score-note" data-score-note="${esc(c.id)}" placeholder="记录关键回答、高分/风险信号、建议下一轮重点…">${esc(sc.note||'')}</textarea></div></div>`;
}

// 简历板块以密文内嵌（PBKDF2-SHA256 → AES-256-GCM，格式见 scripts/vault.py），输入密码后在本地解密。
const PASS_KEY='agent-interviewer-pass';let unlockError='',unlocking=false;
async function unlock(password,remember){
 const bytes=b=>Uint8Array.from(atob(b),ch=>ch.charCodeAt(0)),box=DATA.locked;
 const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
 const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(box.salt),iterations:box.iter,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['decrypt']);
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(box.iv)},key,bytes(box.ct));
 addCandidates(JSON.parse(new TextDecoder().decode(plain)));
 try{remember?localStorage.setItem(PASS_KEY,password):localStorage.removeItem(PASS_KEY)}catch(e){}
}
function unlockPanel(){
 if(!window.crypto?.subtle)return `<div class="empty"><h3>当前浏览器无法解密</h3><p>请用 Chrome、Edge、Safari 或 Firefox 直接打开本文件，或通过 https 地址访问。</p></div>`;
 return `<form class="unlock" id="unlockForm"><h3>简历板块已加密</h3><p>通用题池和评估方法无需密码。输入密码后，简历板块只在本机浏览器中解密。</p><input type="password" id="unlockInput" placeholder="输入密码" autocomplete="current-password" aria-label="简历板块密码" ${unlocking?'disabled':''}><label class="unlock-remember"><input type="checkbox" id="unlockRemember" checked> 在本机记住密码，下次自动解锁</label><button class="btn primary" type="submit" ${unlocking?'disabled':''}>${unlocking?'正在解密…':'解锁简历板块'}</button>${unlockError?`<p class="unlock-error" role="alert">${esc(unlockError)}</p>`:''}</form>`;
}

function boardCard(c){
 const keys=c.blocks.flatMap(b=>b.questions.map(q=>q.id)),asked=keys.filter(k=>mastered.has(k)).length,sc=scores[c.id]||{};
 const scoreText=Object.keys(DIMS).map(d=>`${DIMS[d]} ${sc[d]??'–'}`).join(' · ');
 return `<button class="board-card" data-open-cand="${esc(c.id)}"><span class="board-top"><span class="board-id">${esc(c.id)}</span><span><strong>${esc(c.label)}</strong><br><span class="board-headline">${esc(c.headline)}</span></span></span><p>${esc(c.profile)}</p><span class="board-blocks">${c.blocks.map(b=>`<span>${esc(b.name.length>14?b.name.slice(0,14)+'…':b.name)}</span>`).join('')}</span><span class="board-foot"><span>${c.blocks.length} 块 · ${keys.length} 题 · 已问 ${asked}</span><span>${scoreText}</span></span>${c.receivedAt?`<span class="board-foot"><span>${esc(c.source||'')}</span><span>收到 ${esc(c.receivedAt)}</span></span>`:''}</button>`;
}

function render(resetScroll=true){
 const previousScroll=$('cards').scrollTop;const method=state.view==='method';
 $('results').hidden=method;$('methodView').hidden=!method;document.querySelector('.controls').hidden=method;
 renderNav();updateProgress();
 for(const [id,value,show] of [['codeFilter',state.coding,state.view==='pool'],['originFilter',state.origin,state.view==='pool'],['favoriteFilter',state.favorites,true],['unlearnedFilter',state.unlearned,true],['interviewButton',state.interview,true]]){$(id).classList.toggle('is-active',value);$(id).setAttribute('aria-pressed',String(value));$(id).hidden=!show}
 document.querySelectorAll('#dimFilter [data-dim]').forEach(b=>{const on=state.dims.has(b.dataset.dim);b.classList.toggle('is-active',on);b.setAttribute('aria-pressed',String(on))});
 $('clearSearch').hidden=!state.search;
 writeHash();
 if(method){$('modeHint').textContent='';updatePrint();return}
 const filters=`${state.dims.size?' · '+[...state.dims].map(d=>DIMS[d]).join('/'):''}${state.search.trim()?' · 搜索「'+state.search.trim()+'」':''}${state.coding?' · 编程题':''}${state.origin?' · 源自简历':''}${state.favorites?' · 面试题单':''}${state.unlearned?' · 未问':''}${state.interview?' · 答案已隐藏':''}`;
 $('cards').classList.toggle('interview',state.interview);
 const empty=`<div class="empty">${icon('search')}<h3>暂时没有匹配的题目</h3><p>换个关键词、选择其他分类，或清除当前筛选。</p><button class="btn" data-action="reset">清除全部筛选</button></div>`;
 if(state.view==='pool'){
  currentResults=[...items.values()].filter(q=>matchPool(q));
  const pages=Math.max(1,Math.ceil(currentResults.length/perPage));state.page=Math.max(1,Math.min(state.page,pages));const start=(state.page-1)*perPage;const visible=currentResults.slice(start,start+perPage);
  $('categoryTitle').textContent=state.category<0?'通用题池 · 全部问题':DATA.categories[state.category];
  $('resultCount').textContent=`${currentResults.length} 道题${filters}`;
  $('cards').innerHTML=visible.length?visible.map(card).join(''):empty;
  $('pagination').hidden=false;$('pageRange').textContent=visible.length?`第 ${start+1}–${start+visible.length} 道匹配结果 / 共 ${currentResults.length} 道`:'没有匹配结果';$('pageLabel').textContent=`${state.page} / ${pages}`;$('prevButton').disabled=state.page<=1;$('nextButton').disabled=state.page>=pages;
  $('modeHint').textContent=`${POOL_TOTAL} 道通用题 · 每题含情景变更与评分信号`;
 }else{
  const c=candById(state.cand);
  $('pagination').hidden=true;
  if(!CANDS.length){
   currentResults=[];$('blockTabs').hidden=true;
   $('categoryTitle').textContent='简历板块';$('resultCount').textContent='需要密码';
   $('cards').innerHTML=unlockPanel();$('modeHint').textContent='';
   setTimeout(()=>$('unlockInput')?.focus(),0);
  }else if(!c){
   // 简历板块总览：每份简历一张卡片，点进去是它独立的板块。
   currentResults=[];$('blockTabs').hidden=true;
   $('categoryTitle').textContent='简历板块';$('resultCount').textContent=`${CANDS.length} 份简历 · 每份独立成板块，按简历分块出题`;
   $('cards').innerHTML=`<div class="board-grid">${CANDS.map(boardCard).join('')}<div class="board-card board-add"><span>新简历发来后会追加为新的板块（E、F…），已有板块与打分记录不受影响。</span>${DATA.locked?'<span><button class="btn small" type="button" data-lock>锁定并忘记本机密码</button></span>':''}</div></div>`;
   $('modeHint').textContent='选择一份简历进入它的板块';
  }else{
   currentResults=[...items.values()].filter(q=>matchResume(q));
   const blocks=c.blocks.filter(b=>!state.block||b.id===state.block);
   const counts=new Map(c.blocks.map(b=>[b.id,[...items.values()].filter(q=>q.block===b.id&&matchResume(q,true)).length]));
   $('blockTabs').hidden=false;
   $('blockTabs').innerHTML=`<button role="tab" data-block="" class="${state.block?'':'active'}" aria-selected="${!state.block}">全部分块 <small>${[...counts.values()].reduce((a,b)=>a+b,0)}</small></button>`+c.blocks.map(b=>`<button role="tab" data-block="${esc(b.id)}" class="${state.block===b.id?'active':''}" aria-selected="${state.block===b.id}">${esc(b.name)} <small>${counts.get(b.id)}</small></button>`).join('');
   $('categoryTitle').textContent=state.block?`${c.label} · ${blockIndex.get(state.block).block.name}`:`${c.label} · ${c.headline}`;
   $('resultCount').textContent=`${currentResults.length} 道题${filters}`;
   let html=!state.block?candidatePanel(c):'';
   for(const b of blocks){const qs=currentResults.filter(q=>q.block===b.id);if(!qs.length)continue;html+=`<div class="block-heading">${esc(b.name)}<small>${esc(b.period||'')} · ${qs.length} 题</small></div><p class="block-excerpt"><strong>简历原文要点：</strong>${esc(b.excerpt)}</p>`+qs.map(card).join('')}
   $('cards').innerHTML=currentResults.length?html:html+empty;
   $('modeHint').textContent=`${c.label} · 按简历分块 · 表达 → 专业 → 应变`;
  }
 }
 if(state.view!=='resume'||!candById(state.cand))$('blockTabs').hidden=true;
 const noCards=!$('cards').querySelector('details.answer-wrap');
 $('expandButton').disabled=state.interview||noCards;$('collapseButton').disabled=state.interview||noCards;
 updatePrint();$('cards').scrollTop=resetScroll?0:previousScroll;
}

function closeMenu(){$('sidebar').classList.remove('open');$('overlay').classList.remove('open');$('menuButton').setAttribute('aria-expanded','false')}
function setView(view){if(view==='resume'&&!CANDS.length&&!DATA.locked)return;state.view=view;state.page=1;closeMenu();render()}
function navigate(value){
 if(state.view==='pool'){state.category=Number(value);state.page=1}
 else if(state.view==='resume'){if(value==='back'){state.cand=null;state.block=''}else if(value.startsWith('cand:')){state.cand=value.slice(5);state.block=''}else state.block=value}
 else{const el=$(value);if(el)el.scrollIntoView({behavior:'smooth',block:'start'});closeMenu();return}
 closeMenu();render();
}
document.querySelector('.view-switch').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b&&!b.disabled)setView(b.dataset.view)});
$('blockTabs').addEventListener('click',e=>{const b=e.target.closest('[data-block]');if(!b)return;state.block=b.dataset.block;render()});
window.addEventListener('hashchange',()=>{readHash();render()});
$('cards').addEventListener('submit',async e=>{
 if(e.target.id!=='unlockForm')return;e.preventDefault();
 const password=$('unlockInput').value;if(!password)return;
 unlocking=true;unlockError='';render(false);
 try{await unlock(password,$('unlockRemember')?.checked??true);unlocking=false;readHash();render();notify('简历板块已解锁',{description:`${CANDS.length} 份简历 · 仅在本机解密`})}
 catch(err){unlocking=false;unlockError='密码不正确，请重试。';render(false)}
});
$('categoryNav').addEventListener('click',e=>{const b=e.target.closest('[data-nav]');if(b)navigate(b.dataset.nav)});
$('mobileCategory').addEventListener('change',e=>navigate(e.target.value));
$('searchInput').addEventListener('input',e=>{state.search=e.target.value;state.page=1;render()});
$('clearSearch').addEventListener('click',()=>{state.search='';$('searchInput').value='';state.page=1;render();$('searchInput').focus()});
$('dimFilter').addEventListener('click',e=>{const b=e.target.closest('[data-dim]');if(!b)return;const d=b.dataset.dim;state.dims.has(d)?state.dims.delete(d):state.dims.add(d);state.page=1;render()});
for(const [id,key] of [['codeFilter','coding'],['originFilter','origin'],['favoriteFilter','favorites'],['unlearnedFilter','unlearned'],['interviewButton','interview']])$(id).addEventListener('click',()=>{state[key]=!state[key];state.page=1;render()});

$('cards').addEventListener('click',async e=>{
 if(e.target.closest('[data-lock]')){try{localStorage.removeItem(PASS_KEY)}catch(err){}location.reload();return}
 const open=e.target.closest('[data-open-cand]');
 if(open){state.cand=open.dataset.openCand;state.block='';render();return}
 const jump=e.target.closest('[data-pool-jump]');
 if(jump){Object.assign(state,{view:'pool',category:-1,search:jump.dataset.poolJump,coding:false,origin:false,favorites:false,unlearned:false,page:1});state.dims.clear();$('searchInput').value=state.search;render();return}
 const copy=e.target.closest('[data-copy]'),download=e.target.closest('[data-code-download]');
 if(copy||download){const q=items.get(copy?copy.dataset.copy:download.dataset.codeDownload);if(!q?.code)return;if(copy){try{await copyText(q.code);notify('参考代码已复制',{description:`q${q.id}.py · Python 3.11+`})}catch(err){notify('浏览器限制复制，请使用下载 .py。')}}else{const url=URL.createObjectURL(new Blob([q.code],{type:'text/x-python;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`q${q.id}.py`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}return}
 const scoreBtn=e.target.closest('[data-score]');
 if(scoreBtn){const c=state.cand;scores[c]=scores[c]||{};const v=Number(scoreBtn.dataset.value);scores[c][scoreBtn.dataset.score]=scores[c][scoreBtn.dataset.score]===v?undefined:v;persist();render(false);return}
 const scoreCopy=e.target.closest('[data-score-copy]');
 if(scoreCopy){const c=CANDS.find(x=>x.id===scoreCopy.dataset.scoreCopy),sc=scores[c.id]||{};const asked=[...items.values()].filter(q=>q.kind==='resume'&&q.cand===c.id&&mastered.has(q.key));const text=[`${c.label}（${c.headline}）评估摘要`,...Object.entries(DIMS).map(([d,n])=>`${n}：${sc[d]??'未评'} / 4`),`已问简历题：${asked.length} 道${asked.length?'（'+asked.map(q=>q.key).join('、')+'）':''}`,`备注：${sc.note||'无'}`].join('\n');try{await copyText(text);notify('评估摘要已复制',{description:'可直接粘贴到面试反馈中'})}catch(err){notify('浏览器限制复制，请手动记录。')}return}
 const b=e.target.closest('[data-action]');if(!b)return;
 if(b.dataset.action==='reset'){Object.assign(state,{category:-1,block:'',search:'',favorites:false,unlearned:false,coding:false,origin:false,page:1});state.dims.clear();$('searchInput').value='';render();return}
 const id=b.dataset.id;const set=b.dataset.action==='save'?saved:mastered;const wasSelected=set.has(id);wasSelected?set.delete(id):set.add(id);persist();render(false);
 notify(b.dataset.action==='save'?(wasSelected?'已移出面试题单':'已加入面试题单'):(wasSelected?'已标记为未问':'已标记为已问'),{description:`${id.match(/^\d+$/)?'Q'+id.padStart(3,'0'):id} · ${b.dataset.action==='save'?'可在「面试题单」中集中查看':'记录仅保存在当前浏览器'}`,undo:()=>{wasSelected?set.add(id):set.delete(id);persist();render(false)}});
 const replacement=$('cards').querySelector(`[data-action="${b.dataset.action}"][data-id="${CSS.escape(id)}"]`);if(replacement)replacement.focus({preventScroll:true});
});
let noteTimer;
$('cards').addEventListener('input',e=>{const t=e.target.closest('[data-score-note]');if(!t)return;const c=t.dataset.scoreNote;scores[c]=scores[c]||{};scores[c].note=t.value;clearTimeout(noteTimer);noteTimer=setTimeout(persist,400)});
$('cards').addEventListener('toggle',e=>{if(e.target.matches('details.answer-wrap')){const id=e.target.dataset.id;if(e.target.open){openIds.add(id);closedIds.delete(id)}else{openIds.delete(id);closedIds.add(id)}}},true);
function setExpanded(value){document.querySelectorAll('#cards details.answer-wrap').forEach(el=>{el.open=value;const id=el.dataset.id;value?(openIds.add(id),closedIds.delete(id)):(openIds.delete(id),closedIds.add(id))})}
$('expandButton').addEventListener('click',()=>setExpanded(true));$('collapseButton').addEventListener('click',()=>setExpanded(false));
function page(delta){state.page+=delta;render()}$('prevButton').addEventListener('click',()=>page(-1));$('nextButton').addEventListener('click',()=>page(1));
$('randomButton').addEventListener('click',()=>{
 if(state.view==='method'||!currentResults.length){notify('当前没有题目，请先调整筛选。');return}
 const index=Math.floor(Math.random()*currentResults.length);const q=currentResults[index];
 if(state.view==='pool')state.page=Math.floor(index/perPage)+1;
 openIds.add(q.key);render();const target=$('q-'+q.key);
 $('cards').scrollTo({top:$('cards').scrollTop+target.getBoundingClientRect().top-$('cards').getBoundingClientRect().top,behavior:'smooth'});
 target.setAttribute('tabindex','-1');target.focus({preventScroll:true});notify(`已从当前结果中抽取 ${q.kind==='pool'?'Q'+String(q.id).padStart(3,'0'):q.key}`);
});

function printEntry(q){const label=q.kind==='pool'?String(q.id).padStart(3,'0'):q.key;const dims=q.dimList.map(d=>DIMS[d]).join('/');return `<article class="print-entry"><h3 class="print-q">${esc(label)} · [${esc(dims)}] ${esc(q.question)}</h3>${state.interview?'':`<p class="print-answer-label">${q.kind==='pool'?'参考答案要点':'考察要点'}</p><ol class="print-points">${q.points.map(p=>`<li>${esc(p)}</li>`).join('')}</ol><div class="print-follow"><strong>深挖追问：</strong>${esc(q.follow)}</div>${q.twist?`<div class="print-twist"><strong>情景变更：</strong>${esc(q.twist)}</div>`:''}${q.good||q.bad?`<div class="print-signals">${q.good?'高分信号：'+esc(q.good):''}${q.good&&q.bad?'；':''}${q.bad?'风险信号：'+esc(q.bad):''}</div>`:''}${q.kind==='pool'?sourceLinks(q):''}${q.code?`<p class="print-code-title">参考代码 · Python 3.11+</p><pre class="print-code">${q.codeHtml||esc(q.code)}</pre>`:''}`}</article>`}
function updatePrint(){
 if(state.view==='method'){$('printRoot').innerHTML=`<h1 class="print-title">面试评估方法</h1>`+$('methodView').innerHTML;return}
 if(state.view==='resume'){const c=candById(state.cand);if(!c){$('printRoot').innerHTML=`<h1 class="print-title">简历板块总览</h1>`+CANDS.map(x=>`<h2 class="print-category">${esc(x.label)} · ${esc(x.headline)}</h2><p>${esc(x.profile)}</p><ol class="print-points">${x.blocks.map(b=>`<li>${esc(b.name)}（${b.questions.length} 题）</li>`).join('')}</ol>`).join('');return}let html=`<h1 class="print-title">${esc(c.label)} · 简历专项面试题</h1><p class="print-meta">${esc(c.headline)} · ${currentResults.length} 道 · ${state.interview?'仅问题':'含要点、追问与情景变更'}</p><p>${esc(c.profile)}</p><h2 class="print-category">简历核实点</h2><ol class="print-points">${c.verify.map(v=>`<li>${esc(v.point)}（问法：${esc(v.ask)}）</li>`).join('')}</ol>`;for(const b of c.blocks){const qs=currentResults.filter(q=>q.block===b.id);if(!qs.length)continue;html+=`<h2 class="print-category">${esc(b.name)} ${esc(b.period||'')}</h2>`+qs.map(printEntry).join('')}$('printRoot').innerHTML=html;return}
 let last=-1;const desc=[state.category<0?'全部分类':DATA.categories[state.category],state.dims.size?'维度：'+[...state.dims].map(d=>DIMS[d]).join('/'):'',state.search?'关键词：'+state.search:'',state.favorites?'面试题单':'',state.unlearned?'仅未问':'',state.interview?'仅问题':'含答案、追问与情景变更'].filter(Boolean).join(' / ');
 $('printRoot').innerHTML=`<h1 class="print-title">Agent 工程师面试题库 · 通用题池</h1><p class="print-meta">${currentResults.length} 道 · ${esc(desc)}</p>`+currentResults.map(q=>{let heading='';if(q.category!==last){last=q.category;heading=`<h2 class="print-category">${esc(DATA.categories[last])}</h2>`}return heading+printEntry(q)}).join('');
}
$('printButton').addEventListener('click',()=>{updatePrint();window.print()});window.addEventListener('beforeprint',updatePrint);
$('menuButton').addEventListener('click',()=>{const open=$('sidebar').classList.toggle('open');$('overlay').classList.toggle('open',open);$('menuButton').setAttribute('aria-expanded',String(open))});$('overlay').addEventListener('click',closeMenu);
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();$('searchInput').focus();$('searchInput').select()}});
$('resetProgress').addEventListener('click',async()=>{if(await confirmAction({title:'清空本机面试记录？',description:`将移除全部 ${saved.size} 道备选题目、${mastered.size} 道已问标记和所有候选人打分。
题库内容不会删除。`,button:'清空记录',danger:true})){const prev={saved:[...saved],asked:[...mastered],scores:JSON.parse(JSON.stringify(scores))};saved.clear();mastered.clear();for(const k of Object.keys(scores))delete scores[k];persist();render();notify('本机面试记录已清空',{description:'题库内容保持完整。',undo:()=>{prev.saved.forEach(id=>saved.add(id));prev.asked.forEach(id=>mastered.add(id));Object.assign(scores,prev.scores);persist();render()}})}});
$('newRound').addEventListener('click',async()=>{if(await confirmAction({title:'开始下一场面试？',description:`清除全部 ${mastered.size} 道已问标记。
保留 ${saved.size} 道备选题目和已有打分记录。`,button:'开始新一场'})){const previous=[...mastered];mastered.clear();persist();render();notify('新一场面试已准备好',{description:'已问标记已清除，面试题单已保留。',undo:()=>{previous.forEach(id=>mastered.add(id));persist();render()}})}});
readHash();render();
{let remembered=null;try{remembered=localStorage.getItem(PASS_KEY)}catch(e){}
 if(DATA.locked&&remembered&&window.crypto?.subtle)unlock(remembered,true).then(()=>{readHash();render()}).catch(()=>{try{localStorage.removeItem(PASS_KEY)}catch(e){}});}
})();
