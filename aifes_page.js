// AI FES. ページ（UX最適化版）
const aifesPageHTML = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI FES. 2026 | AI×建築の祭典</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --black: #1a1a1a;
      --gray-900: #333;
      --gray-600: #666;
      --gray-400: #999;
      --gray-200: #e5e5e5;
      --gray-100: #f5f5f5;
      --white: #fff;
      --accent: #0ea5e9;
      --accent-light: #38bdf8;
      --accent-gradient: linear-gradient(135deg, #2dd4bf, #0ea5e9);
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', sans-serif;
      background: var(--gray-100);
      color: var(--gray-900);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }

    .page { max-width: 680px; margin: 0 auto; padding: 24px 16px 80px; }

    /* ========== ヘッダー ========== */
    .hero {
      background: var(--black);
      color: var(--white);
      padding: 48px 32px;
      border-radius: 16px;
      text-align: center;
      margin-bottom: 24px;
    }
    .hero-logo { width: 64px; height: 64px; margin-bottom: 16px; }
    .hero h1 { font-size: 28px; font-weight: 700; letter-spacing: 4px; margin-bottom: 8px; }
    .hero-meta { font-size: 14px; opacity: 0.8; }
    .hero-meta span { margin: 0 8px; }

    /* ========== セクション共通 ========== */
    .section {
      background: var(--white);
      border-radius: 12px;
      padding: 32px 24px;
      margin-bottom: 16px;
    }
    .section-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--gray-400);
      letter-spacing: 2px;
      margin-bottom: 12px;
    }
    .section-title {
      font-size: 20px;
      font-weight: 700;
      color: var(--black);
      margin-bottom: 20px;
    }

    /* ========== 価値提案 ========== */
    .value-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .value-item {
      display: flex;
      gap: 16px;
      align-items: flex-start;
    }
    .value-num {
      width: 32px;
      height: 32px;
      background: var(--black);
      color: var(--white);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 600;
      flex-shrink: 0;
    }
    .value-content h4 {
      font-size: 15px;
      font-weight: 600;
      color: var(--black);
      margin-bottom: 4px;
    }
    .value-content p {
      font-size: 13px;
      color: var(--gray-600);
    }

    /* ========== 想いセクション ========== */
    .why-section {
      background: var(--white);
      border-radius: 12px;
      padding: 32px 24px;
      margin-bottom: 16px;
      position: relative;
    }
    .why-quote {
      position: relative;
      padding-left: 24px;
    }
    .why-quote::before {
      content: '"';
      position: absolute;
      top: -20px;
      left: -8px;
      font-size: 80px;
      font-family: Georgia, serif;
      color: var(--accent);
      opacity: 0.3;
      line-height: 1;
    }
    .why-text {
      font-size: 15px;
      line-height: 2;
      color: var(--gray-600);
    }
    .why-text p {
      margin-bottom: 16px;
    }
    .why-text strong {
      color: var(--black);
      font-weight: 600;
    }
    .why-highlight {
      font-size: 18px;
      font-weight: 700;
      color: var(--black);
      margin-top: 8px;
    }
    .why-author {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid var(--gray-200);
    }
    .why-author-icon {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      object-fit: cover;
    }
    .why-author-info {
      font-size: 13px;
    }
    .why-author-name {
      font-weight: 600;
      color: var(--black);
    }
    .why-author-role {
      color: var(--gray-400);
    }

    /* ========== 製品紹介 ========== */
    .products-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .product-card {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px;
      background: var(--gray-100);
      border-radius: 10px;
      transition: all 0.2s;
    }
    .product-card:hover {
      background: var(--gray-200);
    }
    .product-icon {
      width: 48px;
      height: 48px;
      background: var(--accent-gradient);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--white);
      font-size: 20px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .product-info {
      flex: 1;
    }
    .product-name {
      font-size: 15px;
      font-weight: 700;
      color: var(--black);
      margin-bottom: 2px;
    }
    .product-desc {
      font-size: 13px;
      color: var(--gray-600);
      line-height: 1.5;
    }
    .product-try {
      font-size: 12px;
      color: var(--accent);
      text-decoration: none;
      font-weight: 600;
      white-space: nowrap;
      padding: 8px 12px;
      border: 1px solid var(--accent);
      border-radius: 6px;
      transition: all 0.2s;
    }
    .product-try:hover {
      background: var(--accent);
      color: var(--white);
    }
    .products-note {
      text-align: center;
      font-size: 12px;
      color: var(--gray-400);
      margin-top: 12px;
    }
    @media (max-width: 540px) {
      .product-card { flex-direction: column; text-align: center; gap: 12px; }
      .product-try { width: 100%; text-align: center; }
    }

    /* ========== 参加方法の選択 ========== */
    .choice-section { background: transparent; padding: 0; }
    .choice-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    @media (max-width: 540px) {
      .choice-grid { grid-template-columns: 1fr; }
      .pop-callout { font-size: 12px; padding: 10px 12px; }
      .circle-benefits { gap: 6px; }
      .circle-benefit-tag { font-size: 11px; padding: 6px 12px; }
      .circle-flow-steps { gap: 8px; }
      .circle-flow-step { font-size: 13px; }
      .circle-cta-btn { padding: 16px 32px; font-size: 15px; width: 100%; }
      .ticket-item { flex-direction: column; gap: 12px; align-items: flex-start; }
      .ticket-right { width: 100%; justify-content: space-between; }
    }
    .choice-card {
      background: var(--white);
      border: 2px solid var(--gray-200);
      border-radius: 12px;
      padding: 24px 20px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .choice-card:hover {
      border-color: var(--black);
    }
    .choice-card.recommended {
      border-color: var(--accent);
      position: relative;
    }
    .choice-badge {
      position: absolute;
      top: -10px;
      left: 16px;
      background: var(--accent-gradient);
      color: var(--white);
      font-size: 10px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 4px;
      letter-spacing: 1px;
    }
    .choice-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .choice-name {
      font-size: 16px;
      font-weight: 700;
      color: var(--black);
    }
    .choice-price {
      font-size: 14px;
      color: var(--gray-600);
    }
    .choice-price strong {
      font-size: 20px;
      color: var(--black);
    }
    .choice-desc {
      font-size: 13px;
      color: var(--gray-600);
      margin-bottom: 16px;
      line-height: 1.7;
    }
    .choice-btn {
      display: block;
      width: 100%;
      padding: 12px;
      background: var(--black);
      color: var(--white);
      text-decoration: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      text-align: center;
      transition: background 0.2s;
    }
    .choice-btn:hover { background: #333; }
    .choice-btn.secondary {
      background: var(--white);
      color: var(--black);
      border: 1px solid var(--gray-200);
    }
    .choice-btn.secondary:hover {
      background: var(--gray-100);
    }

    /* ========== サークル詳細 ========== */
    .circle-detail {
      background: var(--white);
      border: 2px solid var(--accent);
      border-radius: 16px;
      padding: 32px 24px;
      margin-bottom: 16px;
      position: relative;
    }
    .circle-detail::before {
      content: 'RECOMMEND';
      position: absolute;
      top: -12px;
      left: 24px;
      background: var(--accent-gradient);
      color: var(--white);
      font-size: 10px;
      font-weight: 700;
      padding: 4px 12px;
      border-radius: 4px;
      letter-spacing: 1px;
    }
    .circle-detail .section-label { color: var(--accent); }
    .circle-detail .section-title { color: var(--black); }

    .circle-benefits {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: center;
      margin-bottom: 24px;
    }
    .circle-benefit-tag {
      background: linear-gradient(135deg, rgba(45,212,191,0.15), rgba(14,165,233,0.15));
      border: 1px solid var(--accent);
      color: var(--accent);
      font-size: 13px;
      font-weight: 600;
      padding: 8px 16px;
      border-radius: 24px;
    }

    .circle-flow {
      background: var(--gray-100);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .circle-flow-title {
      font-size: 13px;
      color: var(--gray-600);
      text-align: center;
      margin-bottom: 16px;
    }
    .circle-flow-steps {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .circle-flow-step {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      color: var(--gray-900);
    }
    .circle-flow-num {
      width: 24px;
      height: 24px;
      background: var(--accent-gradient);
      color: var(--white);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
    }
    .circle-flow-arrow {
      color: var(--gray-400);
      font-size: 18px;
    }

    .circle-cta {
      text-align: center;
    }
    .circle-cta-note {
      font-size: 13px;
      color: var(--accent);
      font-weight: 500;
      margin-bottom: 12px;
    }
    .circle-cta-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: var(--accent-gradient);
      color: var(--white);
      text-decoration: none;
      font-size: 16px;
      font-weight: 700;
      padding: 18px 48px;
      border-radius: 12px;
      box-shadow: 0 4px 16px rgba(14,165,233,0.4);
      transition: all 0.2s;
    }
    .circle-cta-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 24px rgba(14,165,233,0.5);
    }
    .circle-cta-btn svg {
      width: 20px;
      height: 20px;
    }
    .circle-cta-sub {
      font-size: 12px;
      color: var(--gray-400);
      margin-top: 12px;
    }
    .circle-cta-sub a {
      color: var(--gray-600);
      text-decoration: underline;
    }

    .circle-note {
      font-size: 12px;
      text-align: center;
      margin-top: 16px;
      color: var(--gray-600);
    }

    /* ========== ポップ要素 ========== */
    .pop-callout {
      background: var(--accent-gradient);
      color: var(--white);
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      text-align: center;
      margin-bottom: 16px;
      position: relative;
    }
    .pop-callout::after {
      content: '';
      position: absolute;
      bottom: -8px;
      left: 50%;
      transform: translateX(-50%);
      border-left: 8px solid transparent;
      border-right: 8px solid transparent;
      border-top: 8px solid var(--accent);
    }
    .pop-tag {
      display: inline-block;
      background: var(--accent-gradient);
      color: var(--white);
      font-size: 11px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 4px;
      margin-left: 8px;
    }
    .highlight-box {
      background: linear-gradient(135deg, rgba(45,212,191,0.1), rgba(14,165,233,0.1));
      border: 1px solid rgba(14,165,233,0.3);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .benefit-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .benefit-item {
      background: var(--white);
      border: 1px solid var(--accent);
      color: var(--accent);
      font-size: 12px;
      font-weight: 500;
      padding: 6px 12px;
      border-radius: 20px;
    }

    /* ========== 既存会員向け ========== */
    .member-box {
      background: var(--gray-100);
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 16px;
    }
    .member-box h4 {
      font-size: 13px;
      font-weight: 600;
      color: var(--black);
      margin-bottom: 4px;
    }
    .member-box p {
      font-size: 13px;
      color: var(--gray-600);
    }

    /* ========== 単発チケット ========== */
    .ticket-info {
      background: var(--gray-100);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 20px;
    }
    .ticket-info-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }
    .ticket-info-badge {
      background: var(--accent-gradient);
      color: var(--white);
      font-size: 10px;
      font-weight: 600;
      padding: 4px 8px;
      border-radius: 4px;
    }
    .ticket-info-title {
      font-size: 13px;
      color: var(--gray-600);
    }
    .ticket-info-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .ticket-info-item {
      display: flex;
      gap: 12px;
      font-size: 13px;
    }
    .ticket-info-time {
      width: 85px;
      color: var(--gray-400);
      flex-shrink: 0;
    }
    .ticket-info-name { color: var(--gray-900); }

    .ticket-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .ticket-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px;
      border: 1px solid var(--gray-200);
      border-radius: 10px;
      transition: all 0.2s;
    }
    .ticket-item:hover {
      border-color: var(--gray-400);
    }
    .ticket-item.featured {
      border: 2px solid var(--black);
    }
    .ticket-left { flex: 1; }
    .ticket-name {
      font-size: 15px;
      font-weight: 600;
      color: var(--black);
      margin-bottom: 4px;
    }
    .ticket-meta {
      font-size: 12px;
      color: var(--gray-400);
    }
    .ticket-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .ticket-price {
      font-size: 18px;
      font-weight: 700;
      color: var(--black);
    }
    .ticket-btn-small {
      padding: 10px 20px;
      background: var(--black);
      color: var(--white);
      text-decoration: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
    }
    .ticket-btn-small:hover { background: #333; }

    /* ========== タイムライン ========== */
    .timeline {
      position: relative;
      padding-left: 24px;
    }
    .timeline::before {
      content: '';
      position: absolute;
      left: 7px;
      top: 8px;
      bottom: 8px;
      width: 2px;
      background: var(--gray-200);
    }
    .timeline-item {
      position: relative;
      padding-bottom: 20px;
    }
    .timeline-item:last-child { padding-bottom: 0; }
    .timeline-dot {
      position: absolute;
      left: -20px;
      top: 6px;
      width: 10px;
      height: 10px;
      background: var(--gray-400);
      border-radius: 50%;
    }
    .timeline-dot.highlight { background: var(--black); }
    .timeline-time {
      font-size: 12px;
      color: var(--gray-400);
      margin-bottom: 2px;
    }
    .timeline-title {
      font-size: 14px;
      font-weight: 500;
      color: var(--black);
    }
    .timeline-title.break {
      color: var(--gray-400);
      font-weight: 400;
    }
    .timeline-tag {
      display: inline-block;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 3px;
      margin-left: 8px;
      background: var(--gray-100);
      color: var(--gray-600);
    }
    .timeline-tag.common { background: var(--accent-gradient); color: var(--white); }

    /* ========== FAQ ========== */
    .faq-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .faq-item {}
    .faq-q {
      font-size: 14px;
      font-weight: 600;
      color: var(--black);
      margin-bottom: 6px;
      display: flex;
      gap: 8px;
    }
    .faq-q::before {
      content: 'Q';
      background: var(--black);
      color: var(--white);
      width: 20px;
      height: 20px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .faq-a {
      font-size: 13px;
      color: var(--gray-600);
      padding-left: 28px;
      line-height: 1.7;
    }

    /* ========== フッター ========== */
    .footer {
      text-align: center;
      padding: 24px;
      font-size: 12px;
      color: var(--gray-400);
    }
    .footer a {
      color: var(--gray-600);
      text-decoration: none;
    }
    .footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="page">

    <!-- ========== ヘッダー ========== -->
    <div class="hero">
      <img src="/public/aifes-logo.png" alt="AI FES." class="hero-logo">
      <h1>AI FES.</h1>
      <p class="hero-meta">
        <span>2026.1.25 SAT</span>
        <span>ONLINE</span>
        <span>10:00-22:00</span>
      </p>
    </div>

    <!-- ========== 価値提案 ========== -->
    <div class="section">
      <p class="section-label">WHAT YOU'LL GET</p>
      <h2 class="section-title">1日で建築×AIの最前線をキャッチアップ</h2>
      <div class="value-list">
        <div class="value-item">
          <div class="value-num">1</div>
          <div class="value-content">
            <h4>最新AI Newsまとめ</h4>
            <p>建築業界に関係する直近30日のAIニュースを厳選解説</p>
          </div>
        </div>
        <div class="value-item">
          <div class="value-num">2</div>
          <div class="value-content">
            <h4>実務で使えるセミナー</h4>
            <p>AI×建築、画像生成AI、GAS自動化の実践講座</p>
          </div>
        </div>
        <div class="value-item">
          <div class="value-num">3</div>
          <div class="value-content">
            <h4>プロダクト体験＆プレゼント</h4>
            <p>COMPASS / SpotPDF / KAKOMEのデモ＋参加者特典</p>
          </div>
        </div>
      </div>
    </div>

    <!-- ========== 製品紹介 ========== -->
    <div class="section">
      <p class="section-label">PRODUCTS</p>
      <h2 class="section-title">サークル会員が使える製品</h2>
      <p style="font-size: 13px; color: var(--gray-600); margin-bottom: 20px; text-align: center;">全て直感的で使いやすい。まずはデモで体験してみてください</p>

      <div class="products-grid">
        <div class="product-card">
          <div class="product-icon">C</div>
          <div class="product-info">
            <div class="product-name">COMPASS</div>
            <div class="product-desc">案件・タスク・進捗を一元管理して、チームの動きを「見える化」するプロジェクト管理ツール</div>
          </div>
          <a href="https://compass-demo.web.app/" target="_blank" class="product-try">デモを試す</a>
        </div>

        <div class="product-card">
          <div class="product-icon">K</div>
          <div class="product-info">
            <div class="product-name">KAKOME <span style="font-size: 10px; color: #10b981; font-weight: 500;">無料</span></div>
            <div class="product-desc">現場写真や図面を囲って指示できる、解体・改修の「共有が速い」マーキングツール</div>
          </div>
          <a href="https://note.com/sena_aiarchitect/n/n210b9291566d" target="_blank" class="product-try">詳細を見る</a>
        </div>

        <div class="product-card">
          <div class="product-icon">S</div>
          <div class="product-info">
            <div class="product-name">SpotPDF <span style="font-size: 10px; color: var(--accent); font-weight: 500;">サークル限定</span></div>
            <div class="product-desc">図面PDFの差分確認・チェック・注釈を高速化する、レビュー特化ツール</div>
          </div>
          <a href="https://spotpdf.com/" target="_blank" class="product-try">詳細を見る</a>
        </div>
      </div>

      <p class="products-note">サークル入会後は全製品が使い放題になります</p>
    </div>

    <!-- ========== 想い ========== -->
    <div class="why-section">
      <p class="section-label">WHY AI FES.</p>
      <h2 class="section-title">AI FES.をやる理由</h2>

      <div class="why-quote">
        <div class="why-text">
          <p>
            元々、GAS自動化やGoogleでの無料ホームページ作成、新ツール『COMPASS』のお披露目会など、細かく分けて何度もセミナーをやろうとしていました。
          </p>
          <p>
            でも、よく考えたら<strong>皆さんも僕も毎日めちゃくちゃ忙しい。</strong>何度も参加する時間なんて無いですよね。
          </p>
          <p>
            だから月に1回だけ、<strong>AIを強制的に触れる日を作りました。</strong>
          </p>
          <p class="why-highlight">それが『AI FES.』です。</p>
        </div>

        <div class="why-author">
          <img src="/public/sena-profile.jpg" alt="sena" class="why-author-icon">
          <div class="why-author-info">
            <div class="why-author-name">sena</div>
            <div class="why-author-role">AI×建築サークル 主宰</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ========== 参加方法の選択 ========== -->
    <div class="section choice-section">
      <p class="section-label">HOW TO JOIN</p>
      <h2 class="section-title" style="margin-bottom: 16px;">参加方法を選ぶ</h2>

      <div class="pop-callout">
        サークル入会ならAI FES.無料 + 製品も使い放題
      </div>

      <div class="choice-grid">
        <div class="choice-card recommended">
          <div class="choice-badge">おすすめ</div>
          <div class="choice-header">
            <span class="choice-name">AI×建築サークル</span>
            <span class="choice-price">月額<strong>¥5,000</strong></span>
          </div>
          <p class="choice-desc">
            AI FES.無料 + 製品使い放題 + Discordコミュニティ。いつでも解約OK！
          </p>
          <a href="#circle-detail" class="choice-btn" style="background: var(--accent-gradient);">詳しく見る ↓</a>
        </div>

        <div class="choice-card">
          <div class="choice-header">
            <span class="choice-name">単発チケット</span>
            <span class="choice-price"><strong>¥3,000</strong>〜</span>
          </div>
          <p class="choice-desc">
            見たいセミナーだけ選んで購入。共通セッションも視聴可能。
          </p>
          <a href="#tickets" class="choice-btn secondary">チケットを見る ↓</a>
        </div>
      </div>
    </div>

    <!-- ========== サークル詳細 ========== -->
    <div class="circle-detail" id="circle-detail">
      <p class="section-label">AI×建築サークル</p>
      <h2 class="section-title">月額¥5,000で全部手に入る</h2>

      <div class="circle-benefits">
        <span class="circle-benefit-tag">AI FES.無料参加</span>
        <span class="circle-benefit-tag">COMPASS使い放題</span>
        <span class="circle-benefit-tag">SpotPDF使い放題</span>
        <span class="circle-benefit-tag">Discordコミュニティ</span>
      </div>

      <div class="circle-flow">
        <p class="circle-flow-title">入会後の流れ</p>
        <div class="circle-flow-steps">
          <div class="circle-flow-step">
            <span class="circle-flow-num">1</span>
            <span>入会</span>
          </div>
          <span class="circle-flow-arrow">→</span>
          <div class="circle-flow-step">
            <span class="circle-flow-num">2</span>
            <span>製品を試す</span>
          </div>
          <span class="circle-flow-arrow">→</span>
          <div class="circle-flow-step">
            <span class="circle-flow-num">3</span>
            <span>AI FES.参加</span>
          </div>
        </div>
      </div>

      <div class="circle-cta">
        <p class="circle-cta-note">いつでも解約OK・違約金なし</p>
        <a href="/" class="circle-cta-btn">
          まずは1ヶ月試してみる
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </a>
        <p class="circle-cta-sub"><a href="https://suz-u3n-chu.github.io/AI-Architecture-Circle/" target="_blank">サークル詳細を見る</a></p>
      </div>

      <p class="circle-note">入会後、AI FES.参加URLがメールで届きます</p>
    </div>

    <!-- ========== 既存会員向け ========== -->
    <div class="member-box">
      <h4>既にAI×建築サークル会員の方へ</h4>
      <p>入会時にZoom参加URLをお送り済みです。届いていない場合はDiscordでお問い合わせください。</p>
    </div>

    <!-- ========== 単発チケット ========== -->
    <div class="section" id="tickets">
      <p class="section-label">SINGLE TICKETS</p>
      <h2 class="section-title">単発チケット</h2>

      <div class="ticket-info">
        <div class="ticket-info-header">
          <span class="ticket-info-badge">全チケット共通</span>
          <span class="ticket-info-title">どのチケットでも視聴可能</span>
        </div>
        <div class="ticket-info-list">
          <div class="ticket-info-item">
            <span class="ticket-info-time">10:15-11:30</span>
            <span class="ticket-info-name">最新AI Newsまとめ</span>
          </div>
          <div class="ticket-info-item">
            <span class="ticket-info-time">17:30-18:50</span>
            <span class="ticket-info-name">製品デモ（COMPASS / SpotPDF / KAKOME）</span>
          </div>
          <div class="ticket-info-item">
            <span class="ticket-info-time">21:00-22:00</span>
            <span class="ticket-info-name">フィナーレ（プレゼント配布＋質問タイム）</span>
          </div>
        </div>
      </div>

      <div class="ticket-list">
        <div class="ticket-item featured">
          <div class="ticket-left">
            <div class="ticket-name">1日通しチケット</div>
            <div class="ticket-meta">全セッション視聴可能 / 10:00-22:00</div>
          </div>
          <div class="ticket-right">
            <div class="ticket-price">¥9,800</div>
            <a href="https://buy.stripe.com/aFacN7ezX6SV8zfcSrf7i03" target="_blank" class="ticket-btn-small">購入</a>
          </div>
        </div>

        <div class="ticket-item">
          <div class="ticket-left">
            <div class="ticket-name">実務AI×建築セミナー</div>
            <div class="ticket-meta">13:35-16:00 + 共通セッション</div>
          </div>
          <div class="ticket-right">
            <div class="ticket-price">¥5,000</div>
            <a href="https://buy.stripe.com/14A00lezX4KNdTz5pZf7i04" target="_blank" class="ticket-btn-small">購入</a>
          </div>
        </div>

        <div class="ticket-item">
          <div class="ticket-left">
            <div class="ticket-name">画像生成AIセミナー</div>
            <div class="ticket-meta">16:00-17:30 + 共通セッション</div>
          </div>
          <div class="ticket-right">
            <div class="ticket-price">¥4,000</div>
            <a href="https://buy.stripe.com/5kQ9AVcrP1yB5n3aKjf7i05" target="_blank" class="ticket-btn-small">購入</a>
          </div>
        </div>

        <div class="ticket-item">
          <div class="ticket-left">
            <div class="ticket-name">GAS＆無料HPセミナー</div>
            <div class="ticket-meta">11:45-12:35 + 19:00-21:00 + 共通セッション</div>
          </div>
          <div class="ticket-right">
            <div class="ticket-price">¥3,000</div>
            <a href="https://buy.stripe.com/7sY9AVcrP6SV4iZf0zf7i06" target="_blank" class="ticket-btn-small">購入</a>
          </div>
        </div>
      </div>
    </div>

    <!-- ========== タイムスケジュール ========== -->
    <div class="section">
      <p class="section-label">TIME SCHEDULE</p>
      <h2 class="section-title">タイムスケジュール</h2>

      <div class="timeline">
        <div class="timeline-item">
          <div class="timeline-dot highlight"></div>
          <div class="timeline-time">10:00-10:15</div>
          <div class="timeline-title">オープニング<span class="timeline-tag common">共通</span></div>
        </div>
        <div class="timeline-item">
          <div class="timeline-dot highlight"></div>
          <div class="timeline-time">10:15-11:30</div>
          <div class="timeline-title">最新AI Newsまとめ<span class="timeline-tag common">共通</span></div>
        </div>
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div class="timeline-time">11:30-11:45</div>
          <div class="timeline-title break">休憩</div>
        </div>
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div class="timeline-time">11:45-12:35</div>
          <div class="timeline-title">GAS＆業務自動化<span class="timeline-tag">GAS</span></div>
        </div>
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div class="timeline-time">12:35-13:35</div>
          <div class="timeline-title break">お昼休み</div>
        </div>
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div class="timeline-time">13:35-16:00</div>
          <div class="timeline-title">実務で使えるAI×建築セミナー<span class="timeline-tag">実務AI</span></div>
        </div>
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div class="timeline-time">16:00-17:30</div>
          <div class="timeline-title">画像生成AIセミナー<span class="timeline-tag">画像生成</span></div>
        </div>
        <div class="timeline-item">
          <div class="timeline-dot highlight"></div>
          <div class="timeline-time">17:30-18:50</div>
          <div class="timeline-title">製品デモ + 質問タイム<span class="timeline-tag common">共通</span></div>
        </div>
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div class="timeline-time">18:50-19:00</div>
          <div class="timeline-title break">休憩</div>
        </div>
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div class="timeline-time">19:00-21:00</div>
          <div class="timeline-title">無料HP作成セミナー<span class="timeline-tag">GAS</span></div>
        </div>
        <div class="timeline-item">
          <div class="timeline-dot highlight"></div>
          <div class="timeline-time">21:00-22:00</div>
          <div class="timeline-title">フィナーレ（プレゼント配布＋質問）<span class="timeline-tag common">共通</span></div>
        </div>
      </div>
    </div>

    <!-- ========== FAQ ========== -->
    <div class="section">
      <p class="section-label">FAQ</p>
      <h2 class="section-title">よくある質問</h2>

      <div class="faq-list">
        <div class="faq-item">
          <div class="faq-q">アーカイブ配信はありますか？</div>
          <p class="faq-a">はい、全セッションのアーカイブを後日配信します。当日参加できなくても視聴可能です。</p>
        </div>
        <div class="faq-item">
          <div class="faq-q">途中参加・途中退出はできますか？</div>
          <p class="faq-a">はい、Zoomなのでいつでも入退室可能です。興味のあるセッションだけの参加もOKです。</p>
        </div>
        <div class="faq-item">
          <div class="faq-q">AI×建築サークルの解約方法は？</div>
          <p class="faq-a">Stripeの管理画面からいつでも解約できます。解約要件や違約金はありません。</p>
        </div>
        <div class="faq-item">
          <div class="faq-q">購入後のメールが届きません</div>
          <p class="faq-a">迷惑メールフォルダをご確認ください。それでも届かない場合はお問い合わせください。</p>
        </div>
      </div>
    </div>

    <!-- ========== フッター ========== -->
    <div class="footer">
      <p style="margin-bottom: 24px;">ご不明点は <a href="mailto:ai.archi.circle@archi-prisma.co.jp">ai.archi.circle@archi-prisma.co.jp</a> まで</p>
      <div style="opacity: 0.5; display: flex; align-items: center; justify-content: center; gap: 8px;">
        <span style="font-size: 11px;">Developed by</span>
        <img src="/public/archi-prisma-logo.png" alt="ARCHI-PRISMA" style="height: 32px;">
      </div>
    </div>

  </div>

  <script>
    // スムーススクロール
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function(e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  </script>
</body>
</html>
`;

module.exports = { aifesPageHTML };
