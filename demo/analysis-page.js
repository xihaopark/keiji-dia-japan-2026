const viewableReports = () => currentTasks('summary').filter(task =>
  task.status === 'completed' || task.live_artifacts?.['report.html']
    || task.live_artifacts?.['data_summary_report.Rmd']
    || (['cancelled', 'failed', 'needs_input', 'interrupted'].includes(task.status)
      && (task.draft || task.report_binding_error)));

function reportArtifactName(taskId) {
  const task = currentTasks().find(value => value.id === taskId);
  if (task?.kind === 'erqc') return 'data_quality_summary.md';
  if (task?.result?.artifacts?.some(item => item.name === 'report.html')
      || task?.artifact_manifest?.some(item => item.path === 'outputs/report.html')) return 'report.html';
  return task?.status !== 'completed' && !task?.live_artifacts?.['report.html']
    && task?.live_artifacts?.['data_summary_report.Rmd'] ? 'data_summary_report.Rmd' : 'report.html';
}

function renderSummary(root) {
  if (root.dataset.summaryRun !== runId) {
    root.innerHTML = `<div class="summary-report-toolbar"><label>报告版本<select id="previewVersion" aria-label="报告版本"></select></label>${button('configureSummary','配置并生成','Configure report')}<button type="button" class="secondary-button" id="regenerateSummary" hidden>用最新数据重新生成</button></div>
      <div id="summaryStatus" class="summary-status" role="status"></div>
      <section id="summaryReportEmpty" class="surface result-empty"><h4>尚无可预览的报告</h4><p>配置报告内容后开始生成。运行中的报告会在这里持续更新。</p></section>
      <iframe class="preview summary-report-frame" id="reportFrame" sandbox="allow-same-origin" title="Data Summary report" hidden></iframe>`;
    root.dataset.summaryRun = runId;
    $('#previewVersion').onchange = event => {
      analysisDraft().versions.summary = event.target.value;
      renderSummary(root);
    };
  }
  const choices = viewableReports();
  const batch = latestAnalysisBatch();
  const manual = choices.find(report => report.id === analysisDraft().versions.summary);
  selectedReport = manual?.id || defaultSummaryReport(choices, batch);
  const selected = choices.find(report => report.id === selectedReport);
  const selector = $('#previewVersion');
  const choiceSignature = JSON.stringify(choices.map(report => [report.id, report.created_at, report.stale, report.status]));
  if (selector.dataset.signature !== choiceSignature) {
    selector.innerHTML = '<option value="">当前报告</option>' + choices.map(report =>
      `<option value="${escape(report.id)}">${escape(resultVersionLabel(report))}</option>`).join('');
    selector.dataset.signature = choiceSignature;
  }
  selector.value = selected?.id || '';
  selector.disabled = !choices.length;
  const current = currentTasks('summary')[0];
  const waiting = ['needs_input', 'waiting_input'].includes(current?.status);
  const busy = ['queued', 'running'].includes(current?.status);
  const state = current ? statusText(current.status) : '尚未开始';
  const detail = current?.stale ? '输入数据已更新；可在右侧解释或编辑此历史报告。重算需使用有效数据，当前报告不自动用于下游。'
    : waiting ? (current.result?.questions || []).join('；') || '请补充当前报告所需的信息。'
    : busy ? '报告生成中，已完成的内容会持续显示。'
    : current?.status === 'failed' ? '本次生成未完成，可调整配置后重试。'
    : current?.status === 'completed' ? '报告已生成，可阅读结果并继续数据 QC。' : '先了解当前数据的内容、覆盖和限制。';
  // A finished, current report needs no status line; the version picker already says so.
  $('#summaryStatus').textContent = current?.status === 'completed' && !current.stale ? '' : `${state} · ${detail}`;
  if (selected?.report_binding_error) {
    $('#summaryStatus').textContent = `${statusText(selected.status)} · 所选报告不可校验或缺少可用副本；请恢复原副本或选择可验证报告。不会自动重新生成。`;
  }
  if (batch && !batch.stages?.summary?.output_turn_id && selected
      && selected.agent_id !== batch.stages?.summary?.agent_id) {
    $('#summaryStatus').textContent += ' 当前展示历史报告，不代表当前批次的生成结果。';
  }
  const configure = $('#configureSummary');
  configure.textContent = waiting ? '回答并继续' : busy ? '生成中' : current?.status === 'failed' ? '配置并重试' : choices.length ? '配置新报告' : '配置并生成';
  configure.disabled = busy;
  $('#regenerateSummary').hidden = !current?.stale || busy;
  $('#regenerateSummary').onclick = () => regenerateWithLatestData(current);
  configure.onclick = () => waiting && current?.agent_id
    ? openAgent(current.agent_id) : openSummaryConfiguration(root, configure);
  const frame = $('#reportFrame');
  frame.hidden = !selected || Boolean(selected.report_binding_error);
  $('#summaryReportEmpty').hidden = Boolean(selected);
  if (!selected) return;
  if (selected.report_binding_error) {
    frame.dataset.artifactSignature = JSON.stringify([selected.id, selected.report_binding_error]);
    delete frame.dataset.result;
    delete frame.dataset.displayedResult;
    delete frame.dataset.displayedResultSha256;
    return;
  }
  const artifactName = reportArtifactName(selected.id);
  const artifactSignature = JSON.stringify([runId, selected.id, artifactName,
    selected.live_artifacts?.[artifactName], selected.result, selected.result_sha256]);
  if (frame.dataset.artifactSignature !== artifactSignature || frame.dataset.result === '') {
    frame.dataset.artifactSignature = artifactSignature;
    delete frame.dataset.result;
    ConversationControls.loadSummaryReport(selected, frame, artifactSignature);
  }
}
function syncSummaryAnalysisDraft(saved) {
  Object.assign(analysisDraft(), {
    chapters: saved.chapters.filter(chapter => chapter.enabled).map(chapter => chapter.name),
    template: 'er-default',
    instruction: saved.instruction,
  });
}
function summaryTemplateDraft() {
  const batch = analysisDraft();
  const saved = uiDrafts.get(`summary:${runId}`);
  return {
    template: 'er-default',
    chapters: saved?.chapters || [...chapters, ...customChapters].map(name => ({
      name, enabled: batch.chapters.includes(name),
    })),
    instruction: batch.instruction,
  };
}
function openSummaryConfiguration(root, trigger) {
  const existing = document.getElementById('summaryConfigDialog');
  if (existing) { existing.querySelector('textarea')?.focus(); return; }
  const dialog = document.createElement('dialog');
  dialog.id = 'summaryConfigDialog';
  dialog.className = 'summary-config-dialog';
  dialog.setAttribute('aria-labelledby', 'summaryConfigTitle');
  dialog.innerHTML = '<h3 id="summaryConfigTitle">配置 Data Summary</h3><p>Exposure-response analysis data summary report</p><div class="summary-dialog-body"></div>';
  document.body.append(dialog);
  renderTemplate(dialog.querySelector('.summary-dialog-body'));
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (trigger?.isConnected) trigger.focus();
  }, {once: true});
  dialog.showModal();
  dialog.querySelector('[name="chapters"]')?.focus();
}

function renderTemplate(root) {
  const requestedRun = runId;
  const inputBinding = () => JSON.stringify([snapshot.workspace.data_revision ?? snapshot.workspace.revision,
    snapshot.workspace.selection_revision, snapshot.workspace.protocol_revision]);
  const approvedInputs = inputBinding();
  const key = `summary:${requestedRun}`;
  const draftKey = `summary-modal:${requestedRun}`;
  const draft = structuredClone(uiDrafts.get(draftKey) || summaryTemplateDraft());
  root.innerHTML = `<form class="live-form" id="summaryForm">
    <input type="hidden" name="summaryTemplate" value="er-default">
    <div class="config-layout"><section class="surface">
      ${sectionHead('报告章节', '选择章节并调整顺序；模板保持统一。')}
      <div class="chapter-toolbar"><span id="chapterCount"></span><button type="button" class="table-button" id="toggleChapters">全选 / 清空</button></div>
      <div class="summary-chapters">${draft.chapters.map((chapter, index) => `
        <div class="chapter-row" data-chapter="${escape(chapter.name)}">
          <span class="chapter-number">${String(index + 1).padStart(2, '0')}</span>
          <label><input type="checkbox" name="chapters" value="${escape(chapter.name)}" ${chapter.enabled ? 'checked' : ''}><span>${escape(chapter.name)}</span></label>
          <div class="chapter-arrows"><button type="button" class="secondary-button" data-move="up" aria-label="上移 ${escape(chapter.name)}">↑</button><button type="button" class="secondary-button" data-move="down" aria-label="下移 ${escape(chapter.name)}">↓</button></div>
        </div>`).join('')}</div>
      <button type="button" class="add-row" id="addChapter">＋ 添加自定义章节</button>
    </section><aside class="surface config-note">
      ${sectionHead('本次报告')}
      <p>数据版本 V${snapshot.workspace.revision || 0} · ${snapshot.inventory.tables?.length || 0} 张数据表</p>
      <label>分析重点与额外要求<textarea name="instruction" rows="6" placeholder="例如重点说明访视覆盖、缺失情况或特定人群">${escape(draft.instruction)}</textarea></label>
      <p class="help-text">报告正文使用英文。草稿自动保留；取消不会启动任务，保存配置不会发送数据。</p>
    </aside></div>
    <p id="summaryConfigError" role="alert" tabindex="-1" hidden></p>
    <small id="summaryReadiness"></small>
    <div class="modal-actions">
      <button type="button" class="secondary-button" id="cancelSummaryConfiguration">取消</button>
      <button type="button" class="secondary-button" id="saveSummaryConfiguration">保存配置</button>
      <button class="primary-button" id="startSummary">生成 Data Summary</button>
    </div></form>`;
  const form = root.querySelector('#summaryForm');
  const close = () => root.closest('dialog')?.close();
  const saveDraft = () => {
    const rows = [...root.querySelectorAll('.chapter-row')];
    const saved = {template: 'er-default', chapters: rows.map(row => ({
      name: row.dataset.chapter, enabled: row.querySelector('input').checked,
    })), instruction: form.elements.instruction.value};
    uiDrafts.set(draftKey, saved);
    const count = saved.chapters.filter(chapter => chapter.enabled).length;
    root.querySelector('#chapterCount').textContent = t(`已选 ${count} / ${rows.length} 个章节`, `${count} of ${rows.length} sections selected`);
    root.querySelector('#startSummary').disabled = !snapshot.inventory.tables?.length || !count;
    root.querySelector('#summaryReadiness').textContent = !snapshot.inventory.tables?.length
      ? '请先选择数据。' : !count ? '至少选择一个章节。' : '';
    rows.forEach((row, index) => {
      row.querySelector('.chapter-number').textContent = String(index + 1).padStart(2, '0');
      row.querySelector('[data-move="up"]').disabled = index === 0;
      row.querySelector('[data-move="down"]').disabled = index === rows.length - 1;
    });
    return saved;
  };
  const acceptDraft = () => {
    const saved = saveDraft();
    if (runId !== requestedRun) throw new Error('当前项目已改变，请重新打开配置。');
    uiDrafts.set(key, structuredClone(saved));
    syncSummaryAnalysisDraft(saved);
    return saved;
  };
  form.oninput = saveDraft;
  root.querySelectorAll('[data-move]').forEach(control => {
    control.onclick = () => {
      const row = control.closest('.chapter-row');
      if (control.dataset.move === 'up' && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
      if (control.dataset.move === 'down' && row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
      saveDraft();
    };
  });
  root.querySelector('#toggleChapters').onclick = () => {
    const boxes = [...root.querySelectorAll('[name="chapters"]')];
    const check = !boxes.every(box => box.checked);
    boxes.forEach(box => { box.checked = check; });
    saveDraft();
  };
  root.querySelector('#addChapter').onclick = async () => {
    saveDraft();
    const name = await ask('章节名称与内容要求');
    if (!name?.trim() || !root.isConnected || runId !== requestedRun) return;
    uiDrafts.get(draftKey).chapters.push({name: name.trim(), enabled: true});
    renderTemplate(root);
  };
  root.querySelector('#cancelSummaryConfiguration').onclick = close;
  root.querySelector('#saveSummaryConfiguration').onclick = () => action(async () => { acceptDraft(); close(); });
  form.onsubmit = async event => {
    event.preventDefault();
    const submit = root.querySelector('#startSummary');
    if (submit.disabled) return;
    submit.disabled = true;
    root.querySelector('#summaryConfigError').hidden = true;
    try {
      if (inputBinding() !== approvedInputs) throw new Error('数据选择已更新，请重新打开配置并确认数据授权。');
      const saved = acceptDraft();
      const cloud_policy = selectedDataPolicy();
      submit.disabled = true;
      await startAgent('summary', {title: 'Data Summary', message: saved.instruction, cloud_policy,
        parameters: {chapters: saved.chapters.filter(chapter => chapter.enabled).map(chapter => chapter.name),
          template: 'er-default', instruction: saved.instruction}},
      'Build the selected Data Summary chapters and return version-bound evidence for main review.');
      close();
      if (runId === requestedRun) await refresh(false);
    } catch (error) {
      const message = root.querySelector('#summaryConfigError');
      message.textContent = productError(error);
      message.hidden = false;
      message.focus();
      submit.disabled = false;
    }
  };
  saveDraft();
}

function renderPreview(root) {
  renderSummary(root);
}
function renderQuality(root) {
  const ready=reports().some(r=>r.kind==='summary'&&!r.stale);
  root.innerHTML=`<div class="readiness-banner is-ready"><span class="status-badge">${t('数据 QC 可直接开始','Data QC is ready')}</span><p>${ready?t('Data Quality QC 直接检查当前选择；TLF 核对可使用当前 Summary。','Data Quality QC checks the selection directly; TLF can use the current Summary.'):t('Data Quality QC 可直接检查当前选择；TLF 核对需先生成 Summary。','Data Quality QC can start now; TLF requires a Summary.')}</p>${ready?'':`<button class="table-button" data-go="summary">${t('前往 Summary','Go to Summary')}</button>`}</div><div class="quality-options">${[['tlf','01','TLF 一致性核对','TLF consistency','对照 TLF 截图和报告，检查数值、标签与口径差异。','Compare TLF screenshots and the report for numerical, label and definition differences.','Summary + TLF 截图','Summary + TLF screenshots'],['erqc','02','数据质量 QC','Data Quality QC','按 pack v1 的八项规则检查数据并保留发现、受试者关联和处理依据。','Run the eight pack-v1 rules and retain findings, subject links and handling evidence.','所选数据 + 当前版本','Selected data + current revisions']].map(([kind,num,zh,en,desc,descEn,input,inputEn])=>`<article class="surface quality-option"><span class="option-number">${num}</span><h4>${t(zh,en)}</h4><p>${t(desc,descEn)}</p><dl class="meta-list"><div><dt>${t('输入','Inputs')}</dt><dd>${t(input,inputEn)}</dd></div><div><dt>${t('最近任务','Latest task')}</dt><dd>${currentTasks(kind)[0]?statusText(currentTasks(kind)[0].status):t('尚未运行','Not run')}</dd></div></dl><button class="secondary-button" data-go="${kind==='erqc'?'pk':kind}">${t('配置检查 →','Configure check →')}</button></article>`).join('')}</div><div class="info-note">${t('质检发现会保留证据和处理记录。需要排除数据时，请在数据选择中明确范围与原因。','Findings retain evidence and handling records. Specify exclusion scope and reasons in Data selection.')}</div>`;wireNavigation(root);
}

function renderQualityRules(root) {
  const rules = [
    ['数值一致性', '标签与单位', '人群与分析口径'],
    ['治疗下缺少 PK', 'PK 记录与 PKFL 不一致', '给药前非零基线', 'PK 核心字段缺失', '稀疏 PK 曲线', '队列标签无法解析', '重复 PK 记录', 'PARAMREP 与单位不一致'],
  ];
  root.querySelectorAll('.quality-option').forEach((card, index) => {
    card.insertAdjacentHTML('beforeend', `<div class="quality-rule-summary"><strong>检查内容</strong><ul>${(rules[index] || []).map(rule => `<li>${escape(rule)}</li>`).join('')}</ul></div>`);
  });
}

function analysisResultTask(kind) {
  const results = currentTasks(kind).filter(task => task.status === 'completed');
  const key = analysisSection === 'quality' ? 'quality' : kind;
  const requested = analysisDraft().versions[key];
  const batch = latestAnalysisBatch();
  const bound = batch?.stages?.[kind]?.output_turn_id;
  return results.find(task => task.id === requested)
    || results.find(task => task.id === bound)
    || (!batch?.stages?.[kind] ? results[0] : undefined);
}

function renderQC(kind, root = $('#stepContent')) {
  if (kind === 'erqc') return renderProductQC(root);
  const results=currentTasks(kind).filter(task=>task.status==='completed'),latest=analysisResultTask(kind);
  root.innerHTML=`<section class="surface qc-setup"><div class="section-heading"><h4>${t('配置检查','Configure check')}</h4><p>${t('开始前请选择当前版本的 Summary。','Select the current Summary before starting.')}</p></div>${results.length?`<label>${t('结果版本','Result version')}<select id="qcResultVersion"><option value="">${t('当前结果','Current result')}</option>${results.map(result=>`<option value="${escape(result.id)}" ${result.id===latest?.id?'selected':''}>${escape(prettyDate(result.created_at))}</option>`).join('')}</select></label>`:''}<form class="live-form" id="qcForm"><label>${t('依据的 Summary','Source Summary')}${reportSelect('qcReport',true)}</label>${kind==='tlf'?`<label>${t('TLF 截图','TLF screenshots')}<input type="file" name="screenshots" accept="image/png,image/jpeg" multiple required></label>`:''}<label>${t('补充说明','Additional note')}<textarea name="instruction"></textarea></label><button class="primary-button">${t('开始检查','Start check')}</button></form></section><div class="qc-grid"><section class="surface"><div class="section-heading"><h4>${t('发现与处理','Findings and decisions')}</h4></div><div id="findings"><div class="result-empty"><h4>${t('暂无发现','No findings')}</h4><p>${t('完成检查后将在这里显示结果。','Results will appear here after the check.')}</p></div></div></section><section class="surface"><div class="section-heading"><h4>${t('来源报告与证据','Source report and evidence')}</h4></div><iframe class="preview" id="qcFrame" hidden sandbox="allow-same-origin" title="QC source report"></iframe><div id="screenshotPreview"></div></section></div>`;
  if ($('#qcResultVersion')) $('#qcResultVersion').onchange=event=>{const key=analysisSection==='quality'?'quality':kind;analysisDraft().versions[key]=event.target.value;renderQC(kind,root);};
  $('#qcForm .primary-button').disabled=!reports().some(r=>r.kind==='summary'&&!r.stale);
  if ($('#qcReport')) $('#qcReport').required=true;
  $('#qcForm').onsubmit=e=>{e.preventDefault();action(async()=>{const f=new FormData(e.target),uploads=[];for(const file of f.getAll('screenshots')){if(!file.size)continue;const data=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(file);});uploads.push((await api('/api/upload',{run_id:runId,data})).id);}const cloud_policy={...selectedDataPolicy(),allow_evidence:kind==='tlf'};await startAgent(kind,{title:'TLF Consistency',message:f.get('instruction'),report_id:$('#qcReport').value,uploads,cloud_policy,parameters:{instruction:f.get('instruction')}},'Compare the selected Summary and screenshots and return traceable findings.');await refresh();});};
  if ($('#qcReport')) $('#qcReport').onchange=e=>{$('#qcFrame').hidden=!e.target.value;showReport(e.target.value,$('#qcFrame'));};
  if(latest&&kind==='tlf') (latest.inputs||[]).filter(v=>/\.(png|jpe?g)$/i.test(v.path)).forEach(async(v,index)=>{try{const img=document.createElement('img');img.className='image-preview';img.alt=t('TLF 截图 ','TLF screenshot ')+(index+1);img.src=await fileUrl(latest.id,'screenshot-'+index);$('#screenshotPreview')?.append(img);}catch{}});
  if(latest){$('#qcFrame').hidden=false;showReport(latest.parameters.report_id,$('#qcFrame'));renderFindings(latest);}
}
let analysisSection = 'summary';
let summaryView = 'versions';
function renderAnalysisWorkspace(root) {
  root.innerHTML = '<div id="analysisWorkspaceBody"></div>';
  renderAnalysisSection($('#analysisWorkspaceBody'));
}

function renderAnalysisSection(root) {
  if (analysisSection === 'summary') {
    renderSummary(root);
    return;
  }
  if (analysisSection === 'quality') { renderQuality(root); renderQualityRules(root); }
  if (analysisSection === 'tlf') renderQC('tlf', root);
  if (analysisSection === 'erqc') renderQC('erqc', root);
  if (analysisSection === 'exploration') renderExploration(root);
}
