/* Model routing is visible before launch; only explicit overrides are submitted. */
async function startAgent(kind, payload, fallbackMessage) {
  const message = String(payload.message || '').trim() || fallbackMessage;
  const override = $('#modelOverride')?.value || '';
  const parameters = {...(payload.parameters || {})};
  if (override) parameters.model_override = override;
  return api('/api/agents', {
    ...payload, parameters, run_id: runId, kind, message,
    title: payload.title || taskName(kind),
  });
}

function renderModelRoutePreview() {
  const control = $('#modelOverride');
  const preview = $('#modelRoutePreview');
  if (!control || !preview) return;
  const kind = ({
    summary:'summary', template:'summary', generate:'summary', tlf:'tlf',
    qc:'erqc', preparation:'analysis-data', exposure:'exposure-response', pk:'erqc', charts:'charts', analysis:'exploration',
  })[page] || '';
  const automatic = ({
    summary:'Opus', tlf:'Opus', erqc:'Opus', charts:'Opus', exploration:'Opus', 'analysis-data':'Opus', 'exposure-response':'Opus',
  })[kind];
  preview.textContent = control.value
    ? `用户覆盖：${control.options[control.selectedIndex].text}`
    : automatic ? `自动选择：${automatic}` : '确定性操作不调用模型';
}
