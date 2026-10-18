/* Client demo: every Canvas request is answered from the recorded case; nothing runs.
   Reads come from window.DEMO_RECORDING (built by build_demo.py). A start or rerun returns the
   step's latest recorded turn, so the page goes straight to the real result; other writes are
   accepted and leave the recorded state as it is. */
(() => {
  const recording = window.DEMO_RECORDING || {};
  const RUN = window.DEMO_RUN_ID || '';

  // Same rule as record_proxy.request_key: path plus sorted query without since or token.
  function requestKey(url) {
    const pairs = [...url.searchParams].filter(([name]) => name !== 'since' && name !== 'token')
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    const query = new URLSearchParams(pairs).toString();
    return url.pathname + (query ? `?${query}` : '');
  }

  function bytesOf(entry) {
    if (entry.e !== 'b64') return entry.b;
    return Uint8Array.from(atob(entry.b), character => character.charCodeAt(0));
  }

  const json = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});

  let workspaceCache;
  function workspace() {
    if (workspaceCache) return workspaceCache;
    const entry = recording[`/api/workspace?run_id=${RUN}`];
    workspaceCache = entry ? JSON.parse(entry.b) : {agents: []};
    return workspaceCache;
  }

  function latestTurnOf(agent) {
    const turns = (agent?.turns || []).filter(turn => turn.interaction_mode !== 'conversation');
    const sorted = (turns.length ? turns : agent?.turns || []).slice()
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    const turn = sorted.at(-1);
    return turn ? {...turn, agent_id: agent.id, run_id: RUN} : {};
  }

  function recordedStart(body) {
    const phase = body?.parameters?.phase || '';
    const agents = (workspace().agents || []).filter(agent => agent.kind === body?.kind
      && (!phase || (agent.parameters || {}).phase === phase));
    const agent = agents.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))).at(-1);
    return agent ? latestTurnOf(agent) : {};
  }

  function answerWrite(url, body) {
    // A new project opens the recorded one, at the step the user would land on.
    if (url.pathname === '/api/runs') return json({run_id: RUN});
    if (url.pathname === '/api/agents') return json(showInPanel(recordedStart(body)));
    const agentMatch = url.pathname.match(/^\/api\/agents\/([^/]+)/);
    if (agentMatch) {
      const agent = (workspace().agents || []).find(item => item.id === agentMatch[1]);
      return json(agent ? showInPanel(latestTurnOf(agent)) : {});
    }
    return json({});
  }

  // A live start puts the new running task in the task panel; the recorded one is already done,
  // so open it there once the page has refreshed.
  function showInPanel(turn) {
    if (turn.agent_id && typeof window.openAgent === 'function') {
      setTimeout(() => window.openAgent(turn.agent_id, turn.id), 400);
    }
    return turn;
  }

  window.canvasHostRequest = async (path, options = {}) => {
    const url = new URL(path, 'http://demo.local');
    const method = (options.method || 'GET').toUpperCase();
    if (method !== 'GET') {
      let body = {};
      try { body = options.body ? JSON.parse(options.body) : {}; } catch { body = {}; }
      return answerWrite(url, body);
    }
    const entry = recording[requestKey(url)];
    if (!entry) {
      console.warn('[demo] not recorded:', requestKey(url));
      return json({error: 'This view is not part of the demo recording.'}, 404);
    }
    const since = url.searchParams.get('since');
    if (since && entry.f === since) return json({unchanged: true, fingerprint: since});
    return new Response(bytesOf(entry), {status: entry.s, headers: {'Content-Type': entry.t}});
  };
})();
