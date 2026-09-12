const $ = id => document.getElementById(id);
const names = {full: '完整图', head: '头部', upper: '腰上', knees: '膝盖以上', eyes_calf: '眼睛到小腿', lower: '下半身', manual: '手动'};
let state, sourceId, candidateId, box, workingImage, drag, visibleTags = [], selected = new Set(), loadingImage = 0, busy = false;
let job = {status: 'idle'}, handledJob, jobTimer;
let messageTimer;
const processing = () => busy || job.status === 'running';
const canvas = $('canvas'), ctx = canvas.getContext('2d');
const splitTags = value => [...new Set(value.split(',').map(t => t.trim().replaceAll('_', ' ')).filter(Boolean))];
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
  state = await response.json();
  const group = $('group').value; $('group').replaceChildren(new Option('全部', ''));
  [...new Set(Object.values(state.sources).filter(s => s.active).map(s => s.group))].sort().forEach(g => $('group').add(new Option(g, g)));
  $('group').value = group; $('dropTags').value = (state.drop_tags_override || state.config.drop_tags).join(', ');
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
  const unreviewed = samples.filter(c=>!c.tag_current || !c.tag?.reviewed).length;
  const tagging = !$('tagView').hidden;
  $('stageStatus').textContent = tagging ? `${samples.length} 份样本 · ${unreviewed} 份标签待确认` : pending ? `还有 ${pending} 个裁框待审（全部图片）` : ready ? `裁切审核完成 · ${samples.length} 份样本可打标` : '请先完成图片准备';
  $('startTag').textContent = job.status === 'running' && job.action === 'start_tag' ? '正在打标…' : job.status === 'failed' && job.action === 'start_tag' ? '重试打标' : untagged === 0 && samples.length ? '查看标签' : tagging ? '重新打标' : '开始打标';
  $('startTag').hidden = tagging && !untagged && job.status !== 'running' && job.status !== 'failed';
  $('startTag').classList.toggle('primary',!tagging);
  $('startTag').disabled = processing() || !ready;
  $('exportDataset').hidden = !tagging;
  $('exportDataset').disabled = processing() || !ready || !samples.length || unreviewed > 0;
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
      $('jobStatus').textContent=job.status==='failed'?`处理未完成，已保存成功项，可重试。\n${job.errors.join('\n')}`:job.action==='start_tag'?`打标完成，共 ${job.total} 份样本。请审核标签。`:`已导出 ${job.count} 组图片和标签至 ${state.config.output_dir}`;
      if(job.status==='complete'&&job.action==='start_tag')tab(true);
    }
    updateWorkflow();
  }catch(error){$('jobStatus').textContent=`${error.message}，正在重连；可用“刷新数据”核对已保存结果。`;}
  finally{jobTimer=setTimeout(pollJob,2000);}
}
$('startTag').onclick=()=>startJob('start_tag');
$('exportDataset').onclick=()=>startJob('export');
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
  const scrollTop=$('tagCards').scrollTop;
  visibleTags=[]; $('tagCards').replaceChildren();
  const has=splitTags($('hasTag').value),not=splitTags($('notTag').value);
  filteredSources().forEach(s=>s.candidates.forEach(c=>{
    if(c.status!=='accepted' || !c.tag || ($('kind').value && c.kind!==$('kind').value)) return;
    if($('unreviewed').checked && c.tag.reviewed && c.tag_current) return;
    if(!has.every(t=>c.tag.tags.includes(t)) || not.some(t=>c.tag.tags.includes(t)))return;
    visibleTags.push([s,c]); const k=key(s,c),card=node('article',undefined,`card${selected.has(k)?' selected':''}`);
    const label=node('label'),check=node('input');check.type='checkbox';check.checked=selected.has(k);check.disabled=!c.tag_current;check.dataset.selection=k;
    check.onchange=()=>{if(check.checked)selected.add(k);else selected.delete(k);renderTags();document.querySelector(`[data-selection="${CSS.escape(k)}"]`)?.focus({preventScroll:true});};
    label.append(check,node('span',`${names[c.kind]} · ${!c.tag_current?'标签过期':c.tag.reviewed?'已确认':'待确认'}`));card.append(label);
    const img=node('img');img.src=imageUrl(s,'tag',c);img.alt=`${s.relative} ${names[c.kind]}`;img.loading='lazy';img.width=260;img.height=210;
    const previewButton=node('button',undefined,'imageButton');previewButton.setAttribute('aria-label',`查看 ${img.alt}`);previewButton.append(img);previewButton.onclick=()=>{$('preview').querySelector('img').src=img.src;$('preview').showModal();};
    card.append(previewButton,node('p',s.relative,'filename'),node('p',c.tag.tags.join(', '),'caption'));
    if(c.tag.auto_removed.length)card.append(node('p',`${c.tag.restore_raw?'已恢复自动删除':'自动删除'}：${c.tag.auto_removed.join(', ')}`,'bad'));
    (c.tag.suggestions || []).forEach(note=>card.append(node('p',note,'bad')));
    const detail=node('details');detail.append(node('summary','原始标签与分数'),node('p',JSON.stringify(c.tag.scores)));card.append(detail);$('tagCards').append(card);
  }));
  $('visibleCount').textContent=`${visibleTags.length} 份样本`;
  if(!visibleTags.length)$('tagCards').append(node('p','暂无匹配样本。可调整左侧筛选，或在裁切审核完成后开始打标。','emptyState'));
  $('tagCards').scrollTop=scrollTop;
  renderFrequency();
}
function selections() {return [...selected].map(k=>k.split('/')).filter(([s,c])=>state.sources[s]?.active && state.sources[s].candidates.some(x=>x.id===c && x.tag_current && x.status==='accepted'));}
function renderFrequency(){
  const targets=selections(),counts=new Map(); targets.forEach(([s,c])=>state.sources[s].candidates.find(x=>x.id===c).tag.tags.forEach(t=>counts.set(t,(counts.get(t)||0)+1)));
  $('selectedCount').textContent=`已选 ${targets.length} 张`;$('frequencies').replaceChildren();
  const visible=new Set(visibleTags.map(([s,c])=>key(s,c))),outside=targets.filter(([s,c])=>!visible.has(`${s}/${c}`)).length;
  $('selectionHint').textContent=targets.length?`操作将应用到选中的 ${targets.length} 张图片${outside?`，其中 ${outside} 张不在当前筛选中`:''}。`:'先在中间选择图片。';
  [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).forEach(([t,n])=>{const b=node('button',`${t} · ${n}/${targets.length}`);b.onclick=()=>{$($('tagOperation').value==='replace'?'oldTag':'editTags').value=t;updateTagControls();};$('frequencies').append(b);});
  updateTagControls();
}
function updateTagControls(){
  const mode=$('tagOperation').value, empty=!state||!selections().length;
  $('tagInputGroup').hidden=mode==='replace';$('replaceInputs').hidden=mode!=='replace';
  $('applyTags').dataset.mode=mode;
  $('applyTags').textContent={add:'添加到选中图片',remove:'从选中图片删除',replace:'替换选中图片标签'}[mode];
  document.querySelectorAll('[data-mode]').forEach(b=>b.disabled=processing()||empty);
  $('applyTags').disabled=processing()||empty||(mode==='replace'?!$('oldTag').value.trim()||!$('newTag').value.trim():!splitTags($('editTags').value).length);
}
['tagOperation','editTags','oldTag','newTag'].forEach(id=>$(id).oninput=updateTagControls);
$('selectVisible').onclick=()=>{visibleTags.filter(([,c])=>c.tag_current).forEach(([s,c])=>selected.add(key(s,c)));renderTags();};
$('clearSelection').onclick=()=>{selected.clear();renderTags();};
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{const mode=button.dataset.mode;edit({action:'tags',selections:selections(),operation:{mode,tags:splitTags($('editTags').value),old:$('oldTag').value,new:$('newTag').value}});});
$('saveDrop').onclick=()=>edit({action:'drop_tags',tags:splitTags($('dropTags').value)});
['group','search'].forEach(id=>$(id).oninput=()=>{renderSources();renderTags();});
['kind','hasTag','notTag','unreviewed'].forEach(id=>$(id).oninput=renderTags);
$('resetTagFilters').onclick=()=>{['group','search','kind','hasTag','notTag'].forEach(id=>$(id).value='');$('unreviewed').checked=false;renderSources();renderTags();};
function tab(tags){
  $('cropView').hidden=tags;$('tagView').hidden=!tags;
  $('cropLibrary').hidden=tags;$('tagFilters').hidden=!tags;
  if(tags)document.body.classList.remove('focusCrop');
  $('focusCrop').textContent=document.body.classList.contains('focusCrop')?'退出专注':'专注裁切';
  $('focusCrop').setAttribute('aria-pressed',String(document.body.classList.contains('focusCrop')));
  ['cropTab','tagTab'].forEach((id,i)=>{const active=Boolean(i)===tags;$(id).classList.toggle('active',active);$(id).setAttribute('aria-selected',String(active));$(id).tabIndex=active?0:-1;});
  updateWorkflow();requestAnimationFrame(fitCanvas);
}
$('focusCrop').onclick=()=>{const focus=document.body.classList.toggle('focusCrop');$('focusCrop').textContent=focus?'退出专注':'专注裁切';$('focusCrop').setAttribute('aria-pressed',String(focus));requestAnimationFrame(fitCanvas);};
$('originalPreview').onclick=()=>{$('preview').querySelector('img').src=$('original').src;$('preview').showModal();};
$('cropTab').onclick=()=>tab(false);$('tagTab').onclick=()=>tab(true);$('refresh').onclick=()=>load().catch(e=>message(e.message,true));
document.querySelector('[role=tablist]').onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const tags=event.key==='End'||(event.key!=='Home'&&event.target.id==='cropTab');tab(tags);$(tags?'tagTab':'cropTab').focus();}};
$('closePreview').onclick=()=>$('preview').close();
load().then(pollJob).catch(error=>message(error.message,true));
