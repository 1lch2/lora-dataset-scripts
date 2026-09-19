/* Statistics only: this module never creates an image element or fetches image URLs. */
(() => {
  let report, baseline, timer, reportLoaded = false, page = 0;
  const labels = {brightness:'平均亮度',linear_luminance:'线性亮度',contrast:'对比度（亮度标准差）',highlights:'高光端占比 ≥98%',shadows:'暗部占比 ≤2%',channel_clip:'任一通道 ≥250/255',saturation:'平均饱和度',red_blue_bias:'红减蓝（色偏线索）',detail:'细节强度（相邻差分）',megapixels:'图片面积 / MP',aspect:'宽高比',center_brightness:'中心区域亮度',border_brightness:'外围区域亮度',person_area:'最大人物框面积占比',person_brightness:'最大人物框内亮度'};
  const fmt = value => Number.isFinite(value) ? value.toFixed(3) : '—';
  const pct = value => Number.isFinite(value) ? `${(100*value).toFixed(1)}%` : '—';
  const ratio = (n,d) => d ? pct(n/d) : '—';
  const api = async (url, data) => {
    const response = await fetch(url, data === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json','X-Review-Token':window.REVIEW_TOKEN},body:JSON.stringify(data)});
    const body = await response.json(); if(!response.ok) throw Error(body.error || '分析请求失败'); return body;
  };
  function analysisTab() {
    document.body.classList.add('analyzing');document.body.classList.remove('tagEditing','focusCrop');
    ['crop','tag','analysis'].forEach(name=>{const active=name==='analysis';$(name+'View').hidden=!active;const button=$(name+'Tab');button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
    poll();
  }
  $('analysisTab').onclick=analysisTab;
  if(window.ANALYSIS_ONLY || new URLSearchParams(location.search).has('analysis'))analysisTab();
  if(window.ANALYSIS_ONLY){$('cropTab').disabled=true;$('tagTab').disabled=true;}
  function histogram(target, values, edges, fraction=false){
    target.replaceChildren(); const max=Math.max(...values,0.0001);
    values.forEach((value,i)=>{const bar=node('div',undefined,'histogramBar');bar.style.height=`${100*value/max}%`;bar.title=`${fmt(edges[i])}–${fmt(edges[i+1])}：${fraction?pct(value):value+' 张'}`;bar.setAttribute('aria-label',bar.title);target.append(bar);});
    target.setAttribute('role','img');target.setAttribute('aria-label',values.map((v,i)=>`${fmt(edges[i])}至${fmt(edges[i+1])}：${fraction?pct(v):v}`).join('；'));
  }
  function pairs(title,rows,count,format){
    const detail=node('details');detail.append(node('summary',`${title} · ${count} ${rows.length<count?'（仅展示前 '+rows.length+' 项）':''}`));
    const list=node('ul');rows.forEach(row=>list.append(node('li',format(row))));detail.append(list);return detail;
  }
  function render(){
    $('analysisResults').hidden=false;
    $('analysisOverview').textContent=`发现 ${report.total} 张 · 成功 ${report.successful} · 失败 ${report.failed}。报告仅存本次服务会话，需保留请导出。`;
    $('analysisWarnings').replaceChildren(...report.warnings.map(w=>node('p',w,'bad')));
    if(baseline && JSON.stringify(report.settings)!==JSON.stringify(baseline.settings))$('analysisWarnings').append(node('p','对照报告的分析设置不同，尤其注意姿势覆盖率、抽样上限及阈值，不能直接比较相似对数。','bad'));
    histogram($('analysisPixelHistogram'),report.pixel_histogram,Array.from({length:33},(_,i)=>i/32),true);
    $('analysisMetrics').replaceChildren();
    Object.entries(labels).forEach(([key,label])=>{
      const metric=report.summary[key],other=baseline?.summary[key];
      const card=node('article',undefined,'metricCard');card.append(node('h3',label));
      if(metric?.count){
        card.append(node('strong',fmt(metric.mean)),node('p',`中位 ${fmt(metric.median)} · P05–P95 ${fmt(metric.p05)}–${fmt(metric.p95)} · n=${metric.count}`,'hint'));
        const chart=node('div',undefined,'histogram');histogram(chart,metric.histogram,metric.edges);card.append(chart);
      }else card.append(node('p','未统计 / 无有效样本','hint'));
      if(other?.count && metric?.count)card.append(node('p',`对照均值 ${fmt(other.mean)} · 差值 ${fmt(metric.mean-other.mean)}`));
      $('analysisMetrics').append(card);
    });
    const d=report.duplicates,p=report.pose;
    $('analysisSimilarity').textContent=`字节完全重复：${d.exact_groups.length} 组，多余副本 ${d.exact_extra} 张。近似比较样本 ${d.sampled}/${d.population} 张，${d.compared_pairs} 对；命中 ${d.near_count} 对、涉及 ${d.near_members} 张。${d.flat_excluded} 张低对比图不作近似判断。\n`+
      (p.enabled?`姿势：尝试 ${p.attempted} 张，检测到人物 ${p.detected} 张，可比较姿势 ${p.usable} 张（占成功图片 ${ratio(p.usable,report.successful)}）；抽样姿势 ${p.sampled} 张，有效比较 ${p.comparable_pairs} 对，重合 ${p.similar_pairs} 对（${ratio(p.similar_pairs,p.comparable_pairs)}），涉及 ${p.similar_images} 张。${p.error?'检测已中断：'+p.error:''}`:'人物/姿势分析未启用。');
    $('analysisPairs').replaceChildren(pairs('完全重复组',d.exact_groups.slice(0,200),d.exact_groups.length,r=>r.join(' ↔ ')),pairs('近似图片候选',d.near_pairs,d.near_count,r=>`${r.a} ↔ ${r.b} · 距离 ${r.distance}`),pairs('相似姿势候选',p.pairs,p.similar_pairs,r=>`${r.a} ↔ ${r.b} · 距离 ${fmt(r.distance)}`));
    $('analysisCaptionSection').hidden=!report.captions.enabled;
    $('analysisCaptionSummary').textContent=`可读取同名 TXT ${report.captions.read}/${report.successful}，${report.captions.tags.length} 个不同标签。频率按含该标签的图片数统计；只展示前 100 个。`;
    $('analysisCaptionTags').replaceChildren(...report.captions.tags.slice(0,100).map(([tag,n])=>node('span',`${tag} · ${n} (${ratio(n,report.captions.read)})`,'analysisTag')));
    $('analysisErrors').replaceChildren(...report.errors.map(e=>node('p',`${e.file} · ${e.error}`)));
    rows();
  }
  function rows(){
    if(!report)return;
    const key=$('analysisSort').value,order=$('analysisOrder').value==='asc'?1:-1,query=$('analysisSearch').value.toLowerCase();
    const filtered=report.records.filter(r=>r.file.toLowerCase().includes(query)).sort((a,b)=>{
      if(!Number.isFinite(a[key]))return Number.isFinite(b[key])?1:0;
      if(!Number.isFinite(b[key]))return -1;
      return order*(a[key]-b[key]);
    });
    const pages=Math.max(1,Math.ceil(filtered.length/100));page=Math.min(page,pages-1);
    const table=$('analysisTable');table.replaceChildren();const head=node('thead'),tr=node('tr');
    ['相对路径','尺寸','亮度','高光','暗部','对比','饱和','细节','人物占比','备注'].forEach(label=>{const th=node('th',label);th.scope='col';tr.append(th);});head.append(tr);table.append(head);const body=node('tbody');
    filtered.slice(page*100,(page+1)*100).forEach(r=>{const tr=node('tr');[r.file,`${r.width}×${r.height}`,fmt(r.brightness),pct(r.highlights),pct(r.shadows),fmt(r.contrast),fmt(r.saturation),fmt(r.detail),pct(r.person_area),[...r.flags,...(r.transparency?['透明图按中灰合成']:[])].join('；')].forEach(v=>tr.append(node('td',v)));body.append(tr);});table.append(body);
    $('analysisRowCount').textContent=`${filtered.length} 张匹配 · 第 ${page+1}/${pages} 页，每页 100 张；完整指标见 CSV。`;
    $('analysisPrev').disabled=page===0;$('analysisNext').disabled=page===pages-1;
  }
  async function poll(){
    clearTimeout(timer);
    try{
      const status=await api('/api/analysis/status'),running=status.status==='running';
      $('analysisStart').disabled=running;$('analysisCancel').disabled=!running;$('analysisProgress').hidden=!running;
      if(status.total){$('analysisProgress').max=status.total;$('analysisProgress').value=status.done;}else $('analysisProgress').removeAttribute('value');
      const phase={scan:'扫描目录',images:'计算逐图统计',similarity:'比较近似图片',poses:'比较姿势'}[status.phase]||'';
      $('analysisStatus').textContent=running?`${phase} · ${status.done||0}/${status.total||'…'}`:status.error||{idle:'等待选择目录',complete:'分析完成',cancelled:'已取消，未修改数据集',failed:'分析失败'}[status.status];
      if(status.status==='failed'&&status.log_path)$('analysisStatus').textContent+=` 本地诊断日志：${status.log_path}`;
      if(status.status==='complete'&&!reportLoaded){report=await api('/api/analysis/report');reportLoaded=true;page=0;render();}
      if(running)timer=setTimeout(poll,1000);
    }catch(error){$('analysisStatus').textContent=error.message+'；正在重连';timer=setTimeout(poll,3000);}
  }
  $('analysisForm').onsubmit=async event=>{
    event.preventDefault();$('analysisStart').disabled=true;
    try{
      await api('/api/analysis/start',{directory:$('analysisDirectory').value,recursive:$('analysisRecursive').checked,pose:$('analysisPose').checked,captions:$('analysisCaptions').checked,model_cache:$('analysisCache').value,pair_limit:Number($('analysisLimit').value),pose_threshold:Number($('analysisPoseThreshold').value),hash_threshold:Number($('analysisHashThreshold').value)});
      reportLoaded=false;report=undefined;$('analysisResults').hidden=true;poll();
    }catch(error){$('analysisStatus').textContent=error.message;$('analysisStart').disabled=false;}
  };
  $('analysisCancel').onclick=async()=>{try{await api('/api/analysis/cancel',{});poll();}catch(error){$('analysisStatus').textContent=error.message;}};
  function download(content,type,name){const url=URL.createObjectURL(new Blob([content],{type})),link=node('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('analysisJson').onclick=()=>download(JSON.stringify(report,null,2),'application/json','dataset-analysis.json');
  $('analysisCsv').onclick=async()=>{try{const response=await fetch('/api/analysis/csv');if(!response.ok)throw Error('CSV 导出失败');download('\uFEFF'+await response.text(),'text/csv;charset=utf-8','dataset-analysis.csv');}catch(error){$('analysisStatus').textContent=error.message;}};
  $('analysisBaseline').onchange=async event=>{try{
    const file=event.target.files[0];if(!file)return;if(file.size>50*1024*1024)throw Error('对照报告超过 50 MiB');
    const data=JSON.parse(await file.text());if(data.schema_version!==1||!data.summary||typeof data.summary!=='object')throw Error('不是支持的数据集分析报告');
    baseline=data;$('analysisClearBaseline').hidden=false;render();
  }catch(error){$('analysisStatus').textContent=error.message;}};
  $('analysisClearBaseline').onclick=()=>{baseline=undefined;$('analysisBaseline').value='';$('analysisClearBaseline').hidden=true;render();};
  ['analysisSearch','analysisSort','analysisOrder'].forEach(id=>$(id).oninput=()=>{page=0;rows();});
  $('analysisPrev').onclick=()=>{page--;rows();};$('analysisNext').onclick=()=>{page++;rows();};
})();
