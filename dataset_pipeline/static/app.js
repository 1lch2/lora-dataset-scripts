const $ = id => document.getElementById(id);
const names = {full: '完整图', head: '头部', upper: '腰上', knees: '膝盖以上', eyes_calf: '眼睛到小腿', lower: '下半身', manual: '手动'};
let state, sourceId, candidateId, box, workingImage, drag, visibleTags = [], selected = new Set(), loadingImage = 0, busy = false;
let job = {status: 'idle'}, handledJob, jobTimer;
let messageTimer;
let singleTagKey;
let imageFilter = null, imageBasket = new Set();
const clickedIncludeTags = new Set();
const datasetFilters = document.querySelector('.libraryPanel > .filters');
$('filterToolPanel').append($('tagFilters'));
const processing = () => busy || job.status === 'running';
const canvas = $('canvas'), ctx = canvas.getContext('2d');
const splitTags = value => [...new Set(value.split(/[,\r\n]+/).map(t => t.trim().replaceAll('_', ' ')).filter(Boolean))];
const tagContains = (tag, term) => tag.replaceAll('_', ' ').toLowerCase().includes(term.toLowerCase());
function message(text, error = false) {
  clearTimeout(messageTimer);
  $('message').textContent = text; $('message').className = error ? 'error' : '';
  $('notification').hidden = !text;
  if (text && !error && text !== '处理中…') messageTimer = setTimeout(()=>{$('notification').hidden=true;},6000);
}
$('dismissMessage').onclick=()=>message('');
function source() { return state?.sources[sourceId]; }
function candidate() { return source()?.candidates.find(c => c.id === candidateId); }
function imageUrl(s, kind, c) { return `/image?source=${encodeURIComponent(s.id)}&kind=${kind}&candidate=${encodeURIComponent(c?.id || '')}&v=${state.updated_at}`; }
function node(tag, text, cls) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; }
async function load() {
  const response = await fetch('/api/state'); if (!response.ok) throw Error('无法读取运行状态');
  const firstLoad = !state;
  state = await response.json();
  const group = $('group').value; $('group').replaceChildren(new Option('全部', ''));
  [...new Set(Object.values(state.sources).filter(s => s.active).map(s => s.group))].sort().forEach(g => $('group').add(new Option(g, g)));
  $('group').value = firstLoad ? ($('group').options[1]?.value || '') : group; $('dropTags').value = (state.drop_tags_override || state.config.drop_tags).join(', ');
  $('summary').textContent = `${Object.values(state.sources).filter(s => s.active).length} 张源图`;
  $('summary').title = state.config.run_dir;
  renderSources(); renderTags(); updateWorkflow();
}
function updateWorkflow() {
  if (!state) return;
  const sources = Object.values(state.sources).filter(s => s.active);
  const pending = sources.reduce((n,s)=>n+s.candidates.filter(c=>c.status==='pending').length,0);
  const samples = sources.flatMap(s=>s.candidates.filter(c=>c.status==='accepted'));
  const ready = sources.length > 0 && !pending && !sources.some(s=>s.error);
  const untagged = samples.filter(c=>!c.tag_current).length;
  const tagging = !$('tagView').hidden;
  $('stageStatus').textContent = tagging ? `${samples.length} 份样本 · ${untagged} 份待打标` : pending ? `还有 ${pending} 个裁框待审（全部图片）` : ready ? `裁切审核完成 · ${samples.length} 份样本可打标` : '请先完成图片准备';
  $('startTag').textContent = job.status === 'running' && job.action === 'start_tag' ? '正在打标…' : job.status === 'failed' && job.action === 'start_tag' ? '重试打标' : untagged === 0 && samples.length ? '查看标签' : tagging ? '重新打标' : '开始打标';
  $('startTag').hidden = tagging && !untagged && job.status !== 'running' && job.status !== 'failed';
  $('startTag').classList.toggle('primary',!tagging);
  $('startTag').disabled = processing() || !ready;
  $('exportDataset').hidden = !tagging;
  $('exportDataset').disabled = false;
  ['newCrop','saveDrop','setScale','setPerson'].forEach(id=>$(id).disabled=processing());
  updateTagControls();
  updateDimensions();
}
async function startJob(action) {
  if (processing()) return;
  // The visible draft must not silently be replaced by the saved crop during tagging.
  if (action === 'start_tag' && box && (!candidate()?.box || box.some((v,i)=>v!==candidate().box[i]))) {
    message('当前裁框尚未保存，请先保存并审核，再开始打标。', true); return;
  }
  if (action === 'start_tag' && Object.values(state.sources).filter(s=>s.active).every(s=>s.candidates.every(c=>c.status!=='accepted'||c.tag_current)) && job.status !== 'failed') { tab(true); return; }
  busy = true; updateWorkflow();
  try {
    const response = await fetch('/api/edit', {method:'POST',headers:{'Content-Type':'application/json','X-Review-Token':window.REVIEW_TOKEN},body:JSON.stringify({action})});
    const result = await response.json(); if (!response.ok) throw Error(result.error);
    job = {status:'running',action}; message('');
  } catch(error) { message(error.message,true); }
  finally { busy=false; updateWorkflow(); }
  await pollJob();
}
async function pollJob() {
  clearTimeout(jobTimer);
  try {
    const response=await fetch('/api/job'); if(!response.ok)throw Error('无法读取后台任务状态');
    job=await response.json();
    $('jobProgress').hidden=job.status!=='running'||job.action!=='start_tag';
    $('jobProgress').max=Math.max(job.total,1);$('jobProgress').value=job.done;
    $('jobStatus').className=job.status==='failed'?'error':'';
    if(job.status==='running') $('jobStatus').textContent=job.action==='start_tag'?`已打标 ${job.done} / ${job.total} 份（含已完成缓存）。正在裁切、缩放和打标，可刷新页面查看进度。`:'正在导出训练集…';
    if(job.id!==handledJob && ['complete','failed'].includes(job.status) && !busy){
      await load(); handledJob=job.id;
      $('jobStatus').textContent=job.status==='failed'?`处理未完成，已保存成功项，可重试。\n${job.errors.join('\n')}`:job.action==='start_tag'?`打标完成，共 ${job.total} 份样本。可编辑标签并导出训练集。`:`已导出 ${job.count} 组图片和标签至 ${state.config.output_dir}`;
      if(job.status==='complete'&&job.action==='start_tag'&&!document.body.classList.contains('analyzing'))tab(true);
    }
    updateWorkflow();
  }catch(error){$('jobStatus').textContent=`${error.message}，正在重连；可用“刷新数据”核对已保存结果。`;}
  finally{jobTimer=setTimeout(pollJob,2000);}
}
$('startTag').onclick=()=>startJob('start_tag');
$('exportDataset').onclick=()=>startJob('export');
$('openWorkdir').onclick=async()=>{
  try {
    const response=await fetch('/api/edit',{method:'POST',headers:{'Content-Type':'application/json','X-Review-Token':window.REVIEW_TOKEN},body:JSON.stringify({action:'open_workdir'})});
    const result=await response.json(); if(!response.ok)throw Error(result.error);
  }catch(error){message(error.message,true);}
};
async function edit(data, advance = false) {
  if (processing()) return;
  busy = true;
  const previousSource = sourceId, previousCandidate = candidateId;
  message('处理中…'); document.querySelectorAll('button').forEach(b => b.disabled = true);
  try {
    const response = await fetch('/api/edit', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Review-Token': window.REVIEW_TOKEN}, body: JSON.stringify(data)});
    const result = await response.json(); if (!response.ok) throw Error(result.error);
    if (result.result.id) candidateId = result.result.id;
    await load();
    if (advance) advanceReview(previousSource, previousCandidate, data.status === 'rejected' ? '已拒绝' : '已接受');
    else message(data.action === 'crop' ? '裁框已保存，尚待接受或拒绝' : '已保存');
  } catch (error) { message(error.message, true); }
  finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); updateWorkflow(); }
}
function advanceReview(previousSource, previousCandidate, result) {
  const s = state.sources[previousSource], crops = s.candidates;
  const index = crops.findIndex(c => c.id === previousCandidate);
  const next = [...crops.slice(index + 1), ...crops.slice(0, index + 1)].find(c => c.status === 'pending');
  if (next) {
    sourceId = previousSource; candidateId = next.id; renderSources();
    message(`${result}，已切换到「${names[next.kind]}」。本图还剩 ${crops.filter(c => c.status === 'pending').length} 个待审裁框。`);
  } else {
    const list = filteredSources(), sourceIndex = list.findIndex(s => s.id === previousSource);
    const nextSource = [...list.slice(sourceIndex + 1), ...list.slice(0, sourceIndex)].find(s => !s.error && s.candidates.some(c => c.status === 'pending'));
    if (nextSource) {
      sourceId = nextSource.id; candidateId = undefined; renderSources();
      message(`「${s.relative}」裁切审核完成。已进入下一张：${nextSource.relative}`);
    } else {
      const remaining = Object.values(state.sources).some(s => s.active && (s.error || s.candidates.some(c => c.status === 'pending')));
      message(`「${s.relative}」裁切审核完成。${remaining ? '当前筛选范围内没有可继续审核的裁框，请检查其他图片或处理失败项。' : '全部图片裁切审核完成，可以开始打标。'}`);
    }
  }
  $('sources').querySelector('.active')?.scrollIntoView({block: 'nearest'});
}
function filteredSources() { return Object.values(state.sources).filter(s => s.active && (!$('group').value || s.group === $('group').value) && s.relative.toLowerCase().includes($('search').value.toLowerCase())); }
function renderSources() {
  const list = filteredSources(); $('sources').replaceChildren();
  $('sourceProgress').textContent = `${list.filter(s => !s.error && !s.candidates.some(c => c.status === 'pending')).length} / ${list.length} 张已完成`;
  if (!list.some(s => s.id === sourceId)) sourceId = list[0]?.id;
  list.forEach(s => {
    const pending = s.candidates.filter(c => c.status === 'pending').length;
    const button = node('button', undefined, s.id === sourceId ? 'active' : '');
    button.append(node('span', s.relative), node('span', s.error ? '处理失败' : `${pending ? `待审 ${pending} 个裁框` : '✓ 裁切已完成'} · ${s.scale}×`, `sourceMeta${!pending && !s.error ? ' complete' : ''}`));
    button.onclick = () => { sourceId = s.id; candidateId = undefined; renderSources(); }; $('sources').append(button);
  }); renderEditor();
}
function renderEditor() {
  if(document.body.classList.contains('analyzing'))return;
  const s = source(); $('cropView').querySelector('.editor').hidden = !s; if (!s) return;
  $('sourceName').textContent = `${s.group} / ${s.relative}`;
  $('sourceName').title = $('sourceName').textContent;
  $('notes').textContent = s.error || (s.notes || []).join('；'); $('scale').value = String(s.scale || 1);
  $('person').replaceChildren(); (s.detection?.persons || []).forEach((p, i) => $('person').add(new Option(`人物 ${i + 1} (${p.score.toFixed(2)})`, i)));
  if (s.person_index !== undefined) $('person').value = s.person_index;
  if (!s.candidates.some(c => c.id === candidateId)) candidateId = s.candidates.find(c => c.status === 'pending')?.id || s.candidates.find(c => c.box)?.id || 'full';
  const total = s.candidates.filter(c => c.box).length, pending = s.candidates.filter(c => c.status === 'pending').length;
  $('cropProgress').textContent = pending ? `${total - pending} / ${total} 个已处理 · 剩余 ${pending} 个` : '✓ 本图裁切审核完成';
  $('candidates').replaceChildren(); s.candidates.forEach(c => {
    const label = [c.kind,...(c.aliases||[])].map(k=>names[k]).join(' / ');
    const button = node('button', `${label} · ${c.kind === 'full' ? '固定保留' : {pending:'待审',accepted:'已接受',rejected:'已拒绝'}[c.status]}`, c.id === candidateId ? 'active' : '');
    button.dataset.candidate = c.id;
    button.onclick = () => { candidateId = c.id; box = c.box ? [...c.box] : null; renderEditor(); }; $('candidates').append(button);
  });
  box = candidate()?.box ? [...candidate().box] : null; syncFields();
  const serial = ++loadingImage;
  workingImage = null; ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!s.working) return;
  $('original').src = imageUrl(s, 'original');
  const img = new Image();
  img.onload = () => { if (serial !== loadingImage) return; workingImage = img; canvas.width = img.width; canvas.height = img.height; fitCanvas(); };
  img.src = imageUrl(s, 'working');
}
function syncFields() { updateDimensions(); }
function updateDimensions() {
  const w = box ? Math.abs(Math.round(box[2]) - Math.round(box[0])) : 0, h = box ? Math.abs(Math.round(box[3]) - Math.round(box[1])) : 0;
  const enough = box && w * h >= state.config.min_area, full = candidate()?.kind === 'full';
  $('dimensions').textContent = box ? `${w} × ${h} · ${(w * h).toLocaleString()} 像素` : full ? '完整原图 · 固定保留' : '在工作图上拖出矩形';
  $('areaStatus').textContent = box ? enough ? '✓ 达到像素下限' : `不足 ${state.config.min_area.toLocaleString()} 像素，请扩大裁框` : '';
  $('areaStatus').className = box && !enough ? 'bad' : '';
  $('newCrop').classList.toggle('active', candidateId === null);
  $('saveCrop').disabled = processing() || !box || full;
  $('acceptCrop').disabled = processing() || !enough || full;
  $('rejectCrop').disabled = processing() || !candidate() || full;
  $('acceptSource').disabled = processing() || !source()?.candidates.some(c => c.status === 'pending');
}
function draw() {
  if (!workingImage) return;
  ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(workingImage,0,0);
  if (!box) return;
  const [x0,y0,x1,y1] = box, scale = canvas.width / Math.max(canvas.getBoundingClientRect().width,1);
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.rect(0,0,canvas.width,canvas.height); ctx.rect(x0,y0,x1-x0,y1-y0); ctx.fill('evenodd');
  ctx.strokeStyle = '#53c582'; ctx.lineWidth = 2 * scale; ctx.strokeRect(x0,y0,x1-x0,y1-y0);
  ctx.fillStyle = '#ffffff'; [[x0,y0],[x1,y0],[x1,y1],[x0,y1]].forEach(([x,y]) => ctx.fillRect(x-4*scale,y-4*scale,8*scale,8*scale));
}
function fitCanvas() {
  if (!workingImage || $('cropView').hidden) return;
  const stage=$('canvasStage'), ratio=Math.min(stage.clientWidth/canvas.width,stage.clientHeight/canvas.height);
  canvas.style.width=`${Math.max(1,Math.floor(canvas.width*ratio))}px`;
  canvas.style.height=`${Math.max(1,Math.floor(canvas.height*ratio))}px`;
  draw();
}
new ResizeObserver(fitCanvas).observe($('canvasStage'));
function point(event) { const r = canvas.getBoundingClientRect(); return [(event.clientX-r.left)*canvas.width/r.width, (event.clientY-r.top)*canvas.height/r.height]; }
canvas.onpointerdown = event => {
  if (processing() || !workingImage || candidate()?.kind === 'full') return;
  const p = point(event), tolerance = 12 * canvas.width / canvas.getBoundingClientRect().width;
  let corner = -1; if (box) corner = [[box[0],box[1]],[box[2],box[1]],[box[2],box[3]],[box[0],box[3]]].findIndex(q => Math.hypot(q[0]-p[0],q[1]-p[1]) < tolerance);
  const moving = box && p[0] > box[0] && p[0] < box[2] && p[1] > box[1] && p[1] < box[3];
  drag = {p, before: box && [...box], mode: corner >= 0 ? 'corner' : moving ? 'move' : 'new', corner};
  canvas.setPointerCapture(event.pointerId);
};
canvas.onpointermove = event => {
  if (!drag) return;
  const p = point(event).map((v,i) => Math.max(0,Math.min(v,i===0?canvas.width:canvas.height)));
  if (drag.mode === 'new') box = [Math.min(p[0],drag.p[0]),Math.min(p[1],drag.p[1]),Math.max(p[0],drag.p[0]),Math.max(p[1],drag.p[1])];
  else if (drag.mode === 'move') {
    const b=drag.before, dx=Math.max(-b[0],Math.min(p[0]-drag.p[0],canvas.width-b[2])),dy=Math.max(-b[1],Math.min(p[1]-drag.p[1],canvas.height-b[3]));
    box=[b[0]+dx,b[1]+dy,b[2]+dx,b[3]+dy];
  } else { box=[...drag.before]; const xi=[0,2,2,0][drag.corner],yi=[1,1,3,3][drag.corner]; box[xi]=p[0];box[yi]=p[1]; }
  syncFields(); draw();
};
canvas.onpointerup = () => { drag=null; if(box){box=[Math.min(box[0],box[2]),Math.min(box[1],box[3]),Math.max(box[0],box[2]),Math.max(box[1],box[3])].map(Math.round);syncFields();draw();} };
$('newCrop').onclick = () => {candidateId=null;box=null;$('candidates').querySelectorAll('button').forEach(b=>b.classList.remove('active'));syncFields();draw();message('新建裁框：在工作图上拖出矩形，尺寸达到下限后即可接受。');};
function saveCrop(status) { if(!box) return message('请先画出裁框',true); edit({action:'crop',source:sourceId,candidate:candidateId,box,status}, status === 'accepted'); }
$('saveCrop').onclick=()=>saveCrop('pending'); $('acceptCrop').onclick=()=>saveCrop('accepted');
$('rejectCrop').onclick=()=>candidateId && edit({action:'crop',source:sourceId,candidate:candidateId,status:'rejected'}, true);
$('acceptSource').onclick=()=>edit({action:'accept_source',source:sourceId}, true);
$('setScale').onclick=()=>edit({action:'scale',source:sourceId,scale:Number($('scale').value)});
$('setPerson').onclick=()=>edit({action:'person',source:sourceId,index:Number($('person').value)});
function key(s,c) {return `${s.id}/${c.id}`;}
function renderTags() {
  if(document.body.classList.contains('analyzing'))return;
  invalidatePreview();
  const scrollTop=$('tagCards').scrollTop;
  visibleTags=[]; $('tagCards').replaceChildren();
  const has=splitTags($('hasTag').value),not=splitTags($('notTag').value);
  filteredSources().forEach(s=>s.candidates.forEach(c=>{
    if(c.status!=='accepted' || !c.tag || ($('kind').value && c.kind!==$('kind').value)) return;
    if(imageFilter!==null&&!imageFilter.has(key(s,c)))return;
    const matches=terms=>terms.map(t=>c.tag.tags.some(tag=>tagContains(tag,t)));
    if(has.length && !($('hasLogic').value==='all'?matches(has).every(Boolean):matches(has).some(Boolean)))return;
    if(not.length && ($('notLogic').value==='all'?matches(not).every(Boolean):matches(not).some(Boolean)))return;
    visibleTags.push([s,c]); const k=key(s,c),card=node('article',undefined,`card${selected.has(k)?' selected':''}${singleTagKey===k?' focused':''}`);
    const status=c.tag_current?'标签已生成':'标签过期';
    card.title=`${s.relative} · ${names[c.kind]} · ${status}`;
    const check=node('input');check.type='checkbox';check.checked=selected.has(k);check.disabled=!c.tag_current;check.dataset.selection=k;check.setAttribute('aria-label',`批量选择 ${s.relative} ${names[c.kind]}`);
    check.onchange=()=>{if(check.checked)selected.add(k);else selected.delete(k);renderTags();document.querySelector(`[data-selection="${CSS.escape(k)}"]`)?.focus({preventScroll:true});};
    const img=node('img');img.src=imageUrl(s,'tag',c);img.alt=`${s.relative} ${names[c.kind]}`;img.loading='lazy';img.width=140;img.height=140;
    const thumbnail=node('button',undefined,'imageButton');thumbnail.setAttribute('aria-label',`选择 ${img.alt}`);thumbnail.setAttribute('aria-pressed',String(singleTagKey===k));thumbnail.append(img);
    thumbnail.onclick=()=>{if(singleTagKey===k)clearFocusedTag();else openSingle(s,c);renderTags();};
    card.append(thumbnail,check);$('tagCards').append(card);
  }));
  if(singleTagKey&&!visibleTags.some(([s,c])=>key(s,c)===singleTagKey))clearFocusedTag();
  $('visibleCount').textContent=`${visibleTags.length} 份样本`;
  if(!visibleTags.length)$('tagCards').append(node('p','暂无匹配样本。可切换到“标签筛选”调整条件，或在裁切审核完成后开始打标。','emptyState'));
  $('tagCards').scrollTop=scrollTop;
  renderFrequency();
  renderVocabulary();
  renderImageBasket();
}
function allTagImages(){return Object.values(state.sources).filter(s=>s.active).flatMap(s=>s.candidates.filter(c=>c.status==='accepted'&&c.tag).map(c=>[s,c]));}
function renderImageBasket(){
  const images=allTagImages(),valid=new Set(images.map(([s,c])=>key(s,c)));
  imageBasket=new Set([...imageBasket].filter(k=>valid.has(k)));
  $('imageFilterStatus').textContent=`待过滤 ${imageBasket.size} 张 · ${imageFilter===null?'未启用':`已启用 ${[...imageFilter].filter(k=>valid.has(k)).length} 张`}`;
  $('selectionToolTab').textContent=imageFilter===null?'图片过滤':`图片过滤 (${[...imageFilter].filter(k=>valid.has(k)).length})`;
  $('imageFilterBasket').replaceChildren();
  images.filter(([s,c])=>imageBasket.has(key(s,c))).forEach(([s,c])=>{
    const b=node('button',undefined,'imageButton'),img=node('img');img.src=imageUrl(s,'tag',c);img.alt=`${s.relative} ${names[c.kind]}`;img.loading='lazy';b.setAttribute('aria-label',`移出过滤 ${img.alt}`);b.append(img);
    b.onclick=()=>{imageBasket.delete(key(s,c));renderImageBasket();};$('imageFilterBasket').append(b);
  });
}
$('filterChecked').onclick=()=>{selections().forEach(pair=>imageBasket.add(pair.join('/')));renderImageBasket();};
$('filterVisible').onclick=()=>{visibleTags.forEach(([s,c])=>imageBasket.add(key(s,c)));renderImageBasket();};
$('invertImageFilter').onclick=()=>{imageBasket=new Set(allTagImages().map(([s,c])=>key(s,c)).filter(k=>!imageBasket.has(k)));renderImageBasket();};
$('clearImageBasket').onclick=()=>{imageBasket.clear();renderImageBasket();};
$('applyImageFilter').onclick=()=>{imageFilter=new Set(imageBasket);renderTags();};
$('resetImageFilter').onclick=()=>{imageFilter=null;renderTags();};
function selections() {return [...selected].map(k=>k.split('/')).filter(([s,c])=>state.sources[s]?.active && state.sources[s].candidates.some(x=>x.id===c && x.tag_current && x.status==='accepted'));}
function editTargets(){return $('editScope').value==='filtered'?visibleTags.filter(([,c])=>c.tag_current).map(([s,c])=>[s.id,c.id]):selections();}
function sortedCounts(counts,by,order){return [...counts].sort((a,b)=>{
  const alpha=a[0].localeCompare(b[0],'en');
  const difference=by==='frequency'?a[1]-b[1]:by==='length'?a[0].length-b[0].length:alpha;
  return (order==='desc'?-difference:difference)||alpha;
});}
function baseTagCounts(){
  const counts=new Map();
  filteredSources().forEach(s=>s.candidates.forEach(c=>{
    if(c.status!=='accepted'||!c.tag||($('kind').value&&c.kind!==$('kind').value))return;
    if(imageFilter!==null&&!imageFilter.has(key(s,c)))return;
    new Set(c.tag.tags).forEach(t=>counts.set(t,(counts.get(t)||0)+1));
  }));
  return counts;
}
function tagSearchMatcher(query,mode,errorId){
  $(errorId).textContent='';
  if(!query)return ()=>true;
  try{
    if(mode==='regex'){const regex=new RegExp(query,'i');return t=>regex.test(t);}
    const text=query.replaceAll('_',' ').toLowerCase();
    return t=>{t=t.toLowerCase();return mode==='prefix'?t.startsWith(text):mode==='suffix'?t.endsWith(text):mode==='exact'?t===text:t.includes(text);};
  }catch(error){$(errorId).textContent=`正则表达式无效：${error.message}`;return ()=>false;}
}
function renderVocabulary(){
  const counts=baseTagCounts();
  const focused=visibleTags.find(([s,c])=>key(s,c)===singleTagKey);
  const focusedTags=focused?new Set(focused[1].tag.tags):null;
  $('tagFocusName').textContent=focused?`${focused[0].relative} · ${names[focused[1].kind]}`:'全部图片的标签';
  $('showAllTags').hidden=!focused;
  $('viewFocusedImage').hidden=!focused;
  const query=$('tagSearch').value.trim(),mode=$('tagSearchMode').value;
  const match=tagSearchMatcher(query,mode,'tagSearchError');
  const positive=splitTags($('hasTag').value),negative=splitTags($('notTag').value);
  const tags=sortedCounts(counts,$('tagSort').value,$('tagOrder').value).filter(([t])=>(!focusedTags||focusedTags.has(t))&&match(t)&&(!positive.length||positive.some(term=>tagContains(t,term))));
  $('vocabularyCount').textContent=`${tags.length} / ${focusedTags?focusedTags.size:counts.size}`;$('tagVocabulary').replaceChildren();
  tags.forEach(([t,n])=>{
    const row=node('div',undefined,'tagChoice'),include=tagChip(t,n);
    include.classList.toggle('active',clickedIncludeTags.has(t));
    include.setAttribute('aria-pressed',String(clickedIncludeTags.has(t)));include.onclick=()=>toggleFilterTag('hasTag',t);
    const exclude=node('button','−',negative.includes(t)?'active':'');exclude.setAttribute('aria-label',`排除 ${t}`);exclude.setAttribute('aria-pressed',String(negative.includes(t)));exclude.onclick=()=>toggleFilterTag('notTag',t);
    row.append(include,exclude);$('tagVocabulary').append(row);
  });
}
function toggleFilterTag(id,tag){
  const tags=splitTags($(id).value),remove=id==='hasTag'?clickedIncludeTags.has(tag):tags.includes(tag);
  if(id==='hasTag'){if(remove)clickedIncludeTags.delete(tag);else clickedIncludeTags.add(tag);}
  $(id).value=(remove?tags.filter(t=>t!==tag):[...new Set([...tags,tag])]).join(', ');renderTags();
}
function tagChip(text,count){
  const button=node('button',undefined,'tagChip'),label=node('span',text,'tagText');
  button.append(label);
  if(count!==null)button.append(node('span',`[${count}]`,'tagCount'));
  return button;
}
function renderFrequency(){
  const targets=editTargets(),counts=baseTagCounts();
  $('selectedCount').textContent=`目标 ${targets.length} 张`;$('frequencies').replaceChildren();
  const visible=new Set(visibleTags.map(([s,c])=>key(s,c))),outside=targets.filter(([s,c])=>!visible.has(`${s}/${c}`)).length;
  $('selectionHint').textContent=targets.length?`将应用到${$('editScope').value==='filtered'?'当前筛选中可编辑的':'勾选的'} ${targets.length} 张图片${outside?`，其中 ${outside} 张不在当前筛选中`:''}。`:'没有可编辑目标。请勾选图片或切换操作范围；过期标签须重新打标。';
  const common=new Map();targets.forEach(([s,c])=>new Set(state.sources[s].candidates.find(x=>x.id===c).tag.tags).forEach(t=>common.set(t,(common.get(t)||0)+1)));
  $('commonTags').textContent=`共同标签：${[...common].filter(([,n])=>n===targets.length).map(([t])=>t).join(', ')||'无'}`;
  const match=tagSearchMatcher($('frequencySearch').value.trim(),$('frequencySearchMode').value,'frequencySearchError');
  const positive=splitTags($('hasTag').value),negative=splitTags($('notTag').value),removals=splitTags($('editTags').value),removing=$('tagOperation').value==='remove';
  sortedCounts(counts,$('frequencySort').value,$('frequencyOrder').value).filter(([t])=>match(t)&&(!positive.length||positive.some(term=>tagContains(t,term)))).forEach(([t,n])=>{
    const row=node('div',undefined,'tagChoice'),include=tagChip(t,n);
    include.dataset.tag=t;include.classList.toggle('active',clickedIncludeTags.has(t));include.setAttribute('aria-pressed',String(clickedIncludeTags.has(t)));
    include.onclick=()=>toggleFilterTag('hasTag',t);row.append(include);
    const marked=removing?removals.includes(t):negative.includes(t);
    const secondary=node('button','−',marked?'active':'');secondary.type='button';secondary.setAttribute('aria-label',`${removing?'选择待删除标签':'排除'} ${t}`);secondary.setAttribute('aria-pressed',String(marked));
    if(removing){
      secondary.onclick=()=>{const tags=splitTags($('editTags').value);$('editTags').value=(tags.includes(t)?tags.filter(x=>x!==t):[...tags,t]).join(', ');invalidatePreview();renderFrequency();};
    }else secondary.onclick=()=>toggleFilterTag('notTag',t);
    row.append(secondary);
    $('frequencies').append(row);
  });
  updateTagControls();
}
function updateTagControls(){
  const mode=$('tagOperation').value, empty=!state||!editTargets().length;
  $('tagInputGroup').hidden=!['add','remove'].includes(mode);$('replaceInputs').hidden=mode!=='replace';
  $('matchInputs').hidden=mode!=='match';$('sortInputs').hidden=mode!=='sort';$('prependGroup').hidden=mode!=='add';
  $('tagInputLabel').textContent=mode==='remove'?'待删除标签':'添加标签／触发词';
  $('applyTags').dataset.mode=mode;
  $('applyTags').textContent={add:'应用添加',remove:'删除操作范围内选中的标签',replace:'应用替换',match:'应用搜索替换',sort:'应用标签排序'}[mode];
  document.querySelectorAll('[data-mode]').forEach(b=>b.disabled=processing()||empty);
  $('dedupeTags').disabled=processing()||empty;
  $('applyTags').disabled=processing()||empty||(mode==='replace'?!$('oldTag').value.trim()||!$('newTag').value.trim():mode==='match'?!$('matchSearch').value.trim():mode==='sort'?false:!splitTags($('editTags').value).length);
  $('previewTags').disabled=$('applyTags').disabled;
  $('removeSelectionActions').hidden=mode!=='remove';
  $('batchTagHint').textContent=mode==='remove'?'点击标签筛选左侧图片；点击 − 选择待删除标签。':'点击标签筛选左侧图片；点击 − 排除包含该标签的图片。';
  const [s,c]=(singleTagKey||'').split('/');$('saveSingle').disabled=processing()||!state?.sources[s]?.candidates.some(x=>x.id===c&&x.tag_current&&x.status==='accepted');
}
function invalidatePreview(){$('batchPreview').hidden=true;}
function batchOperation(){const mode=$('tagOperation').value;return {mode,tags:splitTags($('editTags').value),old:$('oldTag').value,new:mode==='match'?$('matchReplacement').value:$('newTag').value,search:$('matchSearch').value,match:$('matchMode').value,case_sensitive:$('matchCase').checked,prepend:$('prependTags').checked,by:$('captionSort').value,order:$('captionOrder').value};}
['tagOperation','editTags','oldTag','newTag','matchSearch','matchReplacement','matchMode','matchCase','prependTags','captionSort','captionOrder'].forEach(id=>$(id).oninput=()=>{invalidatePreview();updateTagControls();});
$('editScope').onchange=()=>{invalidatePreview();renderFrequency();};
['frequencySort','frequencyOrder','frequencySearchMode'].forEach(id=>$(id).onchange=renderFrequency);
$('frequencySearch').oninput=renderFrequency;
$('editTags').oninput=()=>{invalidatePreview();renderFrequency();};
$('chooseRemovalTags').onclick=()=>{const shown=[...$('frequencies').querySelectorAll('[data-tag]')].map(b=>b.dataset.tag);$('editTags').value=[...new Set([...splitTags($('editTags').value),...shown])].join(', ');invalidatePreview();renderFrequency();};
$('clearRemovalTags').onclick=()=>{$('editTags').value='';invalidatePreview();renderFrequency();};
$('dedupeTags').onclick=()=>{invalidatePreview();edit({action:'tags',selections:editTargets(),operation:{mode:'dedupe'}});};
function batchTab(button){$('tagOperation').value=button.dataset.operation;document.querySelectorAll('[data-operation]').forEach(b=>{const active=b===button;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;b.classList.toggle('active',active);});invalidatePreview();renderFrequency();}
document.querySelectorAll('[data-operation]').forEach(b=>b.onclick=()=>batchTab(b));
$('batchTabs').onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const buttons=[...$('batchTabs').children],i=buttons.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowRight'?1:buttons.length-1))%buttons.length;batchTab(buttons[next]);buttons[next].focus();}};
$('selectVisible').onclick=()=>{visibleTags.filter(([,c])=>c.tag_current).forEach(([s,c])=>selected.add(key(s,c)));renderTags();};
$('clearSelection').onclick=()=>{selected.clear();clearFocusedTag();renderTags();};
$('tagCards').onkeydown=event=>{if(event.key==='Escape'){clearFocusedTag();renderTags();$('tagCards').focus();}};
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{const mode=button.dataset.mode;invalidatePreview();edit({action:'tags',selections:editTargets(),operation:button.id==='applyTags'?batchOperation():{mode}});});
$('previewTags').onclick=async()=>{
  const operation=batchOperation(),targets=editTargets();$('previewTags').disabled=true;
  try{
    const response=await fetch('/api/edit',{method:'POST',headers:{'Content-Type':'application/json','X-Review-Token':window.REVIEW_TOKEN},body:JSON.stringify({action:'preview_tags',selections:targets,operation})});
    const data=await response.json();if(!response.ok)throw Error(data.error);
    if(JSON.stringify(operation)!==JSON.stringify(batchOperation())||JSON.stringify(targets)!==JSON.stringify(editTargets()))return;
    const preview=$('batchPreview');preview.replaceChildren(node('strong',`${data.result.total} 张目标中，${data.result.changed} 张将改变（尚未保存）`));
    data.result.examples.forEach(row=>{const detail=node('details');detail.append(node('summary',row.name),node('p',`修改前：${row.before.join(', ')}`),node('p',`修改后：${row.after.join(', ')}`));preview.append(detail);});
    preview.hidden=false;
  }catch(error){message(error.message,true);}finally{updateTagControls();}
};
$('saveDrop').onclick=()=>edit({action:'drop_tags',tags:splitTags($('dropTags').value)});
['group','search'].forEach(id=>$(id).oninput=()=>{renderSources();renderTags();});
['kind','hasTag','notTag','hasLogic','notLogic'].forEach(id=>$(id).oninput=()=>{invalidatePreview();renderTags();});
$('hasTag').oninput=()=>{clickedIncludeTags.clear();renderTags();};
['tagSearch','tagSearchMode','tagSort','tagOrder'].forEach(id=>$(id).oninput=renderVocabulary);
$('resetTagFilters').onclick=()=>{imageFilter=null;clickedIncludeTags.clear();['group','search','kind','hasTag','notTag','tagSearch'].forEach(id=>$(id).value='');$('hasLogic').value='all';$('notLogic').value='any';invalidatePreview();renderSources();renderTags();};
const tagToolNames=['filter','selection','batch','single'];
function tagTool(name){tagToolNames.forEach(n=>{const active=n===name;$(n+'ToolPanel').hidden=!active;const b=$(n+'ToolTab');b.setAttribute('aria-selected',String(active));b.classList.toggle('active',active);b.tabIndex=active?0:-1;});}
tagToolNames.forEach(name=>$(name+'ToolTab').onclick=()=>tagTool(name));
document.querySelector('.tagToolTabs').onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const names=tagToolNames,index=names.findIndex(n=>$(n+'ToolTab')===document.activeElement),next=event.key==='Home'?0:event.key==='End'?names.length-1:(index+(event.key==='ArrowRight'?1:names.length-1))%names.length;tagTool(names[next]);$(names[next]+'ToolTab').focus();}};
function openSingle(s,c){singleTagKey=key(s,c);$('singleName').textContent=`${s.relative} · ${names[c.kind]}`;$('singleCaption').value=c.tag.tags.join(', ');$('singlePreview').src=imageUrl(s,'tag',c);$('singlePreview').hidden=false;
  $('singleNotes').textContent=[...(c.tag.auto_removed.length?[`${c.tag.restore_raw?'已恢复自动删除':'自动删除'}：${c.tag.auto_removed.join(', ')}`]:[]),...(c.tag.suggestions||[])].join('\n');updateTagControls();}
function clearFocusedTag(){singleTagKey=undefined;$('singleName').textContent='';$('singleCaption').value='';$('singlePreview').hidden=true;$('singleNotes').textContent='';}
$('showAllTags').onclick=()=>{clearFocusedTag();renderTags();};
$('viewFocusedImage').onclick=()=>{$('preview').querySelector('img').src=$('singlePreview').src;$('preview').showModal();};
$('saveSingle').onclick=()=>{if(singleTagKey)edit({action:'tags',selections:[singleTagKey.split('/')],operation:{mode:'set',tags:splitTags($('singleCaption').value)}});};
function tab(tags){
  $('analysisView').hidden=true;document.body.classList.remove('analyzing');
  $('analysisTab').classList.remove('active');$('analysisTab').setAttribute('aria-selected','false');$('analysisTab').tabIndex=-1;
  $('cropView').hidden=tags;$('tagView').hidden=!tags;
  $('cropLibrary').hidden=tags;$('tagFilters').hidden=!tags;
  document.body.classList.toggle('tagEditing',tags);
  if(tags)$('tagDatasetFilters').append(datasetFilters);else document.querySelector('.libraryPanel').prepend(datasetFilters);
  if(tags)document.body.classList.remove('focusCrop');
  $('focusCrop').textContent=document.body.classList.contains('focusCrop')?'退出专注':'专注裁切';
  $('focusCrop').setAttribute('aria-pressed',String(document.body.classList.contains('focusCrop')));
  ['cropTab','tagTab'].forEach((id,i)=>{const active=Boolean(i)===tags;$(id).classList.toggle('active',active);$(id).setAttribute('aria-selected',String(active));$(id).tabIndex=active?0:-1;});
  updateWorkflow();requestAnimationFrame(fitCanvas);
  if(!state && !window.ANALYSIS_ONLY)load().then(pollJob).catch(error=>message(error.message,true));
  else if(state){renderSources();renderTags();}
}
$('focusCrop').onclick=()=>{const focus=document.body.classList.toggle('focusCrop');$('focusCrop').textContent=focus?'退出专注':'专注裁切';$('focusCrop').setAttribute('aria-pressed',String(focus));requestAnimationFrame(fitCanvas);};
$('originalPreview').onclick=()=>{$('preview').querySelector('img').src=$('original').src;$('preview').showModal();};
$('cropTab').onclick=()=>tab(false);$('tagTab').onclick=()=>tab(true);$('refresh').onclick=()=>load().catch(e=>message(e.message,true));
document.querySelector('[role=tablist]').onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const tabs=[...document.querySelectorAll('.tabs [role=tab]')].filter(b=>!b.disabled),i=tabs.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(i+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length;tabs[next].click();tabs[next].focus();}};
$('closePreview').onclick=()=>$('preview').close();
if(!window.ANALYSIS_ONLY && !new URLSearchParams(location.search).has('analysis'))load().then(pollJob).catch(error=>message(error.message,true));
