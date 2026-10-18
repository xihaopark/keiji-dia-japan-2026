/* Pure state for paged manual screening. Durable selection remains in ERAgent. */
const ScreeningModel = (() => {
  function requestPath(runId, source, offset, limit, dataRevision) {
    const query = new URLSearchParams({
      table: source,
      offset: String(offset),
      limit: String(limit),
      expected_data_revision: String(dataRevision),
    });
    return `/api/runs/${encodeURIComponent(runId)}/screening?${query}`;
  }

  function shinyRequest(runId, source, dataRevision) {
    return {
      path: `/api/runs/${encodeURIComponent(runId)}/shiny-table`,
      payload: {table: source, expected_data_revision: dataRevision},
    };
  }

  function safeShinyUrl(value) {
    let url;
    try {
      url = new URL(value);
    } catch (_error) {
      throw new Error('Shiny data view did not return a local runtime URL');
    }
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) {
      throw new Error('Shiny data view did not return a local runtime URL');
    }
    return url.toString();
  }

  function selectionState(sources) {
    const excluded = new Map((sources || []).map(source => [
      source.path,
      new Set((source.exclude_rows || []).map(Number)),
    ]));
    const protectedRows = new Map();
    const sourceRows = source => excluded.get(source) || new Set();
    const sourceProtectedRows = source => protectedRows.get(source) || new Set();
    return {
      ingest(source, rows, protectedOnly = false) {
        const merged = sourceRows(source);
        const protectedSet = sourceProtectedRows(source);
        for (const row of rows || []) {
          const sourceRow = Number(row.source_row);
          if (!Number.isSafeInteger(sourceRow) || sourceRow < 1) continue;
          const exclusions = new Set(row.exclusions || []);
          if (protectedOnly && !exclusions.has('subject')) continue;
          if (exclusions.has('row')) merged.add(sourceRow);
          else merged.delete(sourceRow);
          if (exclusions.has('subject')) protectedSet.add(sourceRow);
          else protectedSet.delete(sourceRow);
        }
        excluded.set(source, merged);
        protectedRows.set(source, protectedSet);
      },
      capture(source, rows) {
        const merged = sourceRows(source);
        for (const row of rows || []) {
          const sourceRow = Number(row.source_row);
          if (!Number.isSafeInteger(sourceRow) || sourceRow < 1) continue;
          if ((row.exclusions || []).includes('subject')) continue;
          if (row.included) merged.delete(sourceRow);
          else merged.add(sourceRow);
        }
        excluded.set(source, merged);
      },
      selectAll(source) {
        const protectedSet = sourceProtectedRows(source);
        excluded.set(source, new Set([...sourceRows(source)].filter(row => protectedSet.has(row))));
      },
      rows(source) {
        return [...sourceRows(source)].sort((a, b) => a - b);
      },
      buildSources(values) {
        return (values || []).map(source => ({...source, exclude_rows: this.rows(source.path)}));
      },
    };
  }

  function rowPresentation(row, excludedRows) {
    const exclusions = new Set(row.exclusions || []);
    const subjectExcluded = exclusions.has('subject');
    const rowExcluded = excludedRows.has(Number(row.source_row));
    return {
      subjectExcluded,
      rowExcluded,
      checked: !rowExcluded,
      effectivelyIncluded: !subjectExcluded && !rowExcluded,
      status: subjectExcluded ? '受试者规则排除' : rowExcluded ? '已排除' : '已纳入',
    };
  }

  return {requestPath, shinyRequest, safeShinyUrl, selectionState, rowPresentation};
})();
if (typeof module !== 'undefined') module.exports = ScreeningModel;
