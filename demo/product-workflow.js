/* Product actions share the existing Shiny service; no second deployment. */
function preparationNavigationStatus() {
  const taskStatus=currentTasks('analysis-data')[0]?.status;
  const status=snapshot.analysis_data?.status;
  // The data gate reports needs_input until anything was prepared; that is "not started" here.
  if (!taskStatus && !snapshot.analysis_data?.pending_candidate && status === 'needs_input') return '';
  return ['queued','running','needs_input','failed','interrupted'].includes(taskStatus) ? taskStatus
    : snapshot.analysis_data?.pending_candidate ? 'awaiting_user'
    : ['missing','not_prepared'].includes(status) ? '' : status === 'invalid' ? 'stale' : status || '';
}

// Land on the step the user should work on next, not on an overview of empty tables.
function productLandingPage(snapshot) {
  const tasks = snapshot.tasks || [];
  const running = tasks.find(task => ['queued', 'running'].includes(task.status));
  const pageOf = {summary: 'summary', erqc: 'qc', 'analysis-data': 'preparation'};
  if (running && pageOf[running.kind]) return pageOf[running.kind];
  const done = kind => tasks.some(task => task.kind === kind && task.status === 'completed' && !task.stale);
  if (!(snapshot.workspace?.sources || []).length) return 'upload';
  if (!done('summary')) return 'summary';
  if (!done('erqc')) return 'qc';
  return 'preparation';
}

// The workbench has no task state of its own; it only opens after Analysis Data is adopted.
const workbenchNavigationText=()=>snapshot.analysis_data?.status==='ready'?'可打开':'未启动';

// Results built on an older data version show as needing an update, not as done.
function exposureStatus() {
  const agent = currentAgents('exposure-response')[0];
  const status = latestAnalysisTurn(agent)?.status || '';
  return agent?.stale && status === 'completed' ? 'stale' : status;
}

// Navigation status of the steps after QC; null for the other steps.
function productNavStatus(step) {
  if (step === 'charts') return {raw: '', text: workbenchNavigationText()};
  if (step === 'issues') return issueNavStatus() || {raw: '', text: '未启动'};
  if (step === 'decisions') {
    const count = Object.keys(snapshot?.study_decisions?.decisions || {}).length;
    return count ? {raw: 'saved', text: `${count} 项`} : {raw: '', text: '未确认'};
  }
  const raw = {preparation: preparationNavigationStatus, exposure: exposureStatus}[step]?.();
  return raw === undefined ? null : {raw, text: statusText(raw)};
}

// The node a step shows on the sidebar spine: its icon class and its state colour.
function navVisual(step, raw) {
  const visual = ['queued', 'running', 'preparing'].includes(raw) ? 'running'
    : ['已完成', '已保存', 'saved', 'skipped', 'completed', 'reviewed', 'ready'].includes(raw) ? 'completed' : 'pending';
  const state = ['needs_input', 'awaiting_user', 'waiting'].includes(raw) || (step === 'issues' && raw === 'running') ? 'waiting'
    : ['failed', 'interrupted', 'stale'].includes(raw) ? 'failed' : visual;
  return {visual, state};
}

// A finished step shows one fact instead of the bare status word.
function navDetail(step, status) {
  if (status.visual !== 'completed' || !snapshot) return status.text;
  const qcFound = snapshot.issue_ledger?.funnel?.nodes?.qc?.found;
  const facts = {
    database: [snapshot.inventory?.tables?.length, n => t(`${n} 张表`, `${n} tables`)],
    upload: [snapshot.workspace?.sources?.length, n => t(`${n} 个文件`, `${n} files`)],
    qc: [qcFound, n => t(`${n} 项发现进入台账`, `${n} findings in the ledger`)],
    preparation: [snapshot.analysis_data?.tables?.length, n => t(`${n} 张分析表`, `${n} analysis tables`)],
  }[step];
  return facts && facts[0] ? facts[1](facts[0]) : status.text;
}

// The sidebar's last line: what the Agent is doing now, waiting for, or last finished.
function renderSidebarLive() {
  const card = $('#sidebarLive');
  if (!card) return;
  const turns = (snapshot?.agents || []).map(agent => [agent, latestAnalysisTurn(agent)]).filter(([, turn]) => turn);
  const running = turns.find(([, turn]) => ['running', 'queued', 'preparing'].includes(turn.status));
  const waiting = turns.find(([, turn]) => ['needs_input', 'awaiting_user', 'waiting'].includes(turn.status));
  const last = turns.filter(([, turn]) => turn.completed_at).sort((a, b) => String(b[1].completed_at).localeCompare(String(a[1].completed_at)))[0];
  const [agent, turn, kind] = running ? [...running, 'running'] : waiting ? [...waiting, 'waiting'] : last ? [...last, 'idle'] : [];
  card.hidden = !agent;
  if (!agent) return;
  const label = (turn.progress_steps || []).find(item => item.id === turn.progress_current)?.label;
  const title = {running: t(`${agent.title} 运行中`, `${agent.title} running`),
    waiting: t(`等你决定 · ${agent.title}`, `Your decision · ${agent.title}`), idle: t('Agent 空闲', 'Agent idle')}[kind];
  const detail = kind === 'idle' ? `${prettyDate(turn.completed_at)} · ${agent.title}` : label || statusText(turn.status);
  card.className = `sidebar-live is-${kind}`;
  $('#sidebarLiveTitle').textContent = title;
  $('#sidebarLiveDetail').textContent = detail;
}

function analysisWorkbenchBinding() {
  const workspace=snapshot?.workspace;
  return JSON.stringify([runId,workspace?.data_revision,workspace?.selection_revision,
    workspace?.protocol_revision,snapshot?.analysis_data?.mapping_sha256]);
}

async function openAnalysisWorkbench() {
  if (snapshot?.analysis_data?.status !== 'ready') throw new Error('请先在 Analysis Data 确认采用已准备的数据，再打开分析与绘图。');
  const source = CanvasModel.sourceForTable(snapshot.inventory.tables[0], snapshot.workspace.sources);
  if (!source) throw new Error('当前项目缺少可核验的数据源。');
  if (window.canvasHostSend) {
    window.canvasHostSend({type:'demo.openShiny', runId, source:source.path,
      dataRevision:snapshot.workspace.data_revision, workspace:'analysis'});
    return;
  }
  // Reserve the browser tab in the click gesture, before asynchronous startup.
  const tab = window.open('about:blank', '_blank');
  if (!tab) throw new Error('请允许此页面打开新窗口，然后重试。');
  tab.opener = null;
  const binding = analysisWorkbenchBinding();
  try {
    const target = ScreeningModel.shinyRequest(runId, source.path, snapshot.workspace.data_revision);
    const result = await api(target.path, target.payload);
    if (snapshot?.analysis_data?.status !== 'ready' || binding !== analysisWorkbenchBinding()) throw new Error('数据版本已更新，请重新打开工作台。');
    const url = new URL(ScreeningModel.safeShinyUrl(result.url));
    url.searchParams.set('workspace', 'analysis');
    tab.location.replace(url.toString());
  } catch (error) { tab.close(); throw error; }
}

// Every Agent step can show what we preset for it: Skill, spec, template, R scripts and prompts.
const PRESET_STEPS = new Set(['screening', 'summary', 'qc', 'preparation', 'exposure']);
const PRESET_GROUPS = {Skill: 'Skill', Spec: 'Spec', Template: '模板', 'R script': 'R 脚本', 'Tool guide': '工具说明',
  Conventions: '编码规范', 'Prompt template': '提示词模板', 'Last prompt': '最近一次实际提示词'};

function syncPresetsButton() {
  const button = $('#stepPresetsButton');
  if (!button) return;
  button.hidden = !PRESET_STEPS.has(page);
  button.onclick = () => action(() => openStepPresets(page));
  $('#closePresets').onclick = () => $('#presetsModal').classList.add('hidden');
}

async function openStepPresets(step) {
  const {items} = await api(`/api/runs/${encodeURIComponent(runId)}/step-presets`, {step});
  $('#presetsBody').innerHTML = items.map(item => `<details class="preset-item"><summary><span class="preset-group">${escape(PRESET_GROUPS[item.group] || item.group)}</span><strong data-i18n-skip>${escape(item.name)}</strong>${item.path ? `<code data-i18n-skip>${escape(item.path)}</code>` : ''}</summary>${item.missing ? '<p class="info-note">文件缺失</p>' : `<pre data-i18n-skip>${escape(item.text)}</pre>`}</details>`).join('')
    || '<p>这一步没有预设内容。</p>';
  $('#presetsModal').classList.remove('hidden');
}
