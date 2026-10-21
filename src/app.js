(() => {
'use strict';
const DATA=JSON.parse(document.getElementById('questionData').textContent);
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s).normalize('NFKC').toLocaleLowerCase().replace(/langraph/g,'langgraph');
const paths={search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z"/>',check:'<path d="m5 12 4 4L19 6"/>',circle:'<circle cx="12" cy="12" r="8"/>',eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',shuffle:'<path d="M3 5h3l12 14h3m-4-4 4 4-4 3M3 19h3l12-14h3m-4-3 4 3-4 4"/>',printer:'<path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7z"/>',download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',chevron:'<path d="m6 9 6 6 6-6"/>',play:'<path d="M7 5v14l11-7Z"/>',expand:'<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'};
const icon=n=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[n]}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
{const self=location.href.split('#')[0];if(/\.html?$/i.test(self)){$('downloadButton').href=self;$('downloadButton').download=decodeURIComponent(self.split('/').pop())}}
const DIMS={pro:'专业',exp:'表达',ext:'应变'};
const CN_KIND={skills:'专业技能',work:'工作经历'};

// ---------- 数据 ----------
// 通用题以数字字符串为 key；简历题内部 id 形如 C-p2-3（只用于保存记录），界面显示为「C · 项目2 · 第3题」。
const CANDS=[],items=new Map(),blockIndex=new Map(),haystacks=new Map();
const indexItem=q=>{items.set(q.key,q);haystacks.set(q.key,norm([q.question,...q.points,q.follow,q.twist||'',q.good||'',q.bad||'',q.kind==='pool'?DATA.categories[q.category]:blockIndex.get(q.block).block.name].join(' ')))};
for(const q of DATA.questions)indexItem({...q,key:String(q.id),kind:'pool',dim:q.dims[0]});
function addCandidates(list){for(const c of list){if(CANDS.some(x=>x.id===c.id))continue;CANDS.push(c);for(const b of c.blocks){blockIndex.set(b.id,{cand:c,block:b});for(const q of b.questions)indexItem({...q,key:q.id,kind:'resume',cand:c.id,block:b.id})}}}
addCandidates(DATA.candidates||[]);
const poolByOrigin=new Map(DATA.questions.filter(q=>q.origin?.question).map(q=>[q.origin.question,q.id]));
const candById=id=>CANDS.find(c=>c.id===id);
const projectNo=(c,b)=>c.blocks.filter(x=>x.kind==='project').indexOf(b)+1;
const blockShort=(c,b)=>b.kind==='project'?`项目${projectNo(c,b)}`:(CN_KIND[b.kind]||b.name);
function qLabel(q){if(q.kind==='pool')return `Q${String(q.id).padStart(3,'0')}`;const {cand,block}=blockIndex.get(q.block);return `${cand.id} · ${blockShort(cand,block)} · 第${block.questions.findIndex(x=>x.id===q.key)+1}题`}
const keyLabel=k=>items.has(k)?qLabel(items.get(k)):k;
const poolItems=[...items.values()];
const catCount=DATA.categories.map((_,i)=>DATA.questions.filter(q=>q.category===i).length);

// ---------- 本机记录 ----------
const STORAGE='agent-interviewer-v3',PASS_KEY='agent-interviewer-pass';let storageOk=true,initial={};
try{initial=JSON.parse(localStorage.getItem(STORAGE)||'null')||{}}catch(e){storageOk=false}
const keep=xs=>Array.isArray(xs)?xs.map(String).filter(k=>items.has(k)||/^[A-Z]+-/.test(k)):[];
const saved=new Set(keep(initial.saved)),asked=new Set(keep(initial.mastered));
const scores=initial.scores&&typeof initial.scores==='object'?initial.scores:{};
function persist(){try{localStorage.setItem(STORAGE,JSON.stringify({saved:[...saved],mastered:[...asked],scores}))}catch(e){storageOk=false}updateFoot()}

// ---------- 状态与地址 ----------
// tab：overview（概览）| all（全部题目）| 分块 id。
const state={view:'pool',category:-1,cand:null,tab:'overview',search:'',dim:'',favorites:false,unlearned:false,coding:false,origin:false,questionsOnly:false,page:1};
const perPage=20;let results=[];
function readHash(){
 const [view,a,b]=decodeURIComponent(location.hash.replace(/^#\/?/,'')).split('/');
 if(view==='method')state.view='method';
 else if(view==='pool'){state.view='pool';const n=Number(a);state.category=Number.isInteger(n)&&n>=0&&n<DATA.categories.length?n:-1}
 else if(view==='resume'&&(CANDS.length||DATA.locked)){state.view='resume';state.cand=candById(a)?a:null;state.tab=state.cand&&(b==='all'||blockIndex.get(b)?.cand.id===state.cand)?b:'overview'}
}
function writeHash(){
 if(state.view==='resume'&&!CANDS.length)return; // 未解锁时保留原地址，解锁后按它打开
 const parts=state.view==='pool'?['pool',...(state.category>=0?[state.category]:[])]:state.view==='resume'?['resume',...(state.cand?[state.cand,state.tab]:[])]:['method'];
 const hash='#/'+parts.map(encodeURIComponent).join('/');
 if(location.hash!==hash)history.replaceState(null,'',hash);
}

// ---------- 解锁（PBKDF2-SHA256 → AES-256-GCM，格式见 scripts/vault.py） ----------
let unlockError='',unlocking=false;
async function unlock(password,remember){
 const bytes=b=>Uint8Array.from(atob(b),ch=>ch.charCodeAt(0)),box=DATA.locked;
 const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
 const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(box.salt),iterations:box.iter,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['decrypt']);
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(box.iv)},key,bytes(box.ct));
 addCandidates(JSON.parse(new TextDecoder().decode(plain)));
 try{remember?localStorage.setItem(PASS_KEY,password):localStorage.removeItem(PASS_KEY)}catch(e){}
}

// ---------- 提示 ----------
let toastTimer,undoAction=null;
function notify(title,{desc='',undo=null}={}){clearTimeout(toastTimer);undoAction=undo;$('toastTitle').textContent=title;$('toastDesc').textContent=desc;$('toastDesc').hidden=!desc;$('toastUndo').hidden=!undo;$('toast').hidden=false;toastTimer=setTimeout(()=>{$('toast').hidden=true},undo?7000:4000)}
$('toastClose').onclick=()=>{$('toast').hidden=true};
$('toastUndo').onclick=()=>{const a=undoAction;$('toast').hidden=true;if(a){a();notify('已撤销')}};
let resolveDialog=null;
function confirmAction({title,description,button='确认',danger=false}){const d=$('confirmDialog');$('dialogTitle').textContent=title;$('dialogDescription').textContent=description;$('dialogConfirm').textContent=button;d.classList.toggle('danger',danger);d.returnValue='cancel';d.showModal();return new Promise(r=>{resolveDialog=r})}
$('dialogCancel').onclick=()=>$('confirmDialog').close('cancel');
$('dialogConfirm').onclick=()=>$('confirmDialog').close('confirm');
$('confirmDialog').addEventListener('close',()=>{const r=resolveDialog;resolveDialog=null;if(r)r($('confirmDialog').returnValue==='confirm')});

// ---------- 筛选 ----------
const tokens=()=>norm(state.search).trim().split(/\s+/).filter(Boolean);
function matches(q){
 if(state.dim&&q.dim!==state.dim)return false;
 if(state.favorites&&!saved.has(q.key))return false;
 if(state.unlearned&&asked.has(q.key))return false;
 return tokens().every(t=>q.kind==='pool'&&/^(?:#|q)?\d{1,3}$/.test(t)?q.id===Number(t.replace(/^[#q]/,'')):haystacks.get(q.key).includes(t));
}
const poolMatch=(q,anyCategory)=>q.kind==='pool'&&(!state.coding||q.code)&&(!state.origin||q.origin)&&(anyCategory||state.category<0||q.category===state.category)&&matches(q);
const resumeMatch=(q,anyBlock)=>q.kind==='resume'&&q.cand===state.cand&&(anyBlock||state.tab==='all'||q.block===state.tab)&&matches(q);
function highlight(text){let terms=state.search.trim().split(/\s+/).filter(t=>t&&!/^#?\d+$/.test(t));if(!terms.length)return esc(text);terms=[...new Set(terms)].sort((a,b)=>b.length-a.length);const re=new RegExp(terms.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'gi');let out='',last=0;for(const m of text.matchAll(re)){out+=esc(text.slice(last,m.index))+'<mark>'+esc(m[0])+'</mark>';last=m.index+m[0].length}return out+esc(text.slice(last))}

// ---------- 题卡 ----------
const openKeys=new Set(),closedKeys=new Set();
const dimChip=d=>`<span class="dim dim-${d}">${DIMS[d]}</span>`;
function answerBody(q,hl=highlight){
 const box=(cls,title,text)=>text?`<section class="q-box ${cls}"><h4>${title}</h4>${hl(text)}</section>`:'';
 const sources=q.sources?`<p class="q-note">参考资料：${q.sources.map(([n,u])=>`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(n)}</a>`).join(' · ')}</p>`:'';
 const code=q.code?`<details class="code"><summary>参考代码 · Python 3.11+</summary><div class="code-bar"><span>q${q.id}.py · 标准库 · 含可运行入口</span><span><button class="btn" data-copy="${q.key}">复制</button> <button class="btn" data-code-download="${q.key}">下载</button></span></div><pre class="code-block"><code>${q.codeHtml||esc(q.code)}</code></pre></details>`:'';
 return `<p class="q-label">${q.kind==='pool'?'参考要点':'好回答应覆盖'}</p><ol class="q-points">${q.points.map(p=>`<li>${hl(p)}</li>`).join('')}</ol><div class="q-grid">${box('follow','深挖追问',q.follow)}${box('twist','情景变更',q.twist)}</div>${q.good||q.bad?`<div class="q-grid">${box('good','高分信号',q.good)}${box('bad','风险信号',q.bad)}</div>`:''}${sources}${code}`;
}
function originTag(q){if(q.kind==='pool'){if(!q.origin)return '';const ref=blockIndex.get(q.origin.block);return `<span class="origin">源自简历${ref?' · '+esc(ref.cand.id)+' · '+esc(blockShort(ref.cand,ref.block)):''}</span>`}const id=poolByOrigin.get(q.key);return id?`<button class="pool-link" data-pool-jump="${id}">已沉淀 Q${String(id).padStart(3,'0')}</button>`:''}
function card(q){
 const open=openKeys.has(q.key)||(state.search.trim()&&!closedKeys.has(q.key));
 const where=q.kind==='pool'?DATA.categories[q.category]:'';
 return `<article class="q" id="q-${esc(q.key)}"><div class="q-head">${dimChip(q.dim)}<span class="q-no">${esc(qLabel(q))}</span>${where?`<span class="q-where">${esc(where)}</span>`:''}${originTag(q)}<span class="q-actions"><button data-focus="${esc(q.key)}" title="在面试模式中打开">${icon('expand')}<span>专注</span></button><button class="${asked.has(q.key)?'asked':''}" data-toggle="asked" data-key="${esc(q.key)}" aria-pressed="${asked.has(q.key)}">${icon('check')}<span>${asked.has(q.key)?'已问':'未问'}</span></button><button class="${saved.has(q.key)?'saved':''}" data-toggle="saved" data-key="${esc(q.key)}" aria-pressed="${saved.has(q.key)}" aria-label="${saved.has(q.key)?'移出题单':'加入题单'}">${icon('star')}</button></span></div><h3 class="q-title">${highlight(q.question)}</h3><details class="q-more" data-key="${esc(q.key)}" ${open?'open':''}><summary>${icon('chevron')}要点、追问与判分</summary><div class="q-body">${answerBody(q)}</div></details></article>`;
}

// ---------- 侧栏 ----------
const sideItem=(nav,active,name,n='',cls='',tag='')=>`<button class="side-item ${cls}${active?' active':''}" data-nav="${esc(nav)}" ${active?'aria-current="page"':''}>${tag?`<span class="tag">${esc(tag)}</span>`:''}<span class="name">${esc(name)}</span><span class="n">${n}</span></button>`;
function renderSide(){
 document.querySelectorAll('.views button').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
 $('poolCount').textContent=DATA.questions.length;$('resumeCount').textContent=CANDS.length||(DATA.locked?'加密':'');
 const nav=$('mobileNav');let side='',opts='';
 if(state.view==='pool'){
  const pool=poolItems.filter(q=>poolMatch(q,true)),count=i=>pool.filter(q=>q.category===i).length;
  $('sideTitle').textContent='按主题';side=sideItem(-1,state.category<0,'全部问题',pool.length);opts=`<option value="-1">全部问题 · ${pool.length}</option>`;
  for(const [group,ids] of DATA.groups){const live=ids.filter(i=>catCount[i]);if(!live.length)continue;side+=`<div class="side-group">${esc(group)}</div>`+live.map(i=>sideItem(i,state.category===i,DATA.categories[i],count(i))).join('');opts+=`<optgroup label="${esc(group)}">${live.map(i=>`<option value="${i}">${esc(DATA.categories[i])} · ${count(i)}</option>`).join('')}</optgroup>`}
  nav.innerHTML=opts;nav.value=String(state.category);
 }else if(state.view==='resume'){
  const c=candById(state.cand);
  if(!CANDS.length){$('sideTitle').textContent='简历板块已加密';nav.innerHTML='<option>输入密码后显示</option>'}
  else if(!c){$('sideTitle').textContent=`${CANDS.length} 份简历 · 每份一个板块`;side=CANDS.map(x=>sideItem('cand:'+x.id,false,`${x.label} · ${x.headline}`,x.blocks.reduce((n,b)=>n+b.questions.length,0))).join('');nav.innerHTML='<option value="">选择简历</option>'+CANDS.map(x=>`<option value="cand:${esc(x.id)}">${esc(x.label)} · ${esc(x.headline)}</option>`).join('');nav.value=''}
  else{
   const n=id=>c.blocks.find(b=>b.id===id).questions.filter(q=>matches(items.get(q.id))).length;
   $('sideTitle').textContent=`${c.label} · 按简历分块`;
   side=sideItem('back',false,'全部简历','','back','←')+sideItem('overview',state.tab==='overview','概览：画像、核实点、打分')+sideItem('all',state.tab==='all','全部题目',c.blocks.reduce((s,b)=>s+n(b.id),0))+'<div class="side-group">分块</div>'+c.blocks.map(b=>sideItem(b.id,state.tab===b.id,b.short||b.name,n(b.id),'',b.kind==='project'?blockShort(c,b):'')).join('');
   nav.innerHTML='<option value="back">← 全部简历</option><option value="overview">概览</option><option value="all">全部题目</option>'+c.blocks.map(b=>`<option value="${esc(b.id)}">${b.kind==='project'?esc(blockShort(c,b))+' · ':''}${esc(b.short||b.name)}</option>`).join('');nav.value=state.tab;
  }
 }else{
  const secs=[...document.querySelectorAll('#methodView section')];$('sideTitle').textContent='评估方法';
  side=secs.map(s=>sideItem('sec:'+s.id,false,s.querySelector('h3').textContent)).join('');
  nav.innerHTML=secs.map(s=>`<option value="sec:${s.id}">${esc(s.querySelector('h3').textContent)}</option>`).join('');
 }
 $('sideList').innerHTML=side;updateFoot();
}
function scopeKeys(){return state.view==='resume'?[...items.values()].filter(q=>q.kind==='resume'&&(!state.cand||q.cand===state.cand)).map(q=>q.key):poolItems.map(q=>q.key)}
function updateFoot(){const keys=scopeKeys(),n=keys.filter(k=>asked.has(k)).length;$('progressLabel').textContent=`${n} / ${keys.length}`;$('progressFill').style.width=`${keys.length?n/keys.length*100:0}%`;$('savedCount').textContent=keys.filter(k=>saved.has(k)).length;$('storageNote').textContent=storageOk?'记录仅保存在本机浏览器':'浏览器限制存储，记录可能不会保留'}

// ---------- 简历板块 ----------
function boardCard(c){const keys=c.blocks.flatMap(b=>b.questions.map(q=>q.id)),sc=scores[c.id]||{};return `<button class="board" data-open-cand="${esc(c.id)}"><span class="board-top"><span class="board-mark">${esc(c.id)}</span><span class="board-text"><strong>${esc(c.label)}</strong><em>${esc(c.headline)}</em></span></span><p>${esc(c.profile)}</p><span class="board-meta"><span>${c.blocks.length} 块 · ${keys.length} 题 · 已问 ${keys.filter(k=>asked.has(k)).length}</span><span>${Object.keys(DIMS).map(d=>`${DIMS[d]} ${sc[d]??'–'}`).join(' · ')}</span></span>${c.receivedAt?`<span class="board-meta"><span>${esc(c.source||'')}</span><span>收到 ${esc(c.receivedAt)}</span></span>`:''}</button>`}
function unlockPanel(){
 if(!window.crypto?.subtle)return `<div class="empty"><h3>当前浏览器无法解密</h3><p>请用 Chrome、Edge、Safari 或 Firefox 直接打开本文件，或通过 https 地址访问。</p></div>`;
 return `<form class="panel unlock" id="unlockForm"><h3>简历板块已加密</h3><p class="lead">通用题池和评估方法无需密码。输入密码后，简历内容只在本机浏览器中解密。</p><input type="password" id="unlockInput" placeholder="输入密码" autocomplete="current-password" aria-label="简历板块密码" ${unlocking?'disabled':''}><label><input type="checkbox" id="unlockRemember" checked>在本机记住密码，下次自动解锁</label><button class="btn primary" type="submit" ${unlocking?'disabled':''}>${unlocking?'正在解密…':'解锁'}</button>${unlockError?`<p class="error" role="alert">${esc(unlockError)}</p>`:''}</form>`;
}
function overview(c){
 const sc=scores[c.id]||{};
 const scale=d=>`<div class="scale" role="group" aria-label="${DIMS[d]}评分">${[1,2,3,4].map(n=>`<button data-score="${d}" data-value="${n}" class="${sc[d]===n?'on':''}" aria-pressed="${sc[d]===n}">${n}</button>`).join('')}</div>`;
 const left=`<div class="panel"><h3>画像</h3><p class="lead">${esc(c.profile)}</p></div><div class="panel"><h3>简历核实点 · 开场 5 分钟</h3><ul>${c.verify.map(v=>`<li>${esc(v.point)}<span class="ask">问法：${esc(v.ask)}</span></li>`).join('')}</ul></div><div class="panel"><h3>面试策略</h3><ul>${c.focus.map(f=>`<li>${esc(f)}</li>`).join('')}</ul></div>`;
 const right=`<div class="panel"><h3>本场打分</h3>${Object.keys(DIMS).map(d=>`<div class="score-row">${dimChip(d)}${scale(d)}</div>`).join('')}<textarea class="score-note" data-score-note="${esc(c.id)}" placeholder="关键回答、高分 / 风险信号、下一轮重点…">${esc(sc.note||'')}</textarea><div class="panel-actions"><button class="btn" data-score-copy="${esc(c.id)}">复制评估摘要</button></div></div><div class="panel"><h3>分块</h3><div class="block-list">${c.blocks.map(b=>`<button data-tab="${esc(b.id)}">${b.kind==='project'?esc(blockShort(c,b))+' · ':''}${esc(b.short||b.name)}<span>${b.questions.length} 题</span></button>`).join('')}</div></div>`;
 return `<div class="overview"><div>${left}</div><div>${right}</div></div>`;
}

// ---------- 渲染 ----------
function render(resetScroll=true){
 const prev=$('cards').scrollTop,method=state.view==='method';
 $('page').hidden=method;$('methodView').hidden=!method;renderSide();writeHash();
 if(method){updatePrint();return}
 const c=state.view==='resume'?candById(state.cand):null;
 const questionsView=state.view==='pool'||(c&&state.tab!=='overview');
 $('filters').hidden=!questionsView;$('pagination').hidden=state.view!=='pool';
 $('codeFilter').hidden=$('originFilter').hidden=state.view!=='pool';
 document.querySelectorAll('#dimFilter button').forEach(b=>b.classList.toggle('active',b.dataset.dim===state.dim));
 for(const [id,on] of [['favoriteFilter',state.favorites],['unlearnedFilter',state.unlearned],['interviewButton',state.questionsOnly],['codeFilter',state.coding],['originFilter',state.origin]]){$(id).classList.toggle('on',on);$(id).setAttribute('aria-pressed',String(on))}
 $('clearSearch').hidden=!state.search;$('cards').classList.toggle('questions-only',state.questionsOnly);
 const filterText=[state.dim&&DIMS[state.dim],state.search.trim()&&`搜索「${state.search.trim()}」`,state.favorites&&'题单',state.unlearned&&'未问',state.coding&&'编程题',state.origin&&'源自简历'].filter(Boolean).join(' · ');
 const empty=`<div class="empty"><h3>没有匹配的题目</h3><p>换个关键词或清除筛选。</p><button class="btn" data-reset>清除筛选</button></div>`;
 $('blockTabs').hidden=!c;$('mobileNav').classList.toggle('in-board',Boolean(c)); // 简历板块内由标签切换分块，手机端不再重复下拉
 if(state.view==='pool'){
  results=poolItems.filter(q=>poolMatch(q));
  const pages=Math.max(1,Math.ceil(results.length/perPage));state.page=Math.min(Math.max(1,state.page),pages);const start=(state.page-1)*perPage,visible=results.slice(start,start+perPage);
  $('pageTitle').textContent=state.category<0?'通用题池':DATA.categories[state.category];
  $('pageSub').textContent=`${results.length} 道题${filterText?' · '+filterText:''} · 每题含参考要点、深挖追问、情景变更与判分信号`;
  $('cards').innerHTML=visible.length?visible.map(card).join(''):empty;
  $('pageRange').textContent=visible.length?`第 ${start+1}–${start+visible.length} 道，共 ${results.length} 道`:'';$('pageLabel').textContent=`${state.page} / ${pages}`;$('prevButton').disabled=state.page<=1;$('nextButton').disabled=state.page>=pages;
 }else if(!CANDS.length){
  results=[];$('pageTitle').textContent='简历板块';$('pageSub').textContent='需要密码';$('cards').innerHTML=unlockPanel();setTimeout(()=>$('unlockInput')?.focus(),0);
 }else if(!c){
  results=[];$('pageTitle').textContent='简历板块';$('pageSub').textContent=`${CANDS.length} 份简历，每份一个独立板块；进入后按简历分块提问`;
  $('cards').innerHTML=`<div class="boards">${CANDS.map(boardCard).join('')}<div class="board add">新简历会追加为新的板块（E、F…），已有板块的记录和打分不受影响。${DATA.locked?'<button class="link" data-lock>锁定并忘记本机密码</button>':''}</div></div>`;
 }else{
  const n=b=>b.questions.filter(q=>matches(items.get(q.id))).length;
  $('blockTabs').innerHTML=`<button role="tab" data-tab="overview" class="${state.tab==='overview'?'active':''}">概览</button><button role="tab" data-tab="all" class="${state.tab==='all'?'active':''}">全部题目<small>${c.blocks.reduce((s,b)=>s+n(b),0)}</small></button>`+c.blocks.map(b=>`<button role="tab" data-tab="${esc(b.id)}" class="${state.tab===b.id?'active':''}" title="${esc(b.name)}">${esc(b.short||b.name)}<small>${n(b)}</small></button>`).join('');
  $('pageTitle').textContent=`${c.label} · ${c.headline}`;
  if(state.tab==='overview'){results=[...items.values()].filter(q=>resumeMatch(q,true));$('pageSub').textContent=`${c.source||''}${c.receivedAt?' · 收到 '+c.receivedAt:''} · ${c.blocks.length} 块 · ${results.length} 题`;$('cards').innerHTML=overview(c)}
  else{
   results=[...items.values()].filter(q=>resumeMatch(q));
   $('pageSub').textContent=`${results.length} 道题${filterText?' · '+filterText:''} · 块内顺序：表达 → 专业 → 应变`;
   let html='';for(const b of c.blocks){const qs=results.filter(q=>q.block===b.id);if(!qs.length)continue;html+=`<div class="block-head"><h2>${esc(blockShort(c,b))} · ${esc(b.name)}<span>${esc(b.period||'')}${b.period?' · ':''}${qs.length} 题</span></h2></div><p class="excerpt">${esc(b.excerpt)}</p>`+qs.map(card).join('')}
   $('cards').innerHTML=html||empty;
  }
 }
 updatePrint();$('cards').scrollTop=resetScroll?0:prev;
 $('blockTabs').querySelector('.active')?.scrollIntoView({block:'nearest',inline:'nearest'});
}

// ---------- 面试模式 ----------
let focusList=[],focusIndex=0;
function openFocus(key){
 focusList=results.length?results:[];
 if(!focusList.length){notify('当前没有题目',{desc:'请先选择分类或进入一个简历分块'});return}
 focusIndex=Math.max(0,key?focusList.findIndex(q=>q.key===key):0);$('focus').hidden=false;renderFocus(false);$('focusNext').focus();
}
function renderFocus(reveal){
 const q=focusList[focusIndex];if(!q)return;
 const where=q.kind==='pool'?DATA.categories[q.category]:blockIndex.get(q.block).block.short||blockIndex.get(q.block).block.name;
 $('focusMeta').textContent=`${qLabel(q)} · ${where}`;$('focusPos').textContent=`${focusIndex+1} / ${focusList.length}`;
 $('focusDim').innerHTML=dimChip(q.dim);$('focusQuestion').textContent=q.question;
 $('focusAnswer').innerHTML=answerBody(q,esc);$('focusAnswer').hidden=!reveal;$('focusReveal').firstChild.textContent=reveal?'隐藏要点 ':'显示要点 ';
 $('focusAsk').classList.toggle('done',asked.has(q.key));$('focusAsk').firstChild.textContent=asked.has(q.key)?'已问 ':'标记已问 ';
 $('focusPrev').disabled=focusIndex===0;$('focusNext').disabled=focusIndex>=focusList.length-1;
 document.querySelector('.focus-body').scrollTop=0;
}
function closeFocus(){$('focus').hidden=true;render(false)}
const focusMove=d=>{focusIndex=Math.min(Math.max(0,focusIndex+d),focusList.length-1);renderFocus(false)};
const focusToggleAsk=()=>{const k=focusList[focusIndex].key;asked.has(k)?asked.delete(k):asked.add(k);persist();renderFocus(!$('focusAnswer').hidden)};
$('focusButton').onclick=()=>openFocus();
$('focusClose').onclick=closeFocus;$('focusPrev').onclick=()=>focusMove(-1);$('focusNext').onclick=()=>focusMove(1);
$('focusReveal').onclick=()=>renderFocus($('focusAnswer').hidden);$('focusAsk').onclick=focusToggleAsk;

// ---------- 打印 ----------
function printEntry(q){return `<article><h3>${esc(qLabel(q))} · [${DIMS[q.dim]}] ${esc(q.question)}</h3>${state.questionsOnly?'':`<ol>${q.points.map(p=>`<li>${esc(p)}</li>`).join('')}</ol><div class="box">深挖追问：${esc(q.follow)}</div>${q.twist?`<div class="box">情景变更：${esc(q.twist)}</div>`:''}${q.good?`<div class="box">高分信号：${esc(q.good)}；风险信号：${esc(q.bad)}</div>`:''}${q.code?`<pre>${q.codeHtml||esc(q.code)}</pre>`:''}`}</article>`}
function updatePrint(){
 const root=$('printRoot');
 if(state.view==='method'){root.innerHTML='<h1>面试评估方法</h1>'+$('methodView').innerHTML;return}
 const c=state.view==='resume'?candById(state.cand):null;
 if(state.view==='resume'){
  if(!c){root.innerHTML='<h1>简历板块</h1>'+CANDS.map(x=>`<h2>${esc(x.label)} · ${esc(x.headline)}</h2><p>${esc(x.profile)}</p>`).join('');return}
  const qs=state.tab==='overview'?[...items.values()].filter(q=>resumeMatch(q,true)):results;
  root.innerHTML=`<h1>${esc(c.label)} · 简历面试题</h1><p class="meta">${esc(c.headline)} · ${qs.length} 道</p><h2>简历核实点</h2><ol>${c.verify.map(v=>`<li>${esc(v.point)}（问法：${esc(v.ask)}）</li>`).join('')}</ol>`+c.blocks.map(b=>{const list=qs.filter(q=>q.block===b.id);return list.length?`<h2>${esc(blockShort(c,b))} · ${esc(b.name)}</h2>`+list.map(printEntry).join(''):''}).join('');
  return;
 }
 let last=-1;root.innerHTML=`<h1>通用题池</h1><p class="meta">${results.length} 道${state.questionsOnly?' · 仅问题':''}</p>`+results.map(q=>{const h=q.category!==last?`<h2>${esc(DATA.categories[last=q.category])}</h2>`:'';return h+printEntry(q)}).join('');
}

// ---------- 事件 ----------
function closeMenu(){$('sidebar').classList.remove('open');$('overlay').classList.remove('open');$('menuButton').setAttribute('aria-expanded','false')}
function setView(v){if(v==='resume'&&!CANDS.length&&!DATA.locked)return;state.view=v;state.page=1;closeMenu();render()}
function navigate(value){
 value=String(value);
 if(value.startsWith('sec:')){$(value.slice(4))?.scrollIntoView({behavior:'smooth',block:'start'});closeMenu();return}
 if(state.view==='pool'){state.category=Number(value);state.page=1}
 else if(value==='back'){state.cand=null}
 else if(value.startsWith('cand:')){state.cand=value.slice(5);state.tab='overview'}
 else if(value)state.tab=value;
 closeMenu();render();
}
document.querySelector('.views').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b&&!b.disabled)setView(b.dataset.view)});
$('sideList').addEventListener('click',e=>{const b=e.target.closest('[data-nav]');if(b)navigate(b.dataset.nav)});
$('mobileNav').addEventListener('change',e=>navigate(e.target.value));
$('blockTabs').addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(b){state.tab=b.dataset.tab;render()}});
$('searchInput').addEventListener('input',e=>{state.search=e.target.value;state.page=1;if(state.view==='resume'&&state.cand&&state.tab==='overview')state.tab='all';render()});
$('clearSearch').onclick=()=>{state.search='';$('searchInput').value='';render();$('searchInput').focus()};
$('dimFilter').addEventListener('click',e=>{const b=e.target.closest('[data-dim]');if(b){state.dim=b.dataset.dim;state.page=1;render()}});
for(const [id,key] of [['favoriteFilter','favorites'],['unlearnedFilter','unlearned'],['interviewButton','questionsOnly'],['codeFilter','coding'],['originFilter','origin']])$(id).onclick=()=>{state[key]=!state[key];state.page=1;render()};
$('expandButton').onclick=()=>document.querySelectorAll('#cards details.q-more').forEach(d=>{d.open=true;openKeys.add(d.dataset.key);closedKeys.delete(d.dataset.key)});
$('collapseButton').onclick=()=>document.querySelectorAll('#cards details.q-more').forEach(d=>{d.open=false;openKeys.delete(d.dataset.key);closedKeys.add(d.dataset.key)});
$('prevButton').onclick=()=>{state.page--;render()};$('nextButton').onclick=()=>{state.page++;render()};
$('randomButton').onclick=()=>{
 if(!results.length||(state.view==='resume'&&state.tab==='overview')){notify('当前没有题目',{desc:'请先选择分类或进入一个简历分块'});return}
 const i=Math.floor(Math.random()*results.length),q=results[i];if(state.view==='pool')state.page=Math.floor(i/perPage)+1;
 openKeys.add(q.key);render();$('q-'+q.key).scrollIntoView({behavior:'smooth',block:'start'});notify(`抽到 ${qLabel(q)}`);
};
$('printButton').onclick=()=>{updatePrint();window.print()};window.addEventListener('beforeprint',updatePrint);
$('menuButton').onclick=()=>{const o=$('sidebar').classList.toggle('open');$('overlay').classList.toggle('open',o);$('menuButton').setAttribute('aria-expanded',String(o))};$('overlay').onclick=closeMenu;
window.addEventListener('hashchange',()=>{readHash();render()});
$('cards').addEventListener('toggle',e=>{if(e.target.matches('details.q-more')){const k=e.target.dataset.key;e.target.open?(openKeys.add(k),closedKeys.delete(k)):(openKeys.delete(k),closedKeys.add(k))}},true);
$('cards').addEventListener('submit',async e=>{
 if(e.target.id!=='unlockForm')return;e.preventDefault();const pw=$('unlockInput').value;if(!pw)return;
 unlocking=true;unlockError='';render(false);
 try{await unlock(pw,$('unlockRemember')?.checked??true);unlocking=false;readHash();render();notify('简历板块已解锁',{desc:`${CANDS.length} 份简历 · 仅在本机解密`})}
 catch(err){unlocking=false;unlockError='密码不正确，请重试。';render(false)}
});
let noteTimer;
$('cards').addEventListener('input',e=>{const t=e.target.closest('[data-score-note]');if(!t)return;const c=t.dataset.scoreNote;scores[c]={...scores[c],note:t.value};clearTimeout(noteTimer);noteTimer=setTimeout(persist,400)});
async function copyText(text){try{await navigator.clipboard.writeText(text)}catch(e){const a=document.createElement('textarea');a.value=text;a.style.position='fixed';a.style.opacity='0';document.body.appendChild(a);a.select();const ok=document.execCommand('copy');a.remove();if(!ok)throw e}}
$('cards').addEventListener('click',async e=>{
 const t=e.target;
 if(t.closest('[data-lock]')){try{localStorage.removeItem(PASS_KEY)}catch(err){}location.reload();return}
 const openC=t.closest('[data-open-cand]');if(openC){state.cand=openC.dataset.openCand;state.tab='overview';render();return}
 const tab=t.closest('[data-tab]');if(tab){state.tab=tab.dataset.tab;render();return}
 if(t.closest('[data-reset]')){Object.assign(state,{search:'',dim:'',favorites:false,unlearned:false,coding:false,origin:false,page:1});$('searchInput').value='';render();return}
 const jump=t.closest('[data-pool-jump]');if(jump){Object.assign(state,{view:'pool',category:-1,search:jump.dataset.poolJump,dim:'',coding:false,origin:false,favorites:false,unlearned:false,page:1});$('searchInput').value=state.search;render();return}
 const f=t.closest('[data-focus]');if(f){openFocus(f.dataset.focus);return}
 const copy=t.closest('[data-copy]'),dl=t.closest('[data-code-download]');
 if(copy||dl){const q=items.get(copy?copy.dataset.copy:dl.dataset.codeDownload);if(copy){try{await copyText(q.code);notify('代码已复制')}catch(err){notify('浏览器限制复制，请改用下载')}}else{const url=URL.createObjectURL(new Blob([q.code],{type:'text/x-python;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`q${q.id}.py`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}return}
 const s=t.closest('[data-score]');if(s){const c=state.cand,v=Number(s.dataset.value);scores[c]={...scores[c],[s.dataset.score]:scores[c]?.[s.dataset.score]===v?undefined:v};persist();render(false);return}
 const sc=t.closest('[data-score-copy]');if(sc){const c=candById(sc.dataset.scoreCopy),v=scores[c.id]||{},done=[...items.values()].filter(q=>q.kind==='resume'&&q.cand===c.id&&asked.has(q.key));const text=[`${c.label}（${c.headline}）评估摘要`,...Object.entries(DIMS).map(([d,n])=>`${n}：${v[d]??'未评'} / 4`),`已问 ${done.length} 题${done.length?'：'+done.map(qLabel).join('、'):''}`,`备注：${v.note||'无'}`].join('\n');try{await copyText(text);notify('评估摘要已复制',{desc:'可直接粘贴到面试反馈'})}catch(err){notify('浏览器限制复制，请手动记录')}return}
 const tg=t.closest('[data-toggle]');if(tg){const k=tg.dataset.key,set=tg.dataset.toggle==='saved'?saved:asked,was=set.has(k);was?set.delete(k):set.add(k);persist();render(false);notify(set===saved?(was?'已移出题单':'已加入题单'):(was?'已标为未问':'已标为已问'),{desc:keyLabel(k),undo:()=>{was?set.add(k):set.delete(k);persist();render(false)}})}
});
document.addEventListener('keydown',e=>{
 if(!$('focus').hidden){if(e.key==='Escape')closeFocus();else if(e.key==='ArrowRight')focusMove(1);else if(e.key==='ArrowLeft')focusMove(-1);else if(e.key===' '){e.preventDefault();renderFocus($('focusAnswer').hidden)}else if(e.key.toLowerCase()==='a')focusToggleAsk();return}
 if(e.key==='Escape')closeMenu();
 if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();$('searchInput').focus()}
});
$('resetProgress').onclick=async()=>{if(await confirmAction({title:'清空本机记录？',description:`将清除 ${saved.size} 道题单、${asked.size} 个已问标记和全部打分。\n题库本身不受影响。`,button:'清空',danger:true})){const prev={s:[...saved],a:[...asked],sc:JSON.parse(JSON.stringify(scores))};saved.clear();asked.clear();for(const k in scores)delete scores[k];persist();render();notify('本机记录已清空',{undo:()=>{prev.s.forEach(k=>saved.add(k));prev.a.forEach(k=>asked.add(k));Object.assign(scores,prev.sc);persist();render()}})}};
$('newRound').onclick=async()=>{if(await confirmAction({title:'开始下一场面试？',description:`清除 ${asked.size} 个已问标记，保留题单和打分。`,button:'开始'})){const prev=[...asked];asked.clear();persist();render();notify('已准备好下一场',{undo:()=>{prev.forEach(k=>asked.add(k));persist();render()}})}};

readHash();render();
{let pw=null;try{pw=localStorage.getItem(PASS_KEY)}catch(e){}
 if(DATA.locked&&pw&&window.crypto?.subtle)unlock(pw,true).then(()=>{readHash();render()}).catch(()=>{try{localStorage.removeItem(PASS_KEY)}catch(e){}});}
})();
