/* V1.4 workspace assembly. Scientific state and execution stay in the runtime. */
function renderPage() {
  renderModelRoutePreview();
  document.body.dataset.page = page;
  previewUrls.splice(0).forEach(URL.revokeObjectURL);
  $('#homePage').classList.toggle('hidden', page !== 'home');
  $('#workflowPage').classList.toggle('hidden', page === 'home');
  if (page === 'home') {
    renderHome();
    return;
  }
  $('#workflowTitle').textContent = projects.find(project => project.id === runId)?.name || runId;
  $('#stepTitle').textContent = stages[page][language === 'zh' ? 0 : 1];
  const stage = {database:1,upload:1,screening:1,protocol:1,summary:2,qc:3,preparation:4,exposure:6}[page];
  $('#stepKicker').textContent = stage ? `阶段 ${stage}` : '全流程共用';
  $('#stepIntro').textContent = pageNotes[page][language === 'zh' ? 0 : 1];
  syncPresetsButton();
  $('#saveState').textContent = snapshot?.workspace.updated_at ? `已保存 ${prettyDate(snapshot.workspace.updated_at)}` : '';
  const root = $('#stepContent');
  if (page === 'database') renderDatabase(root);
  if (page === 'upload') renderSources(root);
  if (page === 'screening') renderSelection(root);
  if (page === 'protocol') renderProtocol(root);
  if (page === 'preparation') renderAnalysisDataWorkspace(root);
  if (page === 'exposure') renderExposure(root);
  if (page === 'decisions') renderDecisionHub(root);
  if (page === 'issues') renderIssueLedger(root);
  mountIssueStrip(root);
  if (['summary','qc'].includes(page)) {
    analysisSection = page === 'summary' ? 'summary' : 'erqc';
    renderAnalysisWorkspace(root);
  }
  rememberPollSnapshot();
}

async function selectProject(id) {
  if (!id) return navigate('home');
  runId = id;
  await api('/api/select', {run_id: runId});
  await refresh(false);
  navigate('database');
}

function initializeShell() {
  $('#modelOverride').onchange = renderModelRoutePreview;
  initializeInterfaceLanguage();
  $('#backHomeButton').onclick = () => navigate('home');
  $('#projectSwitch').onclick = () => navigate('home');
  $('#sidebarToggle').onclick = () => {
    const closed = document.body.classList.toggle('sidebar-collapsed');
    $('#sidebarToggle').setAttribute('aria-expanded', String(!closed));
  };
  $('#assistantToggle').onclick = () => {
    const collapsed = $('#assistant').classList.toggle('collapsed');
    document.body.classList.toggle('assistant-collapsed', collapsed);
    $('#assistantToggle').setAttribute('aria-expanded', String(!collapsed));
    $('#assistantToggle').setAttribute('aria-label', collapsed ? '展开分析任务' : '收起分析任务');
  };
  document.querySelectorAll('.workflow-nav [data-step]').forEach(control => { control.onclick = () => navigate(control.dataset.step); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('#assistant').classList.contains('collapsed')) closeConversations();
  });
  window.addEventListener('hashchange', () => navigate(location.hash, false));
}

async function start() {
  const data = await refreshRuns(false);
  runId = data.active;
  if (runId) await refresh(false);
  page = runId && location.hash ? normalizedPage(location.hash) : CanvasModel.landingPage(snapshot);
  if (!runId && location.hash !== '#/home') history.replaceState(null, '', '#/home');
  renderNav();
  renderPage();
  renderRail();
}

document.documentElement.lang = 'zh-CN';
initializeShell();
action(start);
