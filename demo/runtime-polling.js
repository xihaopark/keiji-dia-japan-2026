/* Poll projections without replacing an unchanged report, chart, or exploration view. */
function pollSignature(target) {
  if (target === 'preparation') return JSON.stringify({
    analysis_data: snapshot?.analysis_data,
    tasks: currentTasks('analysis-data').map(task => [task.id, task.status, task.result,
      task.error, task.progress_current, task.progress_steps]),
  });
  if (target === 'charts') return JSON.stringify({
    figures: currentTasks('charts').map(task => [task.id, task.status, task.review, task.stale, task.figure_saved, task.error]),
    analysis_data: snapshot?.analysis_data,
    preparation: currentTasks('analysis-data').map(task => [task.id, task.status, task.error]),
  });
  if (target === 'decisions') return JSON.stringify([snapshot?.study_decisions, pendingProposals()]);
  if (target === 'exposure') return JSON.stringify([snapshot?.analysis_data?.status, currentAgents('exposure-response').map(agent => [agent.id, agent.stale, latestAnalysisTurn(agent)])]);
  if (target === 'exploration') return JSON.stringify(currentTasks('exploration').map(task => [task.id, task.status, task.review, task.stale, task.integrity, task.error]));
  return '';
}

function rememberPollSnapshot() {
  const target = CanvasModel.pollTarget(page);
  if (['preparation', 'charts', 'exploration', 'exposure', 'decisions'].includes(target)) pollSignatures.set(`${runId}:${target}`, pollSignature(target));
}

function refreshPolledPage() {
  const target = CanvasModel.pollTarget(page);
  if (target === 'database') return refreshDatabasePage();
  if (target === 'analysis') return renderAnalysisResults();
  if (!['preparation', 'charts', 'exploration', 'exposure', 'decisions'].includes(target)) return;
  const key = `${runId}:${target}`;
  const signature = pollSignature(target);
  if (pollSignatures.get(key) === signature) return;
  if (['preparation', 'exposure', 'decisions'].includes(target) && document.activeElement?.matches?.('input,textarea,select')
      && $('#stepContent')?.contains(document.activeElement)) return;
  if (document.querySelector('dialog[open]')) return;
  pollSignatures.set(key, signature);
  if (target === 'preparation') renderAnalysisDataWorkspace($('#stepContent'));
  if (target === 'charts') renderCharts($('#stepContent'));
  if (target === 'exploration') renderExploration($('#stepContent'));
  if (target === 'exposure') renderExposure($('#stepContent'));
  if (target === 'decisions') renderDecisionHub($('#stepContent'));
}

// Polled reads send back the fingerprint they hold; an unchanged payload returns as a few bytes.
const pollCache = new Map();
let pollUnchanged = false;
async function pollRead(path) {
  const held = pollCache.get(path);
  const data = await api(held ? `${path}${path.includes('?') ? '&' : '?'}since=${held.fingerprint}` : path);
  pollUnchanged = Boolean(data.unchanged && held);
  if (pollUnchanged) return held.data;
  if (data.fingerprint) pollCache.set(path, {fingerprint: data.fingerprint, data});
  return data;
}

function markConnected() {
  $('#assistantContext').textContent = '';
  $('.assistant-context').hidden = true;
  $('#connectionDot').classList.remove('is-disconnected');
}

let pollBusy = false;
async function pollRuntime() {
  if (pollBusy) return;
  pollBusy = true;
  try {
    await api('/api/health');
    if (page === 'home') await refreshRuns(true);
    else {
      await refresh(false);
      followWorkbenchRequest(snapshot);
    }
  } catch {
    const projectName = projects.find(project => project.id === runId)?.name || (runId || '项目列表');
    $('#assistantContext').textContent = `${projectName} · 连接已断开`;
    $('.assistant-context').hidden = false;
    $('#connectionDot').classList.add('is-disconnected');
  } finally {
    pollBusy = false;
  }
}

setInterval(pollRuntime, 2000);

// Location metadata only. A separate per-tab identity prevents last-writer guesses.
const canvasViewClient = crypto.randomUUID();
let canvasViewSequence = 0;
async function syncCanvasView(interacted = false) {
  if (document.visibilityState === 'hidden') return;
  const selected = typeof conversation === 'undefined' ? {} : conversation;
  const frames = [...document.querySelectorAll('iframe[data-displayed-result]')]
    .filter(frame => !frame.hidden && frame.getClientRects().length);
  const reports = frames.map(frame => frame.dataset.displayedResult);
  const reportBindings = frames
    .filter(frame => /^[a-f0-9]{64}$/.test(frame.dataset.displayedResultSha256 || ''))
    .map(frame => ({turn_id: frame.dataset.displayedResult,
      result_sha256: frame.dataset.displayedResultSha256}));
  try {
    await api('/api/canvas-view', {client_id: canvasViewClient, sequence: ++canvasViewSequence,
      run_id: page === 'home' ? '' : runId, page,
      agent_id: page === 'home' ? '' : selected.agentId || '',
      turn_id: page === 'home' ? '' : selected.turnId || '', reports,
      report_bindings: reportBindings, interacted: interacted === true});
  } catch { /* No receipt is refreshed: the hook expires this location after 60 seconds. */ }
}
setInterval(syncCanvasView, 2000);
const syncInteractedView = () => setTimeout(() => syncCanvasView(true), 0);
window.addEventListener?.('focus', syncInteractedView);
window.addEventListener?.('hashchange', syncInteractedView);
document.addEventListener?.('click', syncInteractedView);
document.addEventListener?.('change', syncInteractedView);
