// ==UserScript==
// @name         Upland Tools
// @namespace    https://github.com/WallCod/upland-bulk-list
// @downloadURL  https://raw.githubusercontent.com/WallCod/upland-bulk-list/master/bulk-list-items.user.js
// @updateURL    https://raw.githubusercontent.com/WallCod/upland-bulk-list/master/bulk-list-items.user.js
// @version      1.1.2
// @description  Bulk-list identical items in the Showroom at the same price, one at a time, without clicking through each unit manually.
// @author       WallCod
// @match        https://play.upland.me/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const REPORT_ENDPOINT = 'https://api.alphalabs.fyi/webhook/tool-error';
  const TOOL_NAME = 'upland-bulk-list';

  // Mantém as últimas linhas de log em memória (não só o que está visível na
  // caixinha de status) para poder anexar ao report de erro mesmo se o
  // usuário já tiver fechado/limpado a tela de status.
  const recentLogLines = [];
  const MAX_LOG_LINES = 60;
  function recordLogLine(msg) {
    recentLogLines.push(msg);
    if (recentLogLines.length > MAX_LOG_LINES) recentLogLines.shift();
  }

  const STEP_DELAY_MS = 700; // espera entre cliques/digitação, dá tempo da UI reagir
  const WAIT_TIMEOUT_MS = 15000; // tempo máximo esperando um elemento aparecer (confirmação envolve chamada de rede)
  // Depois de listar, a transação ainda precisa confirmar on-chain antes do
  // backend parar de mostrar o item como disponível na lista. Se reabrirmos
  // rápido demais, o item aparece "fantasma" (ainda visível mas já vendido)
  // e o clique nele falha silenciosamente. Esperamos esse tempo antes de
  // reabrir "List my map assets" para o próximo item.
  const CONFIRMATION_DELAY_MS = 12000;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Interceptor da chamada real de submissão (items/submit). Detectar
  // sucesso/erro pelo texto da tela é frágil (o texto "successfully listed"
  // de uma listagem anterior pode continuar no DOM por um instante e ser
  // lido por engano). O status HTTP da resposta é a fonte da verdade.
  // Intercepta tanto fetch quanto XMLHttpRequest pois não temos certeza de
  // qual API o jogo usa para essa chamada específica.
  let lastSubmitResult = null; // { ok, status } da última chamada items/submit
  (function interceptSubmit() {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const url = args[0]?.url || args[0];
      const res = await originalFetch.apply(this, args);
      if (typeof url === 'string' && url.includes('/items/submit')) {
        lastSubmitResult = { ok: res.ok, status: res.status };
      }
      return res;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      if (typeof url === 'string' && url.includes('/items/submit')) {
        this.addEventListener('loadend', () => {
          lastSubmitResult = { ok: this.status >= 200 && this.status < 300, status: this.status };
        });
      }
      return originalOpen.call(this, method, url, ...rest);
    };
  })();

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    // Elementos fora da área visível da viewport (ex: outro modal/componente
    // posicionado abaixo da tela) passam no teste de display/visibility mas
    // não são o elemento que o usuário realmente vê — checa a posição real.
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) return false;
    if (rect.right <= 0 || rect.left >= window.innerWidth) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  // Pode haver múltiplos elementos com o mesmo texto/seletor na página ao
  // mesmo tempo (ex: componentes escondidos fora de tela); pega só o visível.
  function findByText(selector, text) {
    const needle = text.trim().toLowerCase();
    return [...document.querySelectorAll(selector)].find(
      el => el.textContent.trim().toLowerCase() === needle && isVisible(el)
    );
  }

  function queryVisible(selector) {
    return [...document.querySelectorAll(selector)].find(isVisible) || null;
  }

  async function waitFor(fn, timeoutMs = WAIT_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = fn();
      if (result) return result;
      await sleep(150);
    }
    return null;
  }

  // Identificador único de uma unidade específica do item, extraído do
  // texto "MINT#:N" mostrado abaixo do nome no card. Usado para não
  // re-selecionar uma unidade já marcada como problemática (falhou
  // repetidamente) — sem isso, "pular para a próxima" na prática re-seleciona
  // sempre o mesmo primeiro card que bate com o nome buscado.
  function extractMintId(card) {
    const text = card.textContent || '';
    const m = text.match(/MINT#:(\S+)/i);
    return m ? m[1] : null;
  }

  // Acha o card do item cujo nome bate (comparação exata, case-insensitive)
  // e retorna o botão "select" dentro dele. O nome do item fica num elemento
  // dentro de ".title" (ex: <div class="title"><div class="sc-dveOmK ia-dLNm">NOME</div>...)
  // Ignora unidades cujo MINT# está em skipMints (falharam persistentemente antes).
  function findSelectButtonForItem(itemName, skipMints) {
    const needle = itemName.trim().toLowerCase();
    const titleEls = document.querySelectorAll('.title');

    for (const title of titleEls) {
      const nameEl = title.firstElementChild;
      if (!nameEl || nameEl.textContent.trim().toLowerCase() !== needle) continue;

      // O botão "select" fica no card irmão de ".title" (mesmo container pai)
      const card = title.parentElement;
      if (!card) continue;
      if (skipMints?.size) {
        const mintId = extractMintId(card);
        if (mintId && skipMints.has(mintId)) continue;
      }
      const btn = [...card.querySelectorAll('button')].find(
        b => b.textContent.trim().toLowerCase() === 'select'
      );
      if (btn) return { btn, card };
    }
    return null;
  }

  // A lista de itens usa react-virtualized: só os itens perto da área
  // visível existem de fato no DOM, então um item mais abaixo na lista
  // pode simplesmente não estar renderizado ainda. Em vez de rolar (frágil,
  // depende de quantos itens diferentes existem antes dele), usamos o
  // campo de busca da própria tela para filtrar só pelo nome do item —
  // assim ele sempre aparece perto do topo, já renderizado.
  async function searchAndFindItem(itemName, log, skipMints) {
    let found = findSelectButtonForItem(itemName, skipMints);
    if (found) return found;

    const searchInput = await waitFor(() => document.querySelector('input[placeholder="Search"]'), 5000);
    if (!searchInput) {
      log?.('  [debug] search field did not appear');
      return null;
    }

    // Se o campo já tiver o mesmo texto de uma busca anterior, sobrescrever
    // com o mesmo valor pode não disparar o filtro do React. Limpa primeiro.
    setNativeValue(searchInput, '');
    await sleep(200);
    setNativeValue(searchInput, itemName);
    found = await waitFor(() => findSelectButtonForItem(itemName, skipMints));
    return found;
  }

  function setNativeValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function listOneItem(itemName, price, log, skipMints) {
    // 0. Garantir que a lista de itens está aberta (pode estar na tela
    // inicial da Showroom se este não é o primeiro item da rodada). A
    // navegação de volta para a Showroom após fechar a tela de sucesso nem
    // sempre é imediata, então esperamos "List my map assets" aparecer em
    // vez de checar uma única vez e desistir.
    log('  [debug] looking for the item in the current list...');
    let found = await searchAndFindItem(itemName, log, skipMints);
    if (!found) {
      log('  [debug] not found, waiting for "List my map assets" to appear...');
      const listAssetsBtn = await waitFor(() => findByText('button', 'List my map assets'));
      if (listAssetsBtn) {
        listAssetsBtn.click();
        await sleep(STEP_DELAY_MS);
      } else {
        log(`  [debug] "List my map assets" never showed up. Current URL: ${location.href}`);
      }
      found = await searchAndFindItem(itemName, log, skipMints);
    }
    if (!found) {
      log(`  [debug] item-not-found. Current URL: ${location.href}`);
      return { ok: false, reason: 'item-not-found' };
    }
    const mintId = extractMintId(found.card);
    log(`  [debug] item found (MINT#:${mintId ?? '?'}), clicking select...`);
    found.btn.click();
    await sleep(STEP_DELAY_MS);

    // 1. Esperar o campo ASK PRICE aparecer e preencher
    const priceInput = await waitFor(() => queryVisible('input[placeholder="ASK PRICE"]'));
    if (!priceInput) {
      log(`  [debug] price-input-not-found. Current URL: ${location.href}`);
      return { ok: false, reason: 'price-input-not-found', mintId };
    }
    log('  [debug] price field found, filling it in...');
    setNativeValue(priceInput, String(price));
    await sleep(STEP_DELAY_MS);

    // 2. Clicar em "List for sale"
    const listBtn = await waitFor(() => findByText('button', 'List for sale'));
    if (!listBtn) {
      log(`  [debug] list-button-not-found. Current URL: ${location.href}`);
      return { ok: false, reason: 'list-button-not-found', mintId };
    }
    log('  [debug] clicking "List for sale"...');
    listBtn.click();
    await sleep(STEP_DELAY_MS);

    // 3. Modal de confirmação -> botão verde (aria-label="success"). Reseta
    // o resultado da última submissão antes de confirmar, para capturar
    // especificamente a resposta desta tentativa.
    lastSubmitResult = null;
    const confirmBtn = await waitFor(() => queryVisible('button[aria-label="success"]'));
    if (!confirmBtn) {
      log(`  [debug] confirm-button-not-found. Current URL: ${location.href}`);
      return { ok: false, reason: 'confirm-button-not-found', mintId };
    }
    log('  [debug] confirming in the modal...');
    confirmBtn.click();

    // Espera a resposta real de items/submit chegar (fonte da verdade sobre
    // sucesso/erro — o texto da tela pode manter "successfully listed" de
    // uma listagem anterior por um instante e enganar uma checagem por texto).
    await waitFor(() => lastSubmitResult !== null);
    await sleep(STEP_DELAY_MS);

    // Espera a transição terminar: o botão "success" visível precisa sumir
    // antes de procurar o "default" da tela seguinte, senão pode achar um
    // elemento obsoleto que o React ainda não removeu.
    await waitFor(() => !queryVisible('button[aria-label="success"]'));
    await sleep(STEP_DELAY_MS);

    const outcome = lastSubmitResult?.ok ? 'success' : 'error-screen';
    if (outcome === 'error-screen') {
      log(`  [debug] server rejected the listing (HTTP ${lastSubmitResult?.status ?? '?'}). Current URL: ${location.href}`);
      const closeBtn = queryVisible('button[aria-label="default"]');
      if (closeBtn) closeBtn.click();
      await sleep(STEP_DELAY_MS);

      // Fechar a tela de erro não volta para a Showroom inicial — fica na
      // tela de detalhe do item (sem "List my map assets"). Usa o botão de
      // voltar explicitamente para garantir que a próxima tentativa comece
      // de um estado conhecido.
      const backBtn = await waitFor(() => queryVisible('button[aria-label="goBackButton"]'), 5000);
      if (backBtn) {
        backBtn.click();
        await sleep(STEP_DELAY_MS);
      }
      return { ok: false, reason: 'submit-rejected', mintId };
    }
    if (outcome !== 'success') {
      log(`  [debug] close-button-not-found. Current URL: ${location.href}`);
      return { ok: false, reason: 'close-button-not-found', mintId };
    }
    log('  [debug] closing the success screen...');
    const closeBtn = queryVisible('button[aria-label="default"]');
    closeBtn.click();
    await sleep(STEP_DELAY_MS);

    // 5. Esperar a confirmação on-chain antes de reabrir a lista — se
    // entrarmos rápido demais, o item recém-vendido ainda aparece
    // "fantasma" na lista e o clique nele falha.
    log(`Waiting for on-chain confirmation (${CONFIRMATION_DELAY_MS / 1000}s)...`);
    await sleep(CONFIRMATION_DELAY_MS);

    return { ok: true };
  }

  // Verificação rápida antes de começar a rodada inteira: confirma que o
  // item existe na Showroom e conta quantas unidades estão disponíveis
  // (via busca), para avisar o usuário antes de gastar tempo/gás tentando
  // listar algo que não existe ou que não tem unidades suficientes.
  async function checkItemAvailability(itemName) {
    let listAssetsBtn = findByText('button', 'List my map assets');
    if (listAssetsBtn) {
      listAssetsBtn.click();
      await sleep(STEP_DELAY_MS);
    }

    const searchInput = await waitFor(() => document.querySelector('input[placeholder="Search"]'), 8000);
    if (!searchInput) return { found: false, count: 0 };

    setNativeValue(searchInput, '');
    await sleep(200);
    setNativeValue(searchInput, itemName);
    await sleep(1000); // dá tempo do filtro da lista aplicar

    const needle = itemName.trim().toLowerCase();
    const matches = [...document.querySelectorAll('.title')].filter(
      title => title.firstElementChild?.textContent.trim().toLowerCase() === needle
    );
    return { found: matches.length > 0, count: matches.length };
  }

  const MAX_RETRIES_PER_ITEM = 3;
  const RETRY_BACKOFF_BASE_MS = 8000; // cresce a cada tentativa: 8s, 16s, 24s...
  // Motivos de falha que não valem retry (não são erro transitório de
  // servidor) — se acontecerem, a rodada inteira para, pois indicam que o
  // script perdeu o rastro da UI, não que um item específico está com problema.
  const FATAL_REASONS = new Set(['item-not-found', 'price-input-not-found', 'list-button-not-found', 'confirm-button-not-found', 'close-button-not-found']);

  async function runBulkListing(itemName, price, quantity, log) {
    let done = 0;
    let skipped = 0;
    // MINT#s de unidades que já falharam persistentemente — evita que a
    // busca re-selecione a mesma unidade problemática de novo.
    const skipMints = new Set();
    for (let i = 0; i < quantity; i++) {
      let result;
      for (let attempt = 0; attempt <= MAX_RETRIES_PER_ITEM; attempt++) {
        const label = attempt === 0 ? `[${i + 1}/${quantity}]` : `[${i + 1}/${quantity}] (attempt ${attempt + 1})`;
        log(`${label} Listing "${itemName}" for ${price} UPX...`);
        result = await listOneItem(itemName, price, log, skipMints);
        // "submit-rejected" costuma ser erro transitório de servidor (ex: 500,
        // possível rate limit) — vale tentar de novo, esperando mais a cada
        // vez, antes de desistir desta unidade específica.
        if (result.ok || result.reason !== 'submit-rejected') break;
        const backoff = RETRY_BACKOFF_BASE_MS * (attempt + 1);
        log(`  [debug] attempt failed (${result.reason}), waiting ${backoff / 1000}s before retrying...`);
        await sleep(backoff);
      }
      if (!result.ok) {
        if (FATAL_REASONS.has(result.reason)) {
          log(`Stopped: ${result.reason} (${done} listed successfully, ${skipped} skipped)`);
          return { done, skipped };
        }
        // submit-rejected persistente nesta unidade específica: marca o
        // MINT# como ignorado e segue para a próxima em vez de travar a
        // rodada inteira ou re-selecionar a mesma unidade de novo. Dá uma
        // pausa antes de tentar outra unidade — se o servidor já rejeitou
        // 4 vezes seguidas, insistir sem descanso tende a perpetuar o problema.
        if (result.mintId) skipMints.add(result.mintId);
        log(`  [debug] unit MINT#:${result.mintId ?? '?'} keeps failing after ${MAX_RETRIES_PER_ITEM + 1} attempts — skipping.`);
        skipped++;
        await sleep(RETRY_BACKOFF_BASE_MS);
        continue;
      }
      done++;
      await sleep(STEP_DELAY_MS);
    }
    log(`Done: ${done}/${quantity} items listed${skipped ? ` (${skipped} skipped due to persistent failure)` : ''}.`);
    return { done, skipped };
  }

  // ---------------------------------------------------------
  // UI: modal customizado (substitui prompt/alert/confirm nativos)
  // ---------------------------------------------------------
  const MODAL_Z = 1000000;

  function createModalShell() {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: MODAL_Z,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
      background: '#171a21', color: '#e4e6eb',
      border: '1px solid #2a2e37', borderRadius: '12px',
      padding: '24px', width: '360px', maxWidth: '90vw',
      fontFamily: '-apple-system, Segoe UI, Roboto, sans-serif',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    });
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    return { overlay, box };
  }

  function modalButton(text, variant) {
    const btn = document.createElement('button');
    btn.textContent = text;
    const palette = {
      primary: { bg: '#3b82f6', hover: '#2563eb' },
      neutral: { bg: '#2a2e37', hover: '#383e4a' },
    }[variant] || { bg: '#2a2e37', hover: '#383e4a' };
    Object.assign(btn.style, {
      background: palette.bg, color: '#fff', border: 'none',
      borderRadius: '8px', padding: '10px 18px', fontSize: '14px',
      cursor: 'pointer', flex: '1',
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = palette.hover; });
    btn.addEventListener('mouseleave', () => { btn.style.background = palette.bg; });
    return btn;
  }

  function modalField(labelText, placeholder, inputMode) {
    const wrap = document.createElement('label');
    Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px', fontSize: '12px', color: '#9aa0ac' });
    wrap.textContent = labelText;
    const input = document.createElement('input');
    input.placeholder = placeholder;
    input.type = 'text';
    if (inputMode) input.inputMode = inputMode;
    Object.assign(input.style, {
      background: '#0f1117', color: '#e4e6eb', border: '1px solid #2a2e37',
      borderRadius: '6px', padding: '10px', fontSize: '14px', marginTop: '2px',
    });
    wrap.appendChild(input);
    return { wrap, input };
  }

  function modalTextarea(labelText, placeholder, rows) {
    const wrap = document.createElement('label');
    Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px', fontSize: '12px', color: '#9aa0ac' });
    wrap.textContent = labelText;
    const input = document.createElement('textarea');
    input.placeholder = placeholder;
    input.rows = rows || 4;
    Object.assign(input.style, {
      background: '#0f1117', color: '#e4e6eb', border: '1px solid #2a2e37',
      borderRadius: '6px', padding: '10px', fontSize: '14px', marginTop: '2px',
      fontFamily: 'inherit', resize: 'vertical',
    });
    wrap.appendChild(input);
    return { wrap, input };
  }

  // Substitui window.alert por um modal centralizado.
  function showMessage(title, message) {
    return new Promise(resolve => {
      const { overlay, box } = createModalShell();
      box.style.textAlign = 'center';
      const h = document.createElement('h3');
      h.textContent = title;
      Object.assign(h.style, { margin: '0 0 12px', fontSize: '16px' });
      const p = document.createElement('p');
      p.textContent = message;
      Object.assign(p.style, { margin: '0 0 20px', fontSize: '14px', lineHeight: '1.5', whiteSpace: 'pre-line', color: '#c5c9d2' });
      const okBtn = modalButton('Got it', 'primary');
      okBtn.addEventListener('click', () => { overlay.remove(); resolve(); });
      Object.assign(okBtn.style, { flex: '0 1 auto', minWidth: '120px' });
      const btnRow = document.createElement('div');
      Object.assign(btnRow.style, { display: 'flex', justifyContent: 'center' });
      btnRow.appendChild(okBtn);
      box.append(h, p, btnRow);
    });
  }

  // Substitui window.confirm por um modal centralizado com preview dos dados.
  function showConfirm(title, lines, warningLine) {
    return new Promise(resolve => {
      const { overlay, box } = createModalShell();
      const h = document.createElement('h3');
      h.textContent = title;
      Object.assign(h.style, { margin: '0 0 16px', fontSize: '16px' });

      const table = document.createElement('div');
      Object.assign(table.style, { marginBottom: '16px', fontSize: '14px' });
      lines.forEach(([label, value]) => {
        const row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #232734' });
        const l = document.createElement('span');
        l.textContent = label;
        l.style.color = '#9aa0ac';
        const v = document.createElement('span');
        v.textContent = value;
        v.style.fontWeight = '600';
        row.append(l, v);
        table.appendChild(row);
      });
      box.append(h, table);

      if (warningLine) {
        const warn = document.createElement('div');
        warn.textContent = warningLine;
        Object.assign(warn.style, {
          background: '#3f2d0f', color: '#fbbf24', borderRadius: '8px',
          padding: '10px', fontSize: '12px', marginBottom: '16px', lineHeight: '1.5',
        });
        box.appendChild(warn);
      }

      const btnRow = document.createElement('div');
      Object.assign(btnRow.style, { display: 'flex', gap: '10px' });
      const cancelBtn = modalButton('Cancel', 'neutral');
      const confirmBtn = modalButton('Confirm', 'primary');
      cancelBtn.addEventListener('click', () => { overlay.remove(); resolve(false); });
      confirmBtn.addEventListener('click', () => { overlay.remove(); resolve(true); });
      btnRow.append(cancelBtn, confirmBtn);
      box.appendChild(btnRow);
    });
  }

  // Substitui os 3 prompt() sequenciais por um único formulário.
  function showListingForm() {
    return new Promise(resolve => {
      const { overlay, box } = createModalShell();
      const h = document.createElement('h3');
      h.textContent = 'Bulk List';
      Object.assign(h.style, { margin: '0 0 16px', fontSize: '16px' });

      const nameField = modalField('Exact item name', 'e.g. BLUE TARGET MARKER');
      const priceField = modalField('Price per unit (UPX)', 'e.g. 200', 'numeric');
      const quantityField = modalField('Quantity to list', 'e.g. 10', 'numeric');
      const errorMsg = document.createElement('div');
      Object.assign(errorMsg.style, { color: '#f87171', fontSize: '12px', marginBottom: '12px', display: 'none' });

      const btnRow = document.createElement('div');
      Object.assign(btnRow.style, { display: 'flex', gap: '10px', marginTop: '4px' });
      const cancelBtn = modalButton('Cancel', 'neutral');
      const nextBtn = modalButton('Continue', 'primary');
      cancelBtn.addEventListener('click', () => { overlay.remove(); resolve(null); });
      nextBtn.addEventListener('click', () => {
        const itemName = nameField.input.value.trim();
        const price = Number(priceField.input.value);
        const quantity = Number(quantityField.input.value);
        if (!itemName || !priceField.input.value || isNaN(price) || price <= 0 || !quantityField.input.value || isNaN(quantity) || quantity <= 0) {
          errorMsg.textContent = 'Please fill in the item name and valid numbers greater than zero.';
          errorMsg.style.display = 'block';
          return;
        }
        overlay.remove();
        resolve({ itemName, price, quantity });
      });
      btnRow.append(cancelBtn, nextBtn);

      box.append(h, nameField.wrap, priceField.wrap, quantityField.wrap, errorMsg, btnRow);
      nameField.input.focus();
    });
  }

  // Sends an error report to the backend, which quietly notifies the
  // maintainer via WhatsApp. The user only sees a "thanks" confirmation —
  // no account, email client, or GitHub login required on their end.
  async function sendReport(userMessage) {
    const payload = {
      tool: TOOL_NAME,
      message: userMessage || '(no description provided)',
      log: recentLogLines.join('\n'),
      userAgent: navigator.userAgent,
    };
    const res = await fetch(REPORT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Report endpoint returned HTTP ${res.status}`);
  }

  // Small form asking what went wrong before sending the report — the
  // recent log lines are attached automatically, so the user only needs
  // to describe the issue in their own words.
  function showReportForm() {
    return new Promise(resolve => {
      const { overlay, box } = createModalShell();
      const h = document.createElement('h3');
      h.textContent = 'Report an Issue';
      Object.assign(h.style, { margin: '0 0 10px', fontSize: '16px' });

      const hint = document.createElement('p');
      hint.textContent = 'Briefly describe what happened. The recent activity log is attached automatically — no account or email needed.';
      Object.assign(hint.style, { margin: '0 0 14px', fontSize: '12px', lineHeight: '1.5', color: '#9aa0ac' });

      const field = modalTextarea('What went wrong?', 'e.g. it got stuck after listing 3 items...', 4);

      const errorMsg = document.createElement('div');
      Object.assign(errorMsg.style, { color: '#f87171', fontSize: '12px', marginBottom: '12px', display: 'none' });

      const btnRow = document.createElement('div');
      Object.assign(btnRow.style, { display: 'flex', gap: '10px', marginTop: '4px' });
      const cancelBtn = modalButton('Cancel', 'neutral');
      const sendBtn = modalButton('Send Report', 'primary');
      cancelBtn.addEventListener('click', () => { overlay.remove(); resolve(null); });
      sendBtn.addEventListener('click', () => {
        const message = field.input.value.trim();
        if (!message) {
          errorMsg.textContent = 'Please describe what happened before sending.';
          errorMsg.style.display = 'block';
          return;
        }
        overlay.remove();
        resolve(message);
      });
      btnRow.append(cancelBtn, sendBtn);

      box.append(h, hint, field.wrap, errorMsg, btnRow);
      field.input.focus();
    });
  }

  // ---------------------------------------------------------
  // UI: floating menu ("Upland Tools" -> Bulk List / Report Issue)
  // ---------------------------------------------------------
  function createFloatingMenu() {
    const menuBtn = document.createElement('button');
    menuBtn.textContent = 'Upland Tools';
    Object.assign(menuBtn.style, {
      position: 'fixed',
      bottom: '20px',
      right: '90px',
      zIndex: 999999,
      padding: '10px 16px',
      background: '#3b82f6',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      fontSize: '14px',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    });

    const menu = document.createElement('div');
    Object.assign(menu.style, {
      position: 'fixed',
      bottom: '64px',
      right: '90px',
      zIndex: 999999,
      background: '#171a21',
      border: '1px solid #2a2e37',
      borderRadius: '8px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      display: 'none',
      overflow: 'hidden',
      minWidth: '180px',
    });

    function menuItem(text) {
      const item = document.createElement('button');
      item.textContent = text;
      Object.assign(item.style, {
        display: 'block', width: '100%', textAlign: 'left',
        background: 'transparent', color: '#e4e6eb', border: 'none',
        padding: '12px 16px', fontSize: '14px', cursor: 'pointer',
      });
      item.addEventListener('mouseenter', () => { item.style.background = '#232734'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
      return item;
    }

    const bulkListItem = menuItem('Bulk List');
    const reportItem = menuItem('Report Issue');
    menu.append(bulkListItem, reportItem);

    menuBtn.addEventListener('click', () => {
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', e => {
      if (!menu.contains(e.target) && e.target !== menuBtn) menu.style.display = 'none';
    });

    const status = document.createElement('div');
    Object.assign(status.style, {
      position: 'fixed',
      bottom: '64px',
      right: '90px',
      zIndex: 999999,
      maxWidth: '320px',
      maxHeight: '200px',
      overflowY: 'auto',
      background: '#171a21',
      color: '#e4e6eb',
      border: '1px solid #2a2e37',
      borderRadius: '8px',
      padding: '10px 26px 10px 10px',
      fontSize: '12px',
      fontFamily: 'monospace',
      display: 'none',
    });

    const statusCloseBtn = document.createElement('button');
    statusCloseBtn.textContent = '×';
    statusCloseBtn.title = 'Close';
    Object.assign(statusCloseBtn.style, {
      position: 'absolute', top: '4px', right: '6px',
      background: 'transparent', border: 'none', color: '#9aa0ac',
      fontSize: '16px', lineHeight: '1', cursor: 'pointer', padding: '4px',
    });
    statusCloseBtn.addEventListener('mouseenter', () => { statusCloseBtn.style.color = '#e4e6eb'; });
    statusCloseBtn.addEventListener('mouseleave', () => { statusCloseBtn.style.color = '#9aa0ac'; });
    statusCloseBtn.addEventListener('click', () => { status.style.display = 'none'; });
    status.style.position = 'fixed';
    status.appendChild(statusCloseBtn);

    function clearStatusLines() {
      Array.from(status.children).forEach(child => {
        if (child !== statusCloseBtn) child.remove();
      });
    }

    function log(msg) {
      recordLogLine(msg);
      status.style.display = 'block';
      const line = document.createElement('div');
      line.textContent = msg;
      status.appendChild(line);
      status.scrollTop = status.scrollHeight;
      console.log('[UplandTools]', msg);
    }

    bulkListItem.addEventListener('click', async () => {
      menu.style.display = 'none';
      const form = await showListingForm();
      if (!form) return;
      const { itemName, price, quantity } = form;
      const total = price * quantity;

      menuBtn.disabled = true;
      menuBtn.textContent = 'Checking...';
      clearStatusLines();
      status.style.display = 'block';
      status.appendChild(Object.assign(document.createElement('div'), { textContent: `Looking for "${itemName}" in the Showroom...` }));

      const availability = await checkItemAvailability(itemName);

      if (!availability.found) {
        menuBtn.disabled = false;
        menuBtn.textContent = 'Upland Tools';
        status.style.display = 'none';
        await showMessage(
          'Item not found',
          `Couldn't find any item named "${itemName}" in your Showroom. Double-check the name matches exactly what's shown in the list (case doesn't matter, but the text must match).`
        );
        return;
      }

      const warningLine = availability.count < quantity
        ? `Found at least ${availability.count} visible unit(s) right now, fewer than the ${quantity} requested. There may be more units outside the loaded part of the list, but confirm before proceeding.`
        : null;

      const confirmed = await showConfirm('Confirm before starting', [
        ['Item', itemName],
        ['Unit price', `${price} UPX`],
        ['Quantity', String(quantity)],
        ['Expected total', `${total.toLocaleString('en-US')} UPX`],
      ], warningLine);

      if (!confirmed) {
        menuBtn.disabled = false;
        menuBtn.textContent = 'Upland Tools';
        status.style.display = 'none';
        return;
      }

      clearStatusLines();
      menuBtn.textContent = 'Listing...';
      try {
        const { done, skipped } = await runBulkListing(itemName, price, quantity, log);
        await showMessage(
          'Round complete',
          `${done} of ${quantity} units listed successfully.` + (skipped ? `\n${skipped} skipped due to persistent server failure.` : '')
        );
      } catch (e) {
        log(`Error: ${e.message}`);
        await showMessage('Unexpected error', e.message);
      } finally {
        menuBtn.disabled = false;
        menuBtn.textContent = 'Upland Tools';
      }
    });

    reportItem.addEventListener('click', async () => {
      menu.style.display = 'none';
      const message = await showReportForm();
      if (!message) return;

      try {
        await sendReport(message);
        await showMessage('Thank you!', 'Your report was sent. We appreciate you helping improve the tool.');
      } catch (e) {
        await showMessage(
          'Could not send report',
          `Something went wrong sending the report (${e.message}). Please try again later, or reach out on GitHub: https://github.com/WallCod/upland-bulk-list/issues`
        );
      }
    });

    document.body.appendChild(menuBtn);
    document.body.appendChild(menu);
    document.body.appendChild(status);
  }

  setTimeout(() => {
    createFloatingMenu();
    console.log('[UplandTools] ready — "Upland Tools" button in the bottom-right corner.');
  }, 2000);
})();
