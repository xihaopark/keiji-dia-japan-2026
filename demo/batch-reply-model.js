/* Pure paused-batch reply routing. No API calls or durable state writes. */
const BatchReplyModel = (() => {
  function waitingBatchForAgent(agent, batches) {
    if (!agent) return null;
    const latest = agent.turns?.find(turn => turn.id === agent.last_turn_id);
    const reportTurn = Boolean(latest?.parameters?.report_target);
    for (const batch of batches || []) {
      for (const [kind, stage] of Object.entries(batch.stages || {})) {
        if (stage.agent_id === agent.id && (stage.turn_id === agent.last_turn_id || reportTurn)
            && ['needs_input', 'failed', 'interrupted'].includes(stage.status)
            && !['cancelled', 'completed'].includes(batch.status)) {
          return {batch, kind, stage};
        }
      }
    }
    return null;
  }

  return {waitingBatchForAgent};
})();
if (typeof module !== 'undefined') module.exports = BatchReplyModel;
