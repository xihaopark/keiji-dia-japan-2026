/* Client home-page formatting; values come from the local ERAgent service. */
function projectCreatedDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = part => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function homeCount(value) {
  return typeof value === 'number' ? String(value).padStart(2, '0') : '—';
}

function homeSyncDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(typeof language !== 'undefined' && language === 'en' ? 'en-GB' : 'zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
