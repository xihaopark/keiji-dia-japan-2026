/* Client V1.4 Data pages. All values and mutations come from ERAgent. */
let databaseView = null;
// The open database tab stays open when the page is drawn again (for example a language switch).
let databaseTab = {runId: '', id: 'rawdata'};
const DatabaseModel = (() => {
  const project = database => {
    const records = database?.qc_exclusions || [], summary = database?.summary_report;
    return {rawSources: database?.rawdata?.sources || [], rawInventory: database?.rawdata?.inventory || {},
      selectedTables: database?.selected?.tables || [], selectedRecords: database?.selected?.records || 0,
      exclusions: records.filter(row => row.type === 'manual_selection').map(row => ({path: row.path,
        rows: [...(row.source_rows || [])].map(Number).sort((a, b) => a - b), reason: row.reason || ''})),
      qcFindings: records.filter(row => row.type === 'qc_finding'), qcRecords: records, explorations: database?.exploration_tables || [],
      summaries: summary ? [summary] : []};
  };
  const isCurrent = (database, state) => database?.run_id === state?.run_id
    && database.revisions?.data === state.workspace?.data_revision
    && database.revisions?.selection === state.workspace?.selection_revision
    && database.revisions?.protocol === state.workspace?.protocol_revision;
  const currentExplorations = state => (state?.tasks || []).filter(task =>
    ['analysis', 'exploration'].includes(task.kind) && task.status === 'completed'
    && !task.stale && task.integrity === 'current');
  const priorityColumns = columns => {
    const priority = [
      'USUBJID', 'SUBJID', 'STUDYID', 'AESEQ', 'EXSEQ', 'PCSEQ',
      'PARAMREP', 'PARAMCD', 'PARAM', 'AVAL', 'AVALC', 'AVALU',
      'AEDECOD', 'AETOXGR', 'AESER', 'EXTRT', 'EXDOSE', 'EXDOSU',
      'CYCLE', 'AVISIT', 'ATPT', 'ADY', 'ASTDY', 'AENDY',
      'TRTP', 'TRTA', 'ARM', 'ACTARM', 'SAFFL', 'PKFL', 'TRTEMFL',
    ];
    const ranked = priority.map(name => columns.find(column => column.name.toUpperCase() === name)).filter(Boolean);
    return [...ranked, ...columns.filter(column => !ranked.includes(column))];
  };
  return {project, isCurrent, currentExplorations, priorityColumns};
})();

async function refreshDatabasePage() {
  const requestedRun = runId;
  const value = await pollRead(`/api/runs/${encodeURIComponent(requestedRun)}/database`);
  if (runId !== requestedRun || page !== 'database') return;
  const signature = value.fingerprint || JSON.stringify(value), key = `${runId}:database`;
  if (pollSignatures.get(key) === signature) return;
  pollSignatures.set(key, signature); databaseView = value;
  renderDatabase($('#stepContent'));
}

function tablePreview(table) {
  const value = table?.preview;
  return (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean);
}

function renderDataBrowser(host, tables) {
  if (!tables.length) {
    host.innerHTML = '<div class="database-panel-empty">尚无数据。</div>';
    return;
  }
  let active = 0;
  let showAllColumns = false;
  const previewLimit = 25;
  const draw = () => {
    const table = tables[active];
    const columns = table.columns || [];
    const visibleColumns = showAllColumns ? columns : DatabaseModel.priorityColumns(columns).slice(0, 12);
    const rows = tablePreview(table).slice(0, previewLimit);
    host.innerHTML = `<div class="data-table-tabs">${tables.map((item, index) =>
      `<button class="database-tab ${index === active ? 'active' : ''}" data-index="${index}" type="button">${escape(item.name)}</button>`).join('')}</div>
      <div class="database-preview-toolbar"><span>显示 <strong>${number(visibleColumns.length)} / ${number(columns.length)}</strong> 个字段</span><button class="secondary-button" id="toggleDatabaseColumns" type="button">${showAllColumns ? '仅显示关键字段' : '显示全部字段'}</button></div>
      <div class="database-table-wrap" tabindex="0" aria-label="${escape(table.name)} 数据预览，可横向滚动"><table class="database-record-table"><thead><tr>${visibleColumns.map(column => `<th>${escape(column.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${visibleColumns.map(column => `<td title="${escape(row[column.name] ?? '—')}">${escape(row[column.name] ?? '—')}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${Math.max(visibleColumns.length, 1)}">没有可预览记录</td></tr>`}</tbody></table></div>
      <div class="selection-summary"><span>完整记录：<strong>${number(table.rows)}</strong></span><span>当前预览：<strong>${rows.length ? `1–${rows.length}` : '0'}</strong></span><span>${t(`为保证页面流畅，数据库概览最多显示 ${previewLimit} 行；完整逐行操作请进入 1.2。`, `To keep the page fast, the overview shows at most ${previewLimit} rows; work row by row in 1.2.`)}</span></div>`;
    host.querySelectorAll('[data-index]').forEach(button => {
      button.onclick = () => { active = Number(button.dataset.index); showAllColumns = false; draw(); };
    });
    host.querySelector('#toggleDatabaseColumns').onclick = () => { showAllColumns = !showAllColumns; draw(); };
  };
  draw();
}

function renderRawSources(host, sources, tables) {
  if (!sources.length) {
    host.innerHTML = '<div class="database-panel-empty">尚无源文件。</div>';
    return;
  }
  host.innerHTML = `<div class="database-source-list">${sources.map(source => {
    const table = tables.find(item => item.source === source.path), path = String(source.path || '');
    return `<article class="file-row"><span>${escape(path.split('/').at(-1) || 'DATA')}</span><div><strong title="${escape(path)}">${escape(path.split('/').slice(0, -1).join('/'))}</strong><small title="SHA-256 ${escape(source.sha256 || '')}">SHA-256 ${escape(String(source.sha256 || '未记录').slice(0, 12))}…</small></div><em>${number(table?.original_rows)} 条原始记录</em></article>`;
  }).join('')}</div>`;
}

function renderDatabaseEvidence(host, view, id) {
  if (id === 'excluded') {
    host.innerHTML = QcRecords.markup(view.qcRecords, escape);
    host.querySelectorAll('[data-qc-export]').forEach(button => { button.onclick = () => saveTextFile(
      `qc-records-${new Date().toISOString().slice(0, 10)}.csv`, QcRecords.csv(view.qcRecords)); });
    return;
  }
  if (id === 'explorations') {
    host.innerHTML = view.explorations.map(task => `<article class="file-row"><span>探索</span><div><strong>${escape(task.title || task.id)}</strong><small>${escape(prettyDate(task.created_at))} · ${escape(statusText(task.review || task.status))}</small></div></article>`).join('') || '<div class="database-panel-empty">暂无探索数据。</div>';
    return;
  }
  host.innerHTML = view.summaries.map(task => `<article class="file-row"><span>Summary</span><div><strong>${escape(task.title || taskName(task.kind))}</strong><small>${escape(prettyDate(task.created_at))} · ${escape(statusText(task.review || task.status))}</small></div><button class="table-button" type="button" data-summary-task="${escape(task.id)}">查看</button></article>`).join('') || '<div class="database-panel-empty">暂无 Data Summary。</div>';
  host.querySelectorAll('[data-summary-task]').forEach(button => { button.onclick = () => { selectedReport = button.dataset.summaryTask; navigate('generate'); }; });
}

function renderDatabase(root) {
  const tabs = [
    ['rawdata','rawdata'],['selected','已选中数据表'],['excluded','质检剔除数据记录表'],
    ['explorations','探索数据'],
  ];
  if (!DatabaseModel.isCurrent(databaseView, snapshot)) {
    const requestedRun = runId;
    root.innerHTML = '<div class="database-panel-empty" role="status">正在读取项目数据…</div>';
    api(`/api/runs/${encodeURIComponent(requestedRun)}/database`).then(value => {
      if (runId !== requestedRun || page !== 'database') return;
      databaseView = value;
      renderDatabase(root);
    }).catch(error => notice(productError(error, '项目数据暂时无法读取，请重试。')));
    return;
  }
  const view = DatabaseModel.project(databaseView);
  const tables = view.selectedTables;
  const hasContent = view.rawSources.length || tables.length || view.qcRecords.length || view.explorations.length || view.summaries.length;
  root.innerHTML = `<div class="database-frame"><section class="database-source-section"><h4 class="database-section-title">${t('受试者流向', 'Subject flow')}</h4>
    <div id="subjectFlow">${typeof subjectFlowMarkup === 'function' ? subjectFlowMarkup(databaseView.subject_flow) : ''}</div>${typeof stageReportsMarkup === 'function' ? stageReportsMarkup() : ''}</section>
    <section class="database-content-section"><div class="database-content-head"><h4 class="database-section-title">${t('项目数据', 'Project data')}</h4><span class="segmented-control database-tabs" role="tablist">${tabs.map(([id,label], index) => `<button class="database-tab ${index === 0 ? 'active' : ''}" data-database-tab="${id}" type="button" role="tab">${label}</button>`).join('')}</span></div>
    <div class="database-empty ${hasContent ? 'hidden' : ''}" id="databaseEmptyState"><strong>数据库暂为空</strong><p>完成数据上传后，项目数据会显示在这里。</p></div>
    <div class="database-selected-preview${hasContent ? '' : ' hidden'}"><div class="selected-preview-head"><strong id="databasePanelTitle">rawdata</strong><span id="databaseSelectedCount"></span></div><div class="selected-preview-body" id="databaseSelectedBody"></div></div></section>
    ${hasContent ? '' : '<div class="database-actions"><button class="primary-button" id="startWorkflowButton" type="button">开始流程 →</button></div>'}</div>`;
  const body = $('#databaseSelectedBody');
  const draw = id => {
    $('#databasePanelTitle').textContent = tabs.find(tab => tab[0] === id)?.[1] || id;
    $('#databaseSelectedCount').textContent = id === 'rawdata' ? `${view.rawSources.length} 个源文件` : id === 'selected' ? `${number(view.selectedRecords)} 条记录` : '';
    if (id === 'rawdata') renderRawSources(body, view.rawSources, tables);
    else if (id === 'selected') renderDataBrowser(body, tables);
    else renderDatabaseEvidence(body, view, id);
    root.querySelectorAll('[data-database-tab]').forEach(button => button.classList.toggle('active', button.dataset.databaseTab === id));
    databaseTab = {runId, id};
  };
  root.querySelectorAll('[data-database-tab]').forEach(button => { button.onclick = () => draw(button.dataset.databaseTab); });
  draw(databaseTab.runId === runId && tabs.some(tab => tab[0] === databaseTab.id) ? databaseTab.id : 'rawdata');
  if (typeof wireStageReports === 'function') wireStageReports(root, () => renderDatabase(root));
  const start = $('#startWorkflowButton');
  if (start) start.onclick = () => navigate('upload');
}

if (typeof module !== 'undefined') module.exports = DatabaseModel;

let pendingSources = null;

function renderSources(root) {
  const saved = snapshot?.workspace?.sources || [];
  root.innerHTML = `<div class="upload-path-card"><div class="upload-path-controls"><input id="dataPathInput" aria-label="${t('数据文件夹', 'Data folder')}" value="${escape(saved[0]?.path ? saved[0].path.split('/').slice(0,-1).join('/') : '')}" placeholder="粘贴数据文件夹路径，或点击选择路径"><button class="secondary-button" id="choosePathButton" type="button">选择路径</button><button class="primary-button" id="confirmPathButton" type="button">确认下一步</button></div>
    <div class="source-list-head"><strong id="pathStatus">${saved.length ? `${saved.length} 个文件` : '尚未确认数据路径'}</strong><span>${saved.length ? '已读取' : ''}</span></div><div id="sourceDataFiles"></div></div>`;
  // A folder picked but not yet confirmed survives a re-render (for example a language switch).
  let picked = pendingSources?.runId === runId ? pendingSources.value : null;
  showPickedFiles($('#sourceDataFiles'), saved.map(item => item.path));
  const browse = (typed, keep) => action(async () => {
    await browseDataFolder($('#sourceDataFiles'), value => {
      picked = value;
      pendingSources = {runId, value};
      $('#dataPathInput').value = value.directory;
      $('#pathStatus').textContent = t(`${value.files.length} 个文件待确认`, `${value.files.length} files to confirm`);
    }, typed, keep);
  });
  if (picked) browse(picked.directory, picked.files);
  const typedPath = () => { const value = $('#dataPathInput').value.trim(); return value !== (picked?.directory || '') ? value : ''; };
  $('#choosePathButton').onclick = () => browse(typedPath());
  $('#dataPathInput').onkeydown = event => { if (event.key === 'Enter' && typedPath()) browse(typedPath()); };
  $('#confirmPathButton').onclick = () => action(async () => {
    if (!picked?.files?.length) throw new Error('请先选择至少一个文件。');
    await api(`/api/runs/${encodeURIComponent(runId)}/data-selection`, {
      run_id: runId,
      source_root: picked.directory,
      files: picked.files,
      sources: picked.paths.map(path => ({path})),
      expected_data_revision: snapshot.workspace.data_revision,
      expected_selection_revision: snapshot.workspace.selection_revision,
    });
    pendingSources = null;
    await refresh(false);
    navigate('screening');
  });
}


function renderProtocol(root) {
  const protocolStatus = snapshot.workspace.protocol_skipped
    ? `主动跳过 · 版本 ${snapshot.workspace.protocol_revision}`
    : snapshot.workspace.protocol_revision ? `版本 ${snapshot.workspace.protocol_revision}` : '尚未上传';
  root.innerHTML = `<div class="protocol-page"><section class="protocol-card"><label class="protocol-file-picker"><span>选择本地文件</span><input id="protocolFileInput" type="file" accept=".txt,.rtf,.md"></label><div class="protocol-file-meta"><span id="protocolFileName">${snapshot.workspace.protocol_skipped ? '本版本已主动跳过' : '未选择文件'}</span><span class="protocol-status" id="protocolStatus">${protocolStatus}</span></div></section><div class="protocol-divider"><span>或粘贴部分文字</span></div><textarea class="protocol-textarea" id="protocolTextInput" rows="10" placeholder="请粘贴 protocol 中需要用于本项目分析的部分内容">${escape(snapshot.workspace.protocol || '')}</textarea><p class="help-text">保存后，这段研究背景会作为后续 Summary、QC 和分析的前提交给 Agent。请只粘贴已去标识化的内容。</p><div class="protocol-actions"><button class="secondary-button" id="skipProtocolButton" type="button">跳过此步骤</button><button class="primary-button" id="saveProtocolButton" type="button">完成并进入下一步</button></div></div>`;
  let source = 'pasted_text';
  $('#protocolFileInput').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    $('#protocolTextInput').value = await file.text();
    $('#protocolFileName').textContent = `${file.name} · ${number(file.size)} bytes`;
    source = `file:${file.name}`;
  };
  const save = skipped => action(async () => {
    const text = skipped ? '' : $('#protocolTextInput').value;
    const deidentified = !skipped, cloudAllowed = !skipped;
    if (!skipped && !text.trim()) throw new Error('请上传、粘贴 Protocol，或主动跳过。');
    await api(`/api/runs/${encodeURIComponent(runId)}/protocol-revisions`, {
      text, skipped, source: skipped ? 'skipped' : source,
      deidentified_confirmed: deidentified,
      cloud_allowed: cloudAllowed,
      expected_protocol_revision: snapshot.workspace.protocol_revision,
    });
    await refresh(false);
    navigate('summary');
  });
  $('#saveProtocolButton').onclick = () => save(false);
  $('#skipProtocolButton').onclick = () => save(true);
}
