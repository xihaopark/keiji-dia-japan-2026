/* DIA Japan 2026 booth: five-stop quick tour over the recorded English demo.
   Each stop is a page (hash route) and, optionally, a section heading to scroll to. */
(() => {
  const STOPS = [
    { ja: '入力', en: 'Input', hash: '#/upload',
      capJa: '入力：ADaM 8 テーブル、69 例。ここから始まる。',
      capEn: 'Input: eight ADaM tables, 69 subjects. The starting point.' },
    { ja: 'データサマリー', en: 'Data Summary', hash: '#/summary',
      capJa: 'エージェントがデータを読み、試験の全体像を要約。数値は R。',
      capEn: 'The agent reads the data and summarises the study. Numbers from R.' },
    { ja: 'データ品質 QC', en: 'Data QC', hash: '#/qc',
      capJa: '44 件の問題を検出。証拠と選択肢を示し、人が決める。',
      capEn: '44 issues found, each with evidence and options. A person decides.' },
    { ja: 'PK / PK-PD 図', en: 'PK / PK-PD figures', hash: '#/exposure', heading: '1. Exposure metrics', gallery: true,
      capJa: '同じデータから R で描いた PK と PK-PD の図。左右にスワイプ。',
      capEn: 'PK and PK-PD figures drawn in R from the same data. Swipe.' },
    { ja: 'ER モデリング', en: 'ER modeling', hash: '#/exposure', heading: '3. Statistical modeling',
      capJa: '曝露指標 × エンドポイントごとにロジスティック / Cox モデル。',
      capEn: 'Logistic and Cox models per exposure metric and endpoint.' },
    { ja: '報告書', en: 'Report', hash: '#/exposure', heading: '4. Review report',
      capJa: '出力：根拠付きのレビュー用報告書。Word / PDF。',
      capEn: 'Output: a reviewer-facing report with evidence links. Word / PDF.' },
  ];
  const IDLE_MS = 180000;
  let current = 0;

  const bar = document.createElement('nav');
  bar.id = 'tourBar';
  bar.innerHTML = '<div class="tour-brand">Keiji AI<small>ER analysis in 6 steps · 6 ステップ</small></div>'
    + '<div class="tour-stops">' + STOPS.map((s, i) =>
      `<button type="button" data-stop="${i}"><b>${i + 1}</b><span><em>${s.ja}</em>${s.en}</span></button>`).join('')
    + '</div>';
  document.body.appendChild(bar);
  const cap = document.createElement('div');
  cap.id = 'tourCap';
  document.body.appendChild(cap);

  // Figures from the same recorded run (R Shiny workbench output; the replay cannot run R).
  const FIGS = [
    { src: 'figures/pk_01_by_cycle.png', ja: 'PK — 採血時点・サイクル・用量群別の Intact ADC 濃度', en: 'PK: intact ADC by sampling time, cycle and dose group' },
    { src: 'figures/pk_02_individual_c1.png', ja: 'PK — Cycle 1 の個別プロファイルと用量群の中央値', en: 'PK: individual Cycle 1 profiles with dose-group medians' },
    { src: 'figures/pk_03_exposure_vs_outcome.png', ja: 'PK-PD — Cycle 1 曝露と奏効 / Grade 3 以上 TEAE', en: 'PK-PD: Cycle 1 exposure by response and by grade 3+ TEAE' },
    { src: 'figures/swim_arm_a.png', ja: 'PD — スイマープロット：投与、奏効、Grade 3 以上 AE を一枚に', en: 'PD: swimmer plot with dosing, response and grade 3+ AEs per subject' },
    { src: 'figures/03_er_response.png', ja: 'ER — Cycle 1 Cmax と確定奏効のロジスティック回帰', en: 'ER: logistic regression of confirmed response on Cycle 1 Cmax' },
    { src: 'figures/04_er_safety.png', ja: 'ER — Cycle 1 AUC と Grade 3 以上 TEAE', en: 'ER: grade 3+ TEAE against Cycle 1 AUC' },
  ];
  const gallery = document.createElement('div');
  gallery.id = 'tourGallery';
  gallery.innerHTML = '<div class="tg-head"><b>PK / PK-PD 図 · Figures</b><span>R で描画 · 左右にスワイプ　|　Drawn in R from the mock data · swipe</span></div>'
    + '<div class="tg-track">' + FIGS.map(f => `<figure><img src="${f.src}" alt=""><figcaption><em>${f.ja}</em>${f.en}</figcaption></figure>`).join('') + '</div>';
  document.body.appendChild(gallery);
  function showGallery(on) {
    gallery.classList.toggle('is-open', on);
    if (on) gallery.querySelector('.tg-track').scrollTo({ left: 0 });
  }

  function findHeading(text) {
    const page = document.querySelector('#workflowPage');
    if (!page) return null;
    for (const el of page.querySelectorAll('strong, h4, h3')) {
      if ((el.textContent || '').trim().startsWith(text)) return el;
    }
    return null;
  }

  function scrollToHeading(text, tries = 25) {
    const el = findHeading(text);
    const page = document.querySelector('#workflowPage');
    if (el && page) {
      const top = el.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop - 16;
      page.scrollTo({ top, behavior: 'smooth' });
      return;
    }
    if (tries > 0) setTimeout(() => scrollToHeading(text, tries - 1), 200);
  }

  function go(i) {
    current = Math.max(0, Math.min(STOPS.length - 1, i));
    const stop = STOPS[current];
    paint();
    cap.innerHTML = `<i>${current + 1}</i><div><b>${stop.capJa}</b><span>${stop.capEn}</span></div>`;
    showGallery(!!stop.gallery);
    const samePage = location.hash === stop.hash;
    if (!samePage) location.hash = stop.hash;
    if (stop.heading) {
      setTimeout(() => scrollToHeading(stop.heading), samePage ? 0 : 400);
    } else {
      setTimeout(() => { const p = document.querySelector('#workflowPage'); if (p) p.scrollTo({ top: 0 }); }, samePage ? 0 : 400);
    }
  }

  function paint() {
    bar.querySelectorAll('button').forEach((b, i) => b.classList.toggle('is-active', i === current));
  }

  bar.addEventListener('click', e => {
    const b = e.target.closest('button[data-stop]');
    if (b) go(Number(b.dataset.stop));
  });

  // Idle: back to the first stop so the next visitor starts at the beginning.
  let timer;
  function arm() { clearTimeout(timer); timer = setTimeout(() => go(0), IDLE_MS); }
  ['touchstart', 'pointerdown', 'keydown', 'wheel'].forEach(ev => document.addEventListener(ev, arm, { passive: true }));
  arm();

  window.addEventListener('load', () => setTimeout(() => go(0), 300));
})();
