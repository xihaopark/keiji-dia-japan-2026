const workflowSteps=[
  'home','database','upload','screening','protocol','summary','qc','preparation','exposure','issues','decisions',
];
const routeAliases={projects:'home',template:'summary',generate:'summary',pk:'qc',tlf:'qc',analysis:'database',charts:'preparation',figures:'preparation'};
const pageNotes = {
  database: ['查看项目数据与结果。', 'View project data and results.'],
  upload: ['选择本次分析使用的数据文件。', 'Choose data files for this analysis.'],
  screening: ['逐表确认本次分析纳入的记录。', 'Review included rows by table.'],
  protocol: ['上传或粘贴研究背景，也可主动跳过。', 'Upload or paste study context, or explicitly skip it.'],
  preparation: ['根据 Summary 与 QC 确认研究口径，生成并验收分析数据。', 'Prepare and confirm analysis data from Summary and QC.'],
  summary: ['查看 Data Summary 报告。', 'View Data Summary reports.'],
  template: ['配置 Summary 报告内容。', 'Configure Summary content.'],
  generate: ['预览 Data Summary。', 'Preview Data Summary.'],
  qc: ['查看数据质检结果。', 'View data quality results.'],
  tlf: ['核对 TLF 与 Summary。', 'Compare TLF and Summary.'],
  pk: ['独立数据质检。', 'Run QC.'],
  charts: ['生成分析图表。', 'Generate figures.'],
  analysis: ['创建数据探索。', 'Explore data.'],
};

function normalizedPage(value) {
  const requested=String(value||'').replace(/^#\/?/,'').split('/')[0], resolved=routeAliases[requested]||requested;
  return workflowSteps.includes(resolved)?resolved:'home';
}

function navStatus(step) {
  if (!snapshot) return {text: '未启动', visual: 'pending'};
  const hasData = Boolean(snapshot.inventory?.tables?.length);
  let raw = '';
  let text = '未启动';
  if (['database', 'upload'].includes(step) && hasData) raw = text = '已完成';
  else if (step === 'screening' && snapshot.workspace?.selection_revision) raw = text = '已保存';
  else if (step === 'protocol' && snapshot.workspace?.protocol_revision) ({raw, text} = CanvasModel.protocolStatus(snapshot.workspace));
  else if (step === 'qc') {
    raw = latestAnalysisTurn(currentAgents('erqc')[0])?.status || currentTasks('erqc')[0]?.status || '';
    text = statusText(raw);
  } else if (productNavStatus(step)) ({raw, text} = productNavStatus(step));
  else {
    const kind = {preparation:'analysis-data',summary:'summary',template:'summary',generate:'summary',tlf:'tlf',pk:'erqc',charts:'charts'}[step];
    if (kind) raw = latestAnalysisTurn(currentAgents(kind)[0])?.status || currentAgents(kind)[0]?.status || currentTasks(kind)[0]?.status || '';
    if (step === 'analysis') raw = latestAnalysisTurn(currentAgents('exploration')[0])?.status || currentAgents('exploration')[0]?.status || currentTasks('exploration')[0]?.status || '';
    if (raw) text = statusText(raw);
  }
  return {text, ...navVisual(step, raw)};
}

function renderNav() {
  const picker = $('#projectSelect');
  if (picker) {
    const signature = JSON.stringify(projects.map(project => [project.id, project.name]));
    if (picker.dataset.signature !== signature) {
      picker.innerHTML = '<option value="">选择项目</option>' + projects.map(project =>
        `<option value="${escape(project.id)}">${escape(project.name || project.id)}</option>`).join('');
      picker.dataset.signature = signature;
    }
    picker.value = runId;
  }
  $('#sidebarProjectName').textContent = projects.find(project => project.id === runId)?.name || '项目列表';
  document.querySelectorAll('.workflow-nav [data-step]').forEach(control => {
    const target = control.dataset.step;
    control.classList.toggle('active', target === page);
    control.disabled = target !== 'home' && !runId;
    if (target === page) control.setAttribute('aria-current', 'page');
    else control.removeAttribute('aria-current');
    const status = navStatus(target);
    control.dataset.state = status.state;
    control.title = control.querySelector('.nav-text')?.textContent || '';
    const state = control.querySelector('.nav-status-text');
    if (state) state.textContent = navDetail(target, status);
    const icon = control.querySelector('.nav-status-icon');
    if (icon) {
      icon.classList.remove('is-pending', 'is-running', 'is-completed');
      icon.classList.add(`is-${status.visual}`);
    }
    const wrapper = control.querySelector('.nav-state');
    if (wrapper) wrapper.dataset.status = status.visual;
  });
  renderSidebarLive();
}

function unmountTransientFrames() {
  document.querySelectorAll('.shiny-data-frame').forEach(frame => {
    frame.hidden = true;
    frame.src = 'about:blank';
    frame.remove();
  });
}

function navigate(next, updateLocation = true) {
  if (['charts','figures'].includes(String(next).replace(/^#\/?/,''))) {
    action(openAnalysisWorkbench);
    return;
  }
  unmountTransientFrames();
  beforePageRerender = null;
  page = normalizedPage(next);
  if (updateLocation) history.replaceState(null, '', `#/${page}`);
  renderNav();
  renderPage();
  $('#workflowPage').scrollTop = 0;
}
