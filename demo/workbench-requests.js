/* Open the Shiny Workbench when the main Agent asks for it (PanelState.open_request).
 * Only a request made in the last two minutes opens it, and each request opens it once, so an
 * old request never reopens the Workbench when Canvas starts. */
const WorkbenchRequests = (() => {
  const seen = new Set();
  const pending = (state, now = Date.now()) => {
    const request = state?.panel_state?.open_request;
    if (!request?.id || seen.has(request.id)) return null;
    seen.add(request.id);
    return now - Date.parse(request.requested_at || '') < 120000 ? request : null;
  };
  return {pending};
})();

function followWorkbenchRequest(state) {
  const request = WorkbenchRequests.pending(state);
  if (!request || !window.canvasHostSend) return;
  const source = CanvasModel.sourceForTable((state.inventory?.tables || [])[0], state.workspace?.sources || []);
  if (!source) return;
  window.canvasHostSend({type: 'demo.openShiny', runId, source: source.path,
    dataRevision: state.workspace.data_revision, workspace: request.workspace === 'analysis' ? 'analysis' : 'data'});
}

if (typeof module !== 'undefined') module.exports = WorkbenchRequests;
