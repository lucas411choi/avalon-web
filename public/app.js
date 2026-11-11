/* 아발론 온라인 — 클라이언트 */
(() => {
  'use strict';

  const ART = window.ART || { icon: () => '' };
  const icon = (name, cls) => ART.icon(name, cls);

  // ── 역할 정보 ──────────────────────────────────────────
  const ROLE_INFO = {
    merlin:        { name: '멀린', team: 'good', desc: '모드레드를 뺀 악 플레이어(랜슬롯 포함)를 알고 있습니다. 암살자에게 정체를 들키지 마세요!' },
    percival:      { name: '퍼시벌', team: 'good', desc: '멀린과 모르가나가 누구인지 알지만, 둘 중 누가 진짜 멀린인지는 모릅니다.' },
    servant:       { name: '아서 왕의 충성스러운 신하', team: 'good', desc: '특별한 능력은 없습니다. 추리로 악을 찾아내 원정을 성공시키세요.' },
    lancelot_good: { name: '선 랜슬롯', team: 'good', desc: '다른 랜슬롯만 알고 있습니다. 원정 전마다 2/7 확률로 두 랜슬롯의 선/악이 뒤바뀝니다.' },
    assassin:      { name: '암살자', team: 'evil', desc: '선이 원정 3번 성공하면, 악 동료들과 상의해 멀린을 지목해 암살합니다.' },
    morgana:       { name: '모르가나', team: 'evil', desc: '퍼시벌에게 멀린처럼 보입니다. 퍼시벌을 속이세요.' },
    mordred:       { name: '모드레드', team: 'evil', desc: '멀린에게 정체가 보이지 않습니다.' },
    oberon:        { name: '오베론', team: 'evil', desc: '악이지만 다른 악을 모르고, 다른 악들도 당신의 존재를 모릅니다.' },
    minion:        { name: '모드레드의 수하', team: 'evil', desc: '특별한 능력은 없습니다. 정체를 숨기고 원정을 실패시키세요.' },
    lancelot_evil: { name: '악 랜슬롯', team: 'evil', desc: '다른 랜슬롯만 알고, 다른 악과는 서로 모릅니다. 원정 전마다 2/7 확률로 선/악이 뒤바뀝니다.' },
  };
  const TEAM_SIZES = { 5: [3, 2], 6: [4, 2], 7: [4, 3], 8: [5, 3], 9: [6, 3], 10: [6, 4] };
  const OPTION_INFO = {
    percival: { label: '퍼시벌', team: 'good', icon: 'percival', desc: '멀린과 모르가나를 앎' },
    lancelot: { label: '랜슬롯 (선·악 한 쌍)', team: 'good', icon: 'lancelot', desc: '둘이 서로만 앎, 원정 전 2/7 확률로 선/악 전환' },
    morgana: { label: '모르가나', team: 'evil', icon: 'morgana', desc: '퍼시벌에게 멀린처럼 보임' },
    mordred: { label: '모드레드', team: 'evil', icon: 'mordred', desc: '멀린에게 안 보임' },
    oberon: { label: '오베론', team: 'evil', icon: 'oberon', desc: '악끼리 서로 모름' },
  };

  // ── 상태 ──────────────────────────────────────────────
  const $ = (s, root = document) => root.querySelector(s);
  const socket = io();
  let state = null;
  let session = loadSession();
  const chatSeen = new Set();
  let dms = {};
  const dmUnread = {};
  let evilMsgs = [];
  let evilUnread = 0;
  let activeTab = 'all';
  let dmWith = null;
  let selected = new Set();
  let selectKey = '';
  let target = null;
  let concealed = false;
  let dealNext = false;
  let lastOverlay = null;
  let tableKey = '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── 세션 저장 (새로고침/재접속) ───────────────────────
  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem('avalon.session')) || null; } catch { return null; }
  }
  function saveSession(s) {
    session = s;
    try {
      sessionStorage.setItem('avalon.session', JSON.stringify(s));
      localStorage.setItem('avalon.last', JSON.stringify(s));
    } catch { /* 저장 불가 환경 */ }
  }
  function clearSession() {
    session = null;
    try {
      sessionStorage.removeItem('avalon.session');
      localStorage.removeItem('avalon.last');
    } catch { /* noop */ }
  }
  function lastSession() {
    try { return JSON.parse(localStorage.getItem('avalon.last')) || null; } catch { return null; }
  }

  // ── 알림 ──────────────────────────────────────────────
  let toastTimer = null;
  function toast(text, isError = false) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.toggle('error', isError);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  function call(event, payload = {}, { quiet = false } = {}) {
    return new Promise((resolve) => {
      socket.timeout(10000).emit(event, payload, (err, res) => {
        if (err) {
          if (!quiet) toast('서버 응답이 없습니다. 잠시 후 다시 시도해 주세요.', true);
          resolve({ ok: false, error: 'timeout' });
          return;
        }
        if (!res.ok && !quiet) toast(res.error, true);
        resolve(res);
      });
    });
  }

  // ── 소켓 이벤트 ───────────────────────────────────────
  socket.on('connect', async () => {
    $('#conn').classList.add('hidden');
    if (session) {
      const r = await call('rejoin', session, { quiet: true });
      if (!r.ok) {
        clearSession();
        state = null;
        render();
        if (r.error !== 'timeout') toast(r.error || '이전 게임에 다시 들어갈 수 없습니다.', true);
      }
    }
  });
  socket.on('disconnect', () => {
    if (session) $('#conn').classList.remove('hidden');
  });
  socket.on('session', (s) => saveSession(s));
  socket.on('kicked', ({ reason }) => {
    clearSession();
    state = null;
    resetChat();
    render();
    toast(reason || '방에서 나왔습니다.', true);
  });

  socket.on('chatInit', ({ chat, dms: d, evilChat }) => {
    resetChat();
    for (const m of chat) addChat(m);
    dms = d || {};
    evilMsgs = evilChat || [];
    renderEvilLog();
    if (dmWith) renderDm();
  });
  socket.on('chat', (m) => addChat(m));
  socket.on('dm', ({ with: other, msg }) => {
    const list = dms[other] || (dms[other] = []);
    if (list.some((x) => x.id === msg.id)) return;
    list.push(msg);
    if (dmWith === other) {
      appendMsg($('#dm-log'), msg);
    } else if (state && msg.from !== state.me.id) {
      dmUnread[other] = (dmUnread[other] || 0) + 1;
      toast(`💬 ${msg.name}님의 1:1 메시지`);
      if (state.room.phase === 'game') renderPlayers();
    }
  });
  socket.on('evilChat', (m) => {
    if (evilMsgs.some((x) => x.id === m.id)) return;
    evilMsgs.push(m);
    if (activeTab === 'evil') appendMsg($('#evil-log'), m);
    else { evilUnread++; renderTabs(); }
  });
  socket.on('evilChatInit', (list) => {
    evilMsgs = list || [];
    renderEvilLog();
  });

  socket.on('state', (s) => {
    const prev = state;
    state = s;
    onStateChange(prev, s);
    render();
  });

  function onStateChange(prev, s) {
    // 새 게임이 시작되면 개인 채팅/선택 초기화 + 역할 카드 나눠주기 연출
    if (prev && prev.room.phase !== 'game' && s.room.phase === 'game') {
      dms = {};
      for (const k of Object.keys(dmUnread)) delete dmUnread[k];
      evilMsgs = [];
      evilUnread = 0;
      renderEvilLog();
      closeDm();
      concealed = false;
      dealNext = true;
      lastOverlay = null;
    }
    if (!prev && s.room.phase === 'game') dealNext = true;
    if (s.room.phase !== 'game') hideOverlay();
    const g = s.game;
    if (g) {
      const key = `${g.round}-${g.attempt}-${g.phase}`;
      if (key !== selectKey) { selectKey = key; selected = new Set(); target = null; }
    }
    // 원정 결과 / 게임 종료 연출 (처음 접속했을 때는 표시하지 않음)
    const pg = prev && prev.game;
    if (pg && g) {
      if (g.results.length > pg.results.length) showQuestResult(g, g.results[g.results.length - 1]);
      else if (g.phase === 'over' && pg.phase !== 'over') showFinal(g);
      else if (g.phase === 'assassination' && pg.phase !== 'assassination') toast('⚔ 원정 3번 성공! 암살 단계가 시작됩니다.');
    }
  }

  // ── 채팅 ──────────────────────────────────────────────
  function resetChat() {
    chatSeen.clear();
    $('#chat-log').innerHTML = '';
  }
  function addChat(m) {
    if (chatSeen.has(m.id)) return;
    chatSeen.add(m.id);
    appendMsg($('#chat-log'), m);
  }
  function isAI(id) {
    return !!(state && state.room.players.some((p) => p.id === id && p.ai));
  }
  function msgNode(m) {
    const div = document.createElement('div');
    if (m.system) {
      div.className = 'msg sys';
      div.textContent = m.text;
    } else {
      const mine = state && state.me && m.from === state.me.id;
      div.className = 'msg' + (mine ? ' mine' : '') + (isAI(m.from) ? ' ai' : '');
      div.innerHTML = `<span class="who">${esc(m.name)}</span>${esc(m.text)}`;
    }
    return div;
  }
  function appendMsg(log, m) {
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.appendChild(msgNode(m));
    if (nearBottom || (state && m.from === state.me.id)) log.scrollTop = log.scrollHeight;
  }
  function renderLog(log, list) {
    log.innerHTML = '';
    for (const m of list) log.appendChild(msgNode(m));
    log.scrollTop = log.scrollHeight;
  }
  function renderEvilLog() { renderLog($('#evil-log'), evilMsgs); renderTabs(); }

  function renderTabs() {
    const canEvil = !!(state && state.game && state.game.me && state.game.me.evilReveal);
    $('#tab-evil').classList.toggle('hidden', !canEvil);
    if (!canEvil && activeTab === 'evil') setTab('all');
    const b = $('#evil-badge');
    b.textContent = evilUnread;
    b.classList.toggle('hidden', evilUnread === 0 || activeTab === 'evil');
  }
  function setTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.chat-tab').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
    $('#chat-log').classList.toggle('hidden', tab !== 'all');
    $('#evil-log').classList.toggle('hidden', tab !== 'evil');
    $('#chat-input').placeholder = tab === 'evil' ? '악 팀에게만 보이는 메시지… (멀린 후보 이름을 적어 보세요)' : '메시지 입력…';
    if (tab === 'evil') { evilUnread = 0; renderEvilLog(); }
    renderTabs();
  }
  document.querySelectorAll('.chat-tab').forEach((el) => el.addEventListener('click', () => setTab(el.dataset.tab)));

  $('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    const r = await call(activeTab === 'evil' ? 'evilChat' : 'chat', { text });
    if (r.ok) input.value = '';
  });

  // ── 1:1 채팅 ──────────────────────────────────────────
  function openDm(id) {
    dmWith = id;
    dmUnread[id] = 0;
    $('#dm').classList.remove('hidden');
    renderDm();
    renderPlayers();
    $('#dm-input').focus();
  }
  function closeDm() {
    dmWith = null;
    $('#dm').classList.add('hidden');
  }
  function renderDm() {
    if (!dmWith || !state) return;
    const p = state.room.players.find((x) => x.id === dmWith);
    $('#dm-title').textContent = `💬 ${p ? p.name : '?'}님과 1:1 채팅`;
    renderLog($('#dm-log'), dms[dmWith] || []);
  }
  $('#dm-close').addEventListener('click', closeDm);
  $('#dm-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#dm-input');
    const text = input.value.trim();
    if (!text || !dmWith) return;
    const r = await call('dm', { to: dmWith, text });
    if (r.ok) input.value = '';
  });

  // ── 첫 화면 ───────────────────────────────────────────
  const nameInput = $('#home-name');
  const codeInput = $('#home-code');
  try { nameInput.value = localStorage.getItem('avalon.name') || ''; } catch { /* noop */ }
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom) codeInput.value = urlRoom.toUpperCase().slice(0, 4);
  codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, ''); });

  function rememberName() {
    try { localStorage.setItem('avalon.name', nameInput.value.trim()); } catch { /* noop */ }
  }
  $('#btn-create').addEventListener('click', async () => {
    rememberName();
    await call('create', { name: nameInput.value });
  });
  async function joinRoom() {
    rememberName();
    if (codeInput.value.length !== 4) { toast('방 코드 4자리를 입력해 주세요.', true); return; }
    const r = await call('join', { code: codeInput.value, name: nameInput.value });
    if (r.ok && urlRoom) history.replaceState(null, '', location.pathname);
  }
  $('#btn-join').addEventListener('click', joinRoom);
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') (codeInput.value.length === 4 ? joinRoom() : $('#btn-create').click()); });
  $('#btn-resume').addEventListener('click', async () => {
    const last = lastSession();
    if (!last) return;
    const r = await call('rejoin', last);
    if (!r.ok) { try { localStorage.removeItem('avalon.last'); } catch { /* noop */ } render(); }
  });

  // ── 렌더링 ────────────────────────────────────────────
  function setBgMode(mode) {
    document.body.classList.toggle('in-game', mode === 'game');
    if (window.AvalonBG) window.AvalonBG.setMode(mode);
  }
  document.addEventListener('avalon-bg-ready', () => {
    setBgMode(!state ? 'home' : state.room.phase === 'game' ? 'game' : 'lobby');
  });

  function showScreen(id) {
    for (const s of ['home', 'lobby', 'game']) $(`#screen-${s}`).classList.toggle('hidden', s !== id);
    setBgMode(id);
  }
  function placeChat(slotSel) {
    const chat = $('#chat');
    if (!slotSel) { chat.classList.add('hidden'); return; }
    chat.classList.remove('hidden');
    const slot = $(slotSel);
    if (chat.parentElement !== slot) {
      slot.appendChild(chat);
      for (const log of [$('#chat-log'), $('#evil-log')]) log.scrollTop = log.scrollHeight;
    }
  }

  function render() {
    if (!state) {
      showScreen('home');
      placeChat(null);
      closeDm();
      const last = lastSession();
      const resume = $('#btn-resume');
      resume.classList.toggle('hidden', !last);
      if (last) resume.textContent = `↩ 이전 게임으로 돌아가기 (방 ${last.code})`;
      return;
    }
    if (state.room.phase === 'game' && state.game) {
      showScreen('game');
      placeChat('#game-chat-slot');
      renderGame();
    } else {
      showScreen('lobby');
      placeChat('#lobby-chat-slot');
      closeDm();
      renderLobby();
    }
    renderTabs();
  }

  const player = (id) => state.room.players.find((p) => p.id === id);
  const pname = (id) => (player(id) ? player(id).name : '???');
  const isHost = () => state.room.hostId === state.me.id;

  // ── 대기실 ────────────────────────────────────────────
  function optionError(n, o) {
    const t = TEAM_SIZES[n];
    if (!t) return '5~10명만 가능';
    const goodSp = 1 + (o.percival ? 1 : 0) + (o.lancelot ? 1 : 0);
    const evilSp = 1 + (o.morgana ? 1 : 0) + (o.mordred ? 1 : 0) + (o.oberon ? 1 : 0) + (o.lancelot ? 1 : 0);
    if (goodSp > t[0]) return '선 자리가 부족합니다';
    if (evilSp > t[1]) return '악 자리가 부족합니다';
    return null;
  }

  function renderRoundTable() {
    const r = state.room;
    const n = r.players.length;
    const host = isHost();
    const small = window.innerWidth <= 860;
    const stageW = $('#table-stage').clientWidth || 600;
    // 바뀐 게 없으면 다시 그리지 않음 (등장 애니메이션이 매번 재생되지 않도록)
    const key = JSON.stringify([r.players, r.hostId, r.phase, small, stageW, state.me.id, isHost()]);
    if (key === tableKey && $('#table-stage').firstChild) return;
    tableKey = key;
    const radius = Math.max(90, Math.min(225, stageW / 2 - (small ? 40 : 60)));
    const tilt = 62;
    const seats = r.players.map((p, i) => {
      // 1번 좌석이 정면(아래)에서 시작해 시계 방향
      const a = Math.PI / 2 + (i / Math.max(n, 1)) * Math.PI * 2;
      const x = Math.cos(a) * radius;
      const y = Math.sin(a) * radius;
      const shieldCls = p.ai ? 'ai' : p.id === state.me.id ? 'me' : '';
      const inner = p.ai ? icon('robot') : esc([...p.name][0] || '?');
      const kick = host && p.id !== state.me.id && r.phase === 'lobby'
        ? `<button class="seat-kick" data-kick="${p.id}" title="내보내기">✕</button>` : '';
      return `<div class="seat ${p.connected ? '' : 'off'}" style="transform: translate(${x.toFixed(1)}px, ${(y - 60).toFixed(1)}px) translateZ(2px) rotateX(-${tilt}deg); animation-delay:${i * 0.05}s">
        ${p.id === r.hostId ? `<div class="seat-crown">${icon('crown')}</div>` : ''}
        <div class="seat-shield ${shieldCls}">${inner}</div>
        <div class="seat-name">${i + 1}. ${esc(p.name)}${p.id === state.me.id ? ' (나)' : ''}</div>
        ${kick}
      </div>`;
    }).join('');
    $('#table-stage').innerHTML = `<div class="round-table" style="--size:${Math.round(radius * 1.7)}px"><div class="table-emblem">${icon('emblem')}</div>${seats}</div>`;
  }

  function renderLobby() {
    const r = state.room;
    const n = r.players.length;
    const host = isHost();
    const humans = r.players.filter((p) => !p.ai).length;
    const ais = n - humans;
    $('#lobby-code').textContent = r.code;
    $('#lobby-count').textContent = r.phase === 'setup'
      ? `${n}명으로 확정 · 캐릭터를 고르는 중`
      : `${n} / ${r.maxPlayers}명 (사람 ${humans} · AI ${ais}) · ${n < r.minPlayers ? `${r.minPlayers - n}명 더 모이면 시작할 수 있어요` : '원탁이 준비되었습니다!'}`;
    renderRoundTable();

    // AI 인원
    const aiBox = $('#lobby-ai');
    if (r.phase === 'lobby') {
      const maxAI = r.maxPlayers - humans;
      aiBox.innerHTML = host
        ? `<div class="ai-box">
            <div class="ai-icon">${icon('robot')}</div>
            <div class="ai-text"><b>AI 기사</b><div class="hint">혼자서도 플레이할 수 있어요. 원하는 만큼 AI를 앉히세요.</div></div>
            <div class="stepper">
              <button class="btn iron" data-ai="${ais - 1}" ${ais <= 0 ? 'disabled' : ''} aria-label="AI 한 명 빼기">−</button>
              <span class="num">${ais}</span>
              <button class="btn iron" data-ai="${ais + 1}" ${ais >= maxAI ? 'disabled' : ''} aria-label="AI 한 명 추가">+</button>
            </div>
            ${n < r.minPlayers ? `<button class="btn gold small" data-ai="${ais + (r.minPlayers - n)}"><span>5명 채우기</span></button>` : ''}
          </div>`
        : (ais ? `<div class="ai-box"><div class="ai-icon">${icon('robot')}</div><div class="ai-text"><b>AI 기사 ${ais}명</b><div class="hint">방장이 AI 인원을 정합니다.</div></div></div>` : '');
    } else {
      aiBox.innerHTML = '';
    }

    // 캐릭터 선정
    const setup = $('#lobby-setup');
    if (r.phase === 'setup') {
      const t = TEAM_SIZES[n] || [0, 0];
      const o = r.options;
      const opt = (key) => {
        const info = OPTION_INFO[key];
        const on = !!o[key];
        const blocked = !on && !!optionError(n, { ...o, [key]: true });
        return `<label class="role-opt ${info.team} ${on ? 'on' : ''}" title="${blocked ? '인원이 부족해 추가할 수 없습니다' : ''}">
          <input type="checkbox" data-opt="${key}" ${on ? 'checked' : ''} ${!host || blocked ? 'disabled' : ''}>
          <span class="ro-ic">${icon(info.icon)}</span>
          <span><span class="rname">${info.label}</span><br><span class="rdesc">${info.desc}${blocked ? ' · 자리 부족' : ''}</span></span>
        </label>`;
      };
      const locked = (name, team, ic, desc) => `<label class="role-opt ${team} on locked">
          <input type="checkbox" checked disabled><span class="ro-ic">${icon(ic)}</span><span><span class="rname">${name}</span> <small>(고정)</small><br><span class="rdesc">${desc}</span></span></label>`;
      setup.innerHTML = `
        <div class="setup parchment">
          <h3>⚜ 캐릭터 선정 ${host ? '' : '<small class="hint">(방장이 고르는 중)</small>'}</h3>
          <div class="teams"><span class="good-text">선 ${t[0]}명</span><span class="evil-text">악 ${t[1]}명</span></div>
          <div class="role-grid">
            <div class="role-col"><h4 class="good-text">선의 기사단</h4>
              ${locked('멀린', 'good', 'merlin', '모드레드를 뺀 악을 앎')}
              ${opt('percival')}
              ${opt('lancelot')}
            </div>
            <div class="role-col"><h4 class="evil-text">모드레드의 세력</h4>
              ${locked('암살자', 'evil', 'assassin', '마지막에 멀린을 암살')}
              ${opt('morgana')}
              ${opt('mordred')}
              ${opt('oberon')}
            </div>
          </div>
          <p class="hint" style="color:#6b5636">남는 자리는 <b style="color:#1f4fa8">아서 왕의 충성스러운 신하</b> / <b style="color:#9c1422">모드레드의 수하</b>로 채워집니다.</p>
          ${r.optionsError ? `<div class="setup-error">⚠ ${esc(r.optionsError)}</div>` : ''}
          ${r.composition ? `<div class="comp-inline">${r.composition.map((c) => `<span class="chip ${c.team}">${esc(c.name)} ×${c.count}</span>`).join('')}</div>` : ''}
        </div>`;
    } else {
      setup.innerHTML = '';
    }

    const actions = $('#lobby-actions');
    if (r.phase === 'lobby') {
      actions.innerHTML = host
        ? `<button class="btn gold big" data-act="setupBegin" ${n < r.minPlayers ? 'disabled' : ''}><span>⚔ 게임 시작 (${n}명)</span></button>`
        : '<p class="hint">방장이 게임을 시작하기를 기다리는 중…</p>';
    } else {
      actions.innerHTML = host
        ? `<button class="btn ghost big" data-act="setupCancel">뒤로</button>
           <button class="btn gold big" data-act="start" ${r.optionsError ? 'disabled' : ''}><span>⚔ 이 구성으로 시작!</span></button>`
        : '<p class="hint">방장이 캐릭터를 고르고 있습니다. 잠시만 기다려 주세요…</p>';
    }
  }

  $('#table-stage').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-kick]');
    if (!b) return;
    const id = b.dataset.kick;
    if (confirm(`${pname(id)}님을 내보낼까요?`)) await call('kick', { targetId: id });
  });
  $('#lobby-ai').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ai]');
    if (!b || b.disabled) return;
    b.disabled = true;
    await call('setAI', { count: Number(b.dataset.ai) });
  });
  $('#lobby-setup').addEventListener('change', async (e) => {
    const cb = e.target.closest('[data-opt]');
    if (!cb) return;
    await call('setOptions', { options: { [cb.dataset.opt]: cb.checked } });
  });
  $('#lobby-actions').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    b.disabled = true;
    await call(b.dataset.act);
    if (state) render();
  });
  $('#btn-leave-lobby').addEventListener('click', async () => {
    if (!confirm('방에서 나갈까요?')) return;
    await call('leave');
    clearSession();
    state = null;
    resetChat();
    render();
  });
  $('#btn-copy-link').addEventListener('click', async () => {
    const link = `${location.origin}/?room=${state.room.code}`;
    try {
      await navigator.clipboard.writeText(link);
      toast('초대 링크를 복사했습니다!');
    } catch {
      prompt('아래 링크를 복사하세요', link);
    }
  });
  let lastWide = window.innerWidth > 860;
  window.addEventListener('resize', () => {
    const wide = window.innerWidth > 860;
    if (state && state.room.phase !== 'game') renderRoundTable();
    lastWide = wide;
  });

  // ── 게임 화면 ─────────────────────────────────────────
  function renderGame() {
    renderPlayers();
    renderBoard();
    renderRole();
    renderComp();
    if (dmWith) renderDm();
  }

  function tagFor(id) {
    const g = state.game;
    const me = g.me;
    if (id === state.me.id) return { text: '나', cls: 'me' };
    if (g.phase === 'over' && g.finalTeams) {
      const t = g.finalTeams[id];
      return { text: t === 'good' ? '선' : '악', cls: t };
    }
    if (me.evilReveal && me.evilReveal[id]) return { text: '악', cls: 'evil' };
    const k = me.knowledge[id];
    if (k === 'evil') return { text: '악', cls: 'evil' };
    if (k === 'merlin?') return { text: '멀린?', cls: 'merlin' };
    if (k === 'lancelot') return { text: '랜슬롯', cls: 'lancelot' };
    return { text: '?', cls: '' };
  }

  function guessName(v) {
    if (v === 'good') return '선';
    if (v === 'evil') return '악';
    return ROLE_INFO[v] ? ROLE_INFO[v].name : v;
  }
  function guessTeam(v) {
    if (v === 'good' || v === 'evil') return v;
    return ROLE_INFO[v] ? ROLE_INFO[v].team : '';
  }

  function isSelectable(id) {
    const g = state.game;
    const meId = state.me.id;
    if (g.phase === 'team' && g.leaderId === meId) return true;
    if (g.phase === 'assassination' && g.me.role === 'assassin') {
      return id !== meId && !(g.me.evilReveal && g.me.evilReveal[id]);
    }
    return false;
  }

  function cardHTML(id, seat) {
    const g = state.game;
    const me = g.me;
    const p = player(id) || { name: '???', connected: false };
    const isMe = id === state.me.id;
    const tag = tagFor(id);
    const guess = state.predictions[id];

    let body;
    if (g.phase === 'over' && g.allRoles) {
      const role = g.allRoles[id];
      body = `<div class="pc-crest">${icon(role)}</div><div class="pc-role ${g.finalTeams[id]}-text">${esc(ROLE_INFO[role].name)}</div>`;
    } else if (isMe) {
      body = concealed
        ? `<div class="pc-emblem" style="opacity:.6">${icon('emblem')}</div>`
        : `<div class="pc-crest">${icon(me.role)}</div><div class="pc-role ${me.team}-text">${esc(me.roleName)}</div>`;
    } else if (me.evilReveal && me.evilReveal[id]) {
      body = `<div class="pc-crest">${icon(me.evilReveal[id])}</div><div class="pc-role evil-text">${esc(ROLE_INFO[me.evilReveal[id]].name)}</div>`;
    } else if (guess) {
      body = `<div class="pc-crest" style="opacity:.75">${icon(guess)}</div><div class="pc-guess ${guessTeam(guess)}-text"><small>예상</small>${esc(guessName(guess))}</div>`;
    } else {
      const k = me.knowledge[id];
      body = `<div class="pc-emblem">${icon(k === 'evil' ? 'evil' : k === 'merlin?' ? 'merlin' : k === 'lancelot' ? 'lancelot' : 'emblem')}</div><div class="pc-q">?</div>`;
    }

    const leader = g.leaderId === id && g.phase !== 'over' && g.phase !== 'assassination';
    const onTeam = (g.proposal && g.proposal.includes(id)) || selected.has(id);
    const teamIc = onTeam ? `<div class="pc-team-ic">${icon('sword')}</div>` : (g.assassinTarget === id ? `<div class="pc-team-ic">${icon('assassin')}</div>` : '');
    const off = p.connected ? '' : '<div class="pc-off" title="연결 끊김">📴</div>';

    let voteBadge = '';
    if (g.phase === 'vote') {
      if (g.votedIds.includes(id)) voteBadge = '<span class="pc-vote wait" title="투표 완료">✓</span>';
    } else if (g.phase === 'quest' && g.proposal && g.proposal.includes(id)) {
      if (g.questPlayedIds.includes(id)) voteBadge = '<span class="pc-vote wait" title="카드 제출">✓</span>';
      else if (g.lastVote) voteBadge = voteTag(g.lastVote.votes[id]);
    } else if (g.lastVote && g.lastVote.round === g.round && (g.phase === 'team' || g.phase === 'quest')) {
      voteBadge = voteTag(g.lastVote.votes[id]);
    }

    const unread = dmUnread[id] || 0;
    const cls = ['pcard'];
    if (isMe) cls.push('me');
    if (leader) cls.push('leader');
    if (onTeam) cls.push('on-team');
    if (!p.connected) cls.push('off');
    if (isSelectable(id)) cls.push('selectable');
    if (selected.has(id)) cls.push('selected');
    if (target === id) cls.push('target');

    return `<div class="${cls.join(' ')}" data-card="${id}">
      <div class="pc-face">
        <div class="pc-head"><div class="pc-name"><span class="seatno">${seat}</span>${esc(p.name)}${p.ai ? '<span class="ai-tag">AI</span>' : ''}</div><div class="pc-tag ${tag.cls}">${tag.text}</div></div>
        <div class="pc-body">${off}${teamIc}${body}${voteBadge}</div>
        <div class="pc-btns">
        ${isMe
          ? '<button class="pc-btn" disabled>나의 자리</button>'
          : `<button class="pc-btn" data-predict="${id}">${guess ? '예상 바꾸기' : '예상하기'}</button>
             <button class="pc-btn" data-dm="${id}">1:1 채팅${unread ? `<span class="badge">${unread}</span>` : ''}</button>`}
        </div>
      </div>
    </div>`;
  }
  function voteTag(v) {
    if (v === true) return '<span class="pc-vote yes">찬성</span>';
    if (v === false) return '<span class="pc-vote no">반대</span>';
    return '';
  }

  function renderPlayers() {
    if (!state || !state.game) return;
    const order = state.game.order;
    const topCount = Math.ceil(order.length / 2);
    const top = order.slice(0, topCount).map((id, i) => cardHTML(id, i + 1));
    // 아래 줄은 오른쪽 → 왼쪽 (시계 방향)
    const bottom = order.slice(topCount).map((id, i) => cardHTML(id, topCount + i + 1)).reverse();
    $('#row-top').innerHTML = top.join('');
    $('#row-bottom').innerHTML = bottom.join('');
  }

  // 카드 3D 기울기 (마우스 따라)
  function onTilt(e) {
    const card = e.target.closest('.pcard');
    if (!card || e.pointerType === 'touch') return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    card.style.setProperty('--ry', `${(x * 16).toFixed(1)}deg`);
    card.style.setProperty('--rx', `${(-y * 14).toFixed(1)}deg`);
  }
  function onTiltOut(e) {
    const card = e.target.closest('.pcard');
    if (card && !card.contains(e.relatedTarget)) { card.style.removeProperty('--rx'); card.style.removeProperty('--ry'); }
  }
  for (const row of [$('#row-top'), $('#row-bottom')]) {
    row.addEventListener('pointermove', onTilt);
    row.addEventListener('pointerout', onTiltOut);
  }

  function renderBoard() {
    const g = state.game;
    const n = g.order.length;
    const quests = g.questSizes.map((size, i) => {
      const r = g.results[i];
      const note = g.failsRequired[i] > 1 ? '실패 2장 필요' : '';
      if (r) {
        return `<div class="qwrap"><div class="qnote">${note}</div><div class="coin ${r.success ? 'success' : 'fail'}" title="${r.success ? '성공' : '실패'} · 실패 카드 ${r.fails}장"><span class="coin-ic">${icon(r.success ? 'good' : 'evil')}</span><small>${r.success ? '성공' : '실패'} ${r.fails ? `(${r.fails})` : ''}</small></div></div>`;
      }
      const cur = i === g.round && g.phase !== 'over' && g.phase !== 'assassination';
      return `<div class="qwrap"><div class="qnote">${note}</div><div class="coin ${cur ? 'cur' : ''}">${size}<small>명</small></div></div>`;
    }).join('');

    let lancelotRow = '';
    if (g.lancelotEnabled) {
      const toks = [0, 1, 2, 3, 4].map((i) => {
        const h = g.lancelotHistory[i];
        if (h === true) return '<div class="tok swap" title="충성 전환">⟳</div>';
        if (h === false) return '<div class="tok x" title="변화 없음">✕</div>';
        return `<div class="tok">${i + 1}</div>`;
      }).join('');
      lancelotRow = `<div class="track-row"><div class="track-label">랜슬롯</div><div class="track">${toks}</div></div>`;
    }

    const voteToks = [0, 1, 2, 3, 4].map((i) => {
      if (i < g.rejectCount) return `<div class="tok x ${i === 4 ? 'danger' : ''}">✕</div>`;
      const cur = i === g.rejectCount && (g.phase === 'team' || g.phase === 'vote');
      return `<div class="tok ${i === 4 ? 'danger' : ''} ${cur ? 'on' : ''}">${i + 1}</div>`;
    }).join('');

    const goodN = g.composition.filter((c) => c.team === 'good').reduce((a, c) => a + c.count, 0);
    const evilN = n - goodN;

    $('#board').innerHTML = `
      <div class="board-table">
        <div class="track-row"><div class="track-label">원정</div><div class="track quest-track">${quests}</div></div>
        ${lancelotRow}
        <div class="track-row"><div class="track-label">투표 상황</div><div class="track">${voteToks}</div></div>
      </div>
      <div class="info-line">
        <span class="info-pill"><span class="good-text">선 ${goodN}명</span> · <span class="evil-text">악 ${evilN}명</span></span>
        ${g.phase !== 'over' && g.phase !== 'assassination' ? `<span class="info-pill">${g.round + 1}번째 원정 · ${g.attempt}번째 제안</span>` : ''}
      </div>
      <div class="action parchment">${actionHTML()}</div>`;
  }

  function names(ids) { return ids.map((id) => esc(pname(id))).join(', '); }

  function actionHTML() {
    const g = state.game;
    const me = g.me;
    const meId = state.me.id;
    const size = g.questSizes[g.round];
    const failNote = g.failsRequired[g.round] > 1 ? ' · <b class="evil-text">실패 카드 2장 이상이어야 실패</b>' : '';

    switch (g.phase) {
      case 'team': {
        if (g.leaderId === meId) {
          return `<h3>👑 원정대를 골라 주세요</h3>
            <p>플레이어 카드를 눌러 <b class="names">${size}명</b>을 고르세요 (자신 포함 가능)${failNote}</p>
            <p>선택 ${selected.size}/${size}: <span class="names">${selected.size ? names(g.order.filter((id) => selected.has(id))) : '없음'}</span></p>
            <div class="action-btns">
              <button class="btn ghost" data-act="clearSel" ${selected.size ? '' : 'disabled'} style="color:#5a1a0e;border-color:#8a6118">선택 초기화</button>
              <button class="btn gold" data-act="propose" ${selected.size === size ? '' : 'disabled'}><span>⚔ 원정대 제안</span></button>
            </div>`;
        }
        return `<h3>👑 ${esc(pname(g.leaderId))}님이 원정대를 고르는 중…</h3>
          <p>이번 원정은 <b class="names">${size}명</b>이 떠납니다${failNote}</p>`;
      }
      case 'vote': {
        const voted = g.votedIds.length;
        const top = `<h3>🗳 원정대 찬반 투표</h3>
          <p>원정대장 ${esc(pname(g.leaderId))}님의 제안: <span class="names">${names(g.proposal)}</span></p>
          <div class="progress"><div style="width:${(voted / g.order.length) * 100}%"></div></div>
          <p>${voted}/${g.order.length}명 투표 완료 · 과반수(${Math.floor(g.order.length / 2) + 1}명 이상) 찬성 시 출발</p>`;
        if (me.myVote === null) {
          return `${top}<div class="seal-row">
            <button class="seal approve" data-act="approve">${icon('good')}찬성</button>
            <button class="seal reject" data-act="reject">${icon('evil')}반대</button></div>`;
        }
        return `${top}<p>당신은 <b class="${me.myVote ? 'good' : 'evil'}-text">${me.myVote ? '찬성' : '반대'}</b>에 투표했습니다. 다른 사람을 기다리는 중…</p>`;
      }
      case 'quest': {
        const played = g.questPlayedIds.length;
        const inTeam = g.proposal.includes(meId);
        const top = `<h3>⚔ ${g.round + 1}번째 원정 진행 중</h3>
          <p>원정대: <span class="names">${names(g.proposal)}</span>${failNote}</p>
          <div class="progress"><div style="width:${(played / g.proposal.length) * 100}%"></div></div>
          <p>${played}/${g.proposal.length}명 카드 제출</p>`;
        if (inTeam && me.myCard === null) {
          return `${top}<div class="qc-row">
            <button class="qc s" data-act="success"><div class="qc-face">${icon('good')}성공</div></button>
            <button class="qc f" data-act="fail" ${me.canFail ? '' : 'disabled'}><div class="qc-face">${icon('evil')}실패</div></button></div>
            ${me.canFail ? '' : '<p style="text-align:center">선 플레이어는 성공 카드만 낼 수 있습니다.</p>'}`;
        }
        if (inTeam) return `${top}<p>카드를 냈습니다. 다른 원정대원을 기다리는 중…</p>`;
        return top;
      }
      case 'assassination': {
        const assassin = g.assassinId;
        if (me.role === 'assassin') {
          return `<h3>⚔ 멀린을 암살하세요</h3>
            <p>악 팀 회의 채팅에서 동료들과 상의한 뒤, 멀린이라고 생각하는 사람의 카드를 누르세요.</p>
            <p>지목: <b class="names">${target ? esc(pname(target)) : '없음'}</b></p>
            <div class="action-btns"><button class="btn evil" data-act="assassinate" ${target ? '' : 'disabled'}>⚔ 암살하기</button></div>`;
        }
        if (me.evilReveal) {
          const aiAssassin = player(assassin) && player(assassin).ai;
          return `<h3>⚔ 암살 회의</h3><p>악 플레이어들의 정체가 공개되었습니다. <b>악 팀 회의</b> 탭에서 암살자 <b class="names">${esc(pname(assassin))}</b>님과 멀린이 누군지 상의하세요.${aiAssassin ? ' <b>AI 암살자는 채팅에 적힌 멀린 후보 이름을 따릅니다.</b>' : ''}</p>`;
        }
        return `<h3>⚔ 원정 3번 성공!</h3><p>암살자 <b class="names">${esc(pname(assassin))}</b>님이 악 동료들과 상의해 멀린을 찾고 있습니다… 멀린이 들키지 않으면 선의 승리!</p>`;
      }
      case 'over': {
        const win = g.winner === 'good';
        return `<h3 class="${win ? 'good' : 'evil'}-text">🏁 ${win ? '선' : '악'}의 승리!</h3>
          <p>${esc(g.reason)}</p>
          <div class="action-btns">
            <button class="btn iron" data-act="showFinal">결과 보기</button>
            ${isHost() ? '<button class="btn gold" data-act="toLobby"><span>대기실로 (새 게임)</span></button>' : ''}
          </div>
          ${isHost() ? '' : '<p>방장이 새 게임을 준비할 때까지 기다려 주세요.</p>'}`;
      }
      default:
        return '';
    }
  }

  $('#board').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    const g = state.game;
    const lock = async (fn) => { b.disabled = true; const r = await fn(); if (!r.ok) b.disabled = false; };
    switch (act) {
      case 'clearSel': selected = new Set(); renderPlayers(); renderBoard(); break;
      case 'propose': await lock(() => call('propose', { team: g.order.filter((id) => selected.has(id)) })); break;
      case 'approve': await lock(() => call('vote', { approve: true })); break;
      case 'reject': await lock(() => call('vote', { approve: false })); break;
      case 'success': await lock(() => call('card', { card: 'success' })); break;
      case 'fail':
        if (confirm('정말 실패 카드를 낼까요?')) await lock(() => call('card', { card: 'fail' }));
        break;
      case 'assassinate':
        if (target && confirm(`${pname(target)}님을 멀린으로 지목해 암살할까요? 되돌릴 수 없습니다.`)) {
          await lock(() => call('assassinate', { targetId: target }));
        }
        break;
      case 'showFinal': showFinal(g); break;
      case 'toLobby': await lock(() => call('toLobby')); break;
      default: break;
    }
  });

  function onCardsClick(e) {
    const pb = e.target.closest('[data-predict]');
    if (pb) { openPredict(pb.dataset.predict, pb); return; }
    const db = e.target.closest('[data-dm]');
    if (db) { openDm(db.dataset.dm); return; }
    const card = e.target.closest('[data-card]');
    if (!card || e.target.closest('button')) return;
    const id = card.dataset.card;
    if (!isSelectable(id)) return;
    const g = state.game;
    if (g.phase === 'team') {
      const size = g.questSizes[g.round];
      if (selected.has(id)) selected.delete(id);
      else if (selected.size < size) selected.add(id);
      else toast(`원정대는 ${size}명입니다. 다른 사람을 먼저 빼 주세요.`);
    } else if (g.phase === 'assassination') {
      target = target === id ? null : id;
    }
    renderPlayers();
    renderBoard();
  }
  $('#row-top').addEventListener('click', onCardsClick);
  $('#row-bottom').addEventListener('click', onCardsClick);

  // ── 역할 카드 / 구성 ──────────────────────────────────
  function renderRole() {
    const g = state.game;
    const me = g.me;
    const info = ROLE_INFO[me.role];
    const lines = [];
    const k = me.knowledge;
    const ids = (type) => g.order.filter((id) => k[id] === type);
    const loner = me.role === 'oberon' || me.role === 'lancelot_evil';
    if (me.role === 'merlin') lines.push(`<b>악으로 보이는 사람:</b> <span class="evil-text">${names(ids('evil')) || '없음'}</span>`);
    else if (me.role === 'percival') lines.push(`<b>멀린 또는 모르가나:</b> <span style="color:#6a2aa8;font-weight:700">${names(ids('merlin?')) || '없음'}</span>`);
    else if (info.team === 'evil' && !loner) lines.push(`<b>악 동료:</b> <span class="evil-text">${names(ids('evil')) || '없음'}</span>`);
    if (me.role.startsWith('lancelot')) {
      lines.push(`<b>다른 랜슬롯:</b> ${names(ids('lancelot')) || '없음'}`);
      lines.push(`<b>현재 소속:</b> <span class="${me.team}-text">${me.team === 'good' ? '선' : '악'}</span>${me.team !== me.initialTeam ? ' (충성이 바뀐 상태)' : ''}`);
    }
    if (loner) lines.push('다른 악이 누구인지 모르고, 다른 악도 당신을 모릅니다.');
    if (me.evilReveal) {
      lines.push(`<b>공개된 악 팀:</b> ${g.order.filter((id) => me.evilReveal[id]).map((id) => `${esc(pname(id))}(${esc(ROLE_INFO[me.evilReveal[id]].name)})`).join(', ')}`);
    }

    const panel = $('#role-panel');
    const deal = dealNext;
    dealNext = false;
    panel.innerHTML = `
      <div class="role-card ${concealed ? 'concealed' : ''} ${deal ? 'deal' : ''}">
        <div class="rc-face rc-front ${me.team}">
          <div class="rc-inner">
            <div class="rc-crest">${icon(me.role)}</div>
            <div class="you-are">당신은</div>
            <div class="role-name">${esc(me.roleName)}</div>
            <div class="you-are">입니다.</div>
            <div class="role-desc">${esc(info.desc)}</div>
          </div>
        </div>
        <div class="rc-face rc-back"><div class="rc-inner">${icon('emblem')}<p>AVALON</p></div></div>
      </div>
      ${lines.length && !concealed ? `<div class="role-know parchment">${lines.join('<br>')}</div>` : ''}
      <div class="role-btns">
        <button class="btn iron small" data-role-act="conceal">${concealed ? '👁 역할 보기' : '🛡 역할 가리기'}</button>
        ${isHost() && g.phase !== 'over' ? '<button class="btn ghost small" data-role-act="abort">게임 중단</button>' : ''}
        <button class="btn ghost small" data-role-act="leave">나가기</button>
      </div>`;
  }
  $('#role-panel').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-role-act]');
    if (!b) return;
    const act = b.dataset.roleAct;
    if (act === 'conceal') {
      concealed = !concealed;
      const card = $('#role-panel .role-card');
      if (card) card.classList.toggle('concealed', concealed);
      setTimeout(() => { renderRole(); renderPlayers(); }, concealed ? 0 : 450);
    }
    if (act === 'abort' && confirm('게임을 중단하고 모두 대기실로 돌아갈까요?')) await call('toLobby');
    if (act === 'leave' && confirm('게임에서 나갈까요? 나가도 "이전 게임으로 돌아가기"로 다시 들어올 수 있습니다.')) {
      await call('leave');
      const keep = session;
      clearSession();
      try { if (state.room.phase === 'game' && keep) localStorage.setItem('avalon.last', JSON.stringify(keep)); } catch { /* noop */ }
      state = null;
      resetChat();
      render();
    }
  });

  function renderComp() {
    const g = state.game;
    const goodN = g.composition.filter((c) => c.team === 'good').reduce((a, c) => a + c.count, 0);
    $('#comp-panel').innerHTML = `
      <h3>${icon('scroll')}${g.order.length}명의 원탁</h3>
      ${g.composition.map((c) => `<div class="comp-row ${c.team}"><span class="ci">${icon(c.role)}</span><span class="rn">${esc(c.name)}</span><span class="cnt">${c.count}</span></div>`).join('')}
      <div class="comp-sum"><span style="color:#1f4fa8">선 ${goodN}</span> · <span style="color:#9c1422">악 ${g.order.length - goodN}</span></div>`;
  }

  // ── 역할 예상 팝업 ────────────────────────────────────
  let predictFor = null;
  function openPredict(id, anchor) {
    predictFor = id;
    const g = state.game;
    const pop = $('#predict');
    $('#predict-title').textContent = `${pname(id)}님의 역할 예상 (나만 보임)`;
    const opts = [['good', '선'], ['evil', '악'], ...g.composition.map((c) => [c.role, c.name])];
    $('#predict-opts').innerHTML = opts.map(([v, label]) => `<button class="${guessTeam(v)}" data-guess="${v}">${icon(v)}${esc(label)}</button>`).join('') +
      (state.predictions[id] ? '<button class="clear" data-guess="">✕ 예상 지우기</button>' : '');
    pop.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }
  function closePredict() { predictFor = null; $('#predict').classList.add('hidden'); }
  $('#predict-opts').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-guess]');
    if (!b || !predictFor) return;
    const id = predictFor;
    closePredict();
    await call('predict', { targetId: id, role: b.dataset.guess || null });
  });
  document.addEventListener('click', (e) => {
    if (predictFor && !e.target.closest('#predict') && !e.target.closest('[data-predict]')) closePredict();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePredict(); hideOverlay(); }
  });

  // ── 오버레이 ──────────────────────────────────────────
  function showOverlay(html) {
    $('#overlay-card').innerHTML = html;
    $('#overlay').classList.remove('hidden');
  }
  function hideOverlay() { $('#overlay').classList.add('hidden'); }
  $('#overlay').addEventListener('click', (e) => {
    if (e.target.id === 'overlay' || e.target.closest('[data-close]')) {
      hideOverlay();
      if (lastOverlay === 'quest' && state && state.game && state.game.phase === 'over') {
        lastOverlay = 'final';
        showFinal(state.game);
      }
    }
  });

  function showQuestResult(g, r) {
    const cards = [];
    for (let i = 0; i < r.successes; i++) cards.push(`<div class="flip s" style="animation-delay:${0.3 + i * 0.35}s"><div class="ff">${icon('good')}성공</div><div class="fb">${icon('emblem')}</div></div>`);
    for (let i = 0; i < r.fails; i++) cards.push(`<div class="flip f" style="animation-delay:${0.3 + (r.successes + i) * 0.35}s"><div class="ff">${icon('evil')}실패</div><div class="fb">${icon('emblem')}</div></div>`);
    lastOverlay = 'quest';
    showOverlay(`
      <h2 class="${r.success ? 'good' : 'evil'}-text">${r.round + 1}번째 원정 ${r.success ? '성공!' : '실패!'}</h2>
      <p class="hint">원정대: ${names(r.team)}${r.required > 1 ? ' · 실패 2장 이상 필요' : ''}</p>
      <div class="cards-reveal">${cards.join('')}</div>
      <p>성공 ${r.successes}장 · 실패 ${r.fails}장</p>
      <button class="btn gold" data-close><span>${g.phase === 'over' ? '최종 결과 보기' : '확인'}</span></button>`);
  }

  function showFinal(g) {
    if (!g.allRoles) return;
    lastOverlay = 'final';
    const win = g.winner === 'good';
    const list = g.order.map((id, i) => {
      const role = g.allRoles[id];
      const team = g.finalTeams[id];
      const switched = role.startsWith('lancelot') && team !== ROLE_INFO[role].team ? ` → ${team === 'good' ? '선' : '악'}` : '';
      return `<div class="final-card ${team} ${state.me.id === id ? 'me' : ''}" style="animation-delay:${0.2 + i * 0.08}s"><div>
        ${icon(role)}
        <span class="fn">${esc(pname(id))}${state.me.id === id ? ' (나)' : ''}${g.assassinTarget === id ? ' ⚔' : ''}</span>
        <span class="fr">${esc(ROLE_INFO[role].name)}${switched}</span>
      </div></div>`;
    }).join('');
    const myWin = g.me && g.me.team === g.winner;
    showOverlay(`
      <h2 class="${win ? 'good' : 'evil'}-text">${win ? '선' : '악'}의 승리!</h2>
      <div class="banner ${win ? 'good' : 'evil'}">${myWin ? '🎉 당신의 팀이 이겼습니다' : '😢 당신의 팀이 졌습니다'}</div>
      <p>${esc(g.reason)}</p>
      <div class="final-grid">${list}</div>
      <button class="btn gold" data-close><span>닫기</span></button>`);
  }

  // 시작
  render();
  window.__avalon = { get state() { return state; } }; // 디버그용
})();
