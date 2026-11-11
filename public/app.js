/* 아발론 온라인 — 클라이언트 */
(() => {
  'use strict';

  // ── 역할 정보 ──────────────────────────────────────────
  const ROLE_INFO = {
    merlin:        { name: '멀린', team: 'good', desc: '모드레드를 제외한 악 플레이어를 알고 있습니다. 암살자에게 정체를 들키지 마세요!' },
    percival:      { name: '퍼시벌', team: 'good', desc: '멀린과 모르가나가 누구인지 알지만, 둘 중 누가 진짜 멀린인지는 모릅니다.' },
    servant:       { name: '아서 왕의 충성스러운 신하', team: 'good', desc: '특별한 능력은 없습니다. 추리로 악을 찾아내 원정을 성공시키세요.' },
    lancelot_good: { name: '선 랜슬롯', team: 'good', desc: '다른 랜슬롯을 알고 있습니다. 원정 전마다 2/7 확률로 두 랜슬롯의 선/악이 뒤바뀝니다.' },
    assassin:      { name: '암살자', team: 'evil', desc: '선이 원정 3번 성공하면, 악 동료들과 상의해 멀린을 지목해 암살합니다.' },
    morgana:       { name: '모르가나', team: 'evil', desc: '퍼시벌에게 멀린처럼 보입니다. 퍼시벌을 속이세요.' },
    mordred:       { name: '모드레드', team: 'evil', desc: '멀린에게 정체가 보이지 않습니다.' },
    oberon:        { name: '오베론', team: 'evil', desc: '악이지만 다른 악을 모르고, 다른 악들도 당신의 존재를 모릅니다.' },
    minion:        { name: '모드레드의 수하', team: 'evil', desc: '특별한 능력은 없습니다. 정체를 숨기고 원정을 실패시키세요.' },
    lancelot_evil: { name: '악 랜슬롯', team: 'evil', desc: '다른 랜슬롯을 알고 있습니다. 원정 전마다 2/7 확률로 두 랜슬롯의 선/악이 뒤바뀝니다.' },
  };
  const TEAM_SIZES = { 5: [3, 2], 6: [4, 2], 7: [4, 3], 8: [5, 3], 9: [6, 3], 10: [6, 4] };
  const OPTION_INFO = {
    percival: { label: '퍼시벌', team: 'good', desc: '멀린과 모르가나를 앎' },
    lancelot: { label: '랜슬롯 (선·악 한 쌍)', team: 'both', desc: '서로를 알고, 원정 전 2/7 확률로 선/악 전환' },
    morgana: { label: '모르가나', team: 'evil', desc: '퍼시벌에게 멀린처럼 보임' },
    mordred: { label: '모드레드', team: 'evil', desc: '멀린에게 안 보임' },
    oberon: { label: '오베론', team: 'evil', desc: '악끼리 서로 모름' },
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
  let lastOverlay = null;

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
    // 새 게임이 시작되면 개인 채팅/선택 초기화
    if (prev && prev.room.phase !== 'game' && s.room.phase === 'game') {
      dms = {};
      for (const k of Object.keys(dmUnread)) delete dmUnread[k];
      evilMsgs = [];
      evilUnread = 0;
      renderEvilLog();
      closeDm();
      concealed = false;
      lastOverlay = null;
    }
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
  function msgNode(m) {
    const div = document.createElement('div');
    if (m.system) {
      div.className = 'msg sys';
      div.textContent = m.text;
    } else {
      const mine = state && state.me && m.from === state.me.id;
      div.className = 'msg' + (mine ? ' mine' : '');
      div.innerHTML = `<span class="who">${esc(m.name)}:</span>${esc(m.text)}`;
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
    $('#chat-input').placeholder = tab === 'evil' ? '악 팀에게만 보이는 메시지…' : '메시지 입력…';
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
  function showScreen(id) {
    for (const s of ['home', 'lobby', 'game']) $(`#screen-${s}`).classList.toggle('hidden', s !== id);
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
      if (last) resume.textContent = `이전 게임으로 돌아가기 (방 ${last.code})`;
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

  function renderLobby() {
    const r = state.room;
    const n = r.players.length;
    const host = isHost();
    $('#lobby-code').textContent = r.code;
    $('#lobby-count').textContent = r.phase === 'setup'
      ? `${n}명으로 확정 · 캐릭터 선정 중`
      : `${n} / ${r.maxPlayers}명 · ${n < r.minPlayers ? `${r.minPlayers - n}명 더 모이면 시작할 수 있어요` : '시작할 수 있어요!'}`;

    $('#lobby-players').innerHTML = r.players.map((p, i) => `
      <li class="${p.id === state.me.id ? 'me' : ''} ${p.connected ? '' : 'off'}">
        <span class="seat">${i + 1}</span>
        <span class="pname">${p.id === r.hostId ? '👑 ' : ''}${esc(p.name)}${p.id === state.me.id ? ' (나)' : ''}${p.connected ? '' : ' · 연결 끊김'}</span>
        ${host && p.id !== state.me.id && r.phase === 'lobby' ? `<button class="icon-btn kick" data-kick="${p.id}" title="내보내기">✕</button>` : ''}
      </li>`).join('');

    // 캐릭터 선정
    const setup = $('#lobby-setup');
    if (r.phase === 'setup') {
      const t = TEAM_SIZES[n] || [0, 0];
      const o = r.options;
      const opt = (key) => {
        const info = OPTION_INFO[key];
        const on = !!o[key];
        const blocked = !on && !!optionError(n, { ...o, [key]: true });
        const cls = info.team === 'both' ? 'good' : info.team;
        return `<label class="role-opt ${cls} ${on ? 'on' : ''}" title="${blocked ? '인원이 부족해 추가할 수 없습니다' : ''}">
          <input type="checkbox" data-opt="${key}" ${on ? 'checked' : ''} ${!host || blocked ? 'disabled' : ''}>
          <span><span class="rname">${info.label}</span><br><span class="rdesc">${info.desc}${blocked ? ' · 자리 부족' : ''}</span></span>
        </label>`;
      };
      const locked = (name, team, desc) => `<label class="role-opt ${team} on locked">
          <input type="checkbox" checked disabled><span><span class="rname">${name}</span> <small>(고정)</small><br><span class="rdesc">${desc}</span></span></label>`;
      setup.innerHTML = `
        <div class="setup">
          <h3>캐릭터 선정 ${host ? '' : '<small class="hint">(방장이 고르는 중)</small>'}</h3>
          <div class="teams"><span class="good-text">선 ${t[0]}명</span><span class="evil-text">악 ${t[1]}명</span></div>
          <div class="role-grid">
            <div class="role-col"><h4 class="good-text">선</h4>
              ${locked('멀린', 'good', '모드레드를 뺀 악을 앎')}
              ${opt('percival')}
              ${opt('lancelot')}
            </div>
            <div class="role-col"><h4 class="evil-text">악</h4>
              ${locked('암살자', 'evil', '마지막에 멀린을 암살')}
              ${opt('morgana')}
              ${opt('mordred')}
              ${opt('oberon')}
            </div>
          </div>
          <p class="hint">남는 자리는 <b class="good-text">아서 왕의 충성스러운 신하</b> / <b class="evil-text">모드레드의 수하</b>로 채워집니다.</p>
          ${r.optionsError ? `<div class="setup-error">⚠ ${esc(r.optionsError)}</div>` : ''}
          ${r.composition ? `<div class="comp-inline">${r.composition.map((c) => `<span class="chip ${c.team}">${esc(c.name)} ×${c.count}</span>`).join('')}</div>` : ''}
        </div>`;
    } else {
      setup.innerHTML = '';
    }

    const actions = $('#lobby-actions');
    if (r.phase === 'lobby') {
      actions.innerHTML = host
        ? `<button class="btn gold big" data-act="setupBegin" ${n < r.minPlayers ? 'disabled' : ''}>게임 시작 (${n}명)</button>`
        : '<p class="hint">방장이 게임을 시작하기를 기다리는 중…</p>';
    } else {
      actions.innerHTML = host
        ? `<button class="btn ghost big" data-act="setupCancel">뒤로</button>
           <button class="btn gold big" data-act="start" ${r.optionsError ? 'disabled' : ''}>이 구성으로 시작!</button>`
        : '<p class="hint">방장이 캐릭터를 고르고 있습니다. 잠시만 기다려 주세요…</p>';
    }
  }

  $('#lobby-players').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-kick]');
    if (!b) return;
    const id = b.dataset.kick;
    if (confirm(`${pname(id)}님을 내보낼까요?`)) await call('kick', { targetId: id });
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
      body = `<div class="pc-role ${g.finalTeams[id]}-text">${esc(ROLE_INFO[role].name)}</div>`;
    } else if (isMe) {
      body = `<div class="pc-role ${me.team}-text">${concealed ? '●●●' : esc(me.roleName)}</div>`;
    } else if (me.evilReveal && me.evilReveal[id]) {
      body = `<div class="pc-role evil-text">${esc(ROLE_INFO[me.evilReveal[id]].name)}</div>`;
    } else if (guess) {
      body = `<div class="pc-guess ${guessTeam(guess)}-text"><small>예상</small>${esc(guessName(guess))}</div>`;
    } else {
      body = '<div class="pc-q">?</div>';
    }

    const leader = g.leaderId === id && g.phase !== 'over' && g.phase !== 'assassination';
    const onTeam = (g.proposal && g.proposal.includes(id)) || selected.has(id);
    const badges = `<div class="pc-badges"><span>${leader ? '👑' : ''}</span><span>${onTeam ? '⚔️' : ''}${p.connected ? '' : '📴'}${g.assassinTarget === id ? '🗡️' : ''}</span></div>`;

    let voteBadge = '';
    if (g.phase === 'vote') {
      if (g.votedIds.includes(id)) voteBadge = '<span class="pc-vote wait">투표완료</span>';
    } else if (g.phase === 'quest' && g.proposal && g.proposal.includes(id)) {
      if (g.questPlayedIds.includes(id)) voteBadge = '<span class="pc-vote wait">제출</span>';
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
      <div class="pc-head"><div class="pc-name"><span class="seatno">${seat}</span>${esc(p.name)}</div><div class="pc-tag ${tag.cls}">${tag.text}</div></div>
      <div class="pc-body">${badges}${body}${voteBadge}</div>
      ${isMe
        ? '<button class="pc-btn" disabled>-</button><button class="pc-btn" disabled>나</button>'
        : `<button class="pc-btn" data-predict="${id}">${guess ? '예상 바꾸기' : '예상하기'}</button>
           <button class="pc-btn" data-dm="${id}">1:1 채팅${unread ? `<span class="badge">${unread}</span>` : ''}</button>`}
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

  function renderBoard() {
    const g = state.game;
    const n = g.order.length;
    const quests = g.questSizes.map((size, i) => {
      const r = g.results[i];
      const note = g.failsRequired[i] > 1 ? '실패 2장 필요' : '';
      if (r) {
        return `<div class="qwrap"><div class="qnote">${note}</div><div class="qtok ${r.success ? 'success' : 'fail'}">${r.success ? '성공' : '실패'}<small>실패 ${r.fails}장</small></div></div>`;
      }
      const cur = i === g.round && g.phase !== 'over' && g.phase !== 'assassination';
      return `<div class="qwrap"><div class="qnote">${note}</div><div class="qtok ${cur ? 'cur' : ''}">${size}<small>명</small></div></div>`;
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
      <div class="track-row"><div class="track-label">원정</div><div class="track quest-track">${quests}</div></div>
      ${lancelotRow}
      <div class="track-row"><div class="track-label">투표 상황</div><div class="track">${voteToks}</div></div>
      <div class="info-line">
        <span class="info-pill"><span class="good-text">선 ${goodN}명</span> · <span class="evil-text">악 ${evilN}명</span></span>
        ${g.phase !== 'over' && g.phase !== 'assassination' ? `<span class="info-pill">${g.round + 1}번째 원정 · ${g.attempt}번째 제안</span>` : ''}
      </div>
      <div class="action">${actionHTML()}</div>`;
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
              <button class="btn ghost" data-act="clearSel" ${selected.size ? '' : 'disabled'}>선택 초기화</button>
              <button class="btn gold" data-act="propose" ${selected.size === size ? '' : 'disabled'}>원정대 제안</button>
            </div>`;
        }
        return `<h3>👑 ${esc(pname(g.leaderId))}님이 원정대를 고르는 중…</h3>
          <p>이번 원정은 <b class="names">${size}명</b>이 갑니다${failNote}</p>`;
      }
      case 'vote': {
        const voted = g.votedIds.length;
        const top = `<h3>🗳️ 원정대 찬반 투표</h3>
          <p>원정대장 ${esc(pname(g.leaderId))}님의 제안: <span class="names">${names(g.proposal)}</span></p>
          <div class="progress"><div style="width:${(voted / g.order.length) * 100}%"></div></div>
          <p>${voted}/${g.order.length}명 투표 완료 · 과반수(${Math.floor(g.order.length / 2) + 1}명 이상) 찬성 시 출발</p>`;
        if (me.myVote === null) {
          return `${top}<div class="action-btns">
            <button class="btn good" data-act="approve">찬성</button>
            <button class="btn evil" data-act="reject">반대</button></div>`;
        }
        return `${top}<p>당신은 <b class="${me.myVote ? 'good' : 'evil'}-text">${me.myVote ? '찬성' : '반대'}</b>에 투표했습니다. 다른 사람을 기다리는 중…</p>`;
      }
      case 'quest': {
        const played = g.questPlayedIds.length;
        const inTeam = g.proposal.includes(meId);
        const top = `<h3>⚔️ ${g.round + 1}번째 원정 진행 중</h3>
          <p>원정대: <span class="names">${names(g.proposal)}</span>${failNote}</p>
          <div class="progress"><div style="width:${(played / g.proposal.length) * 100}%"></div></div>
          <p>${played}/${g.proposal.length}명 카드 제출</p>`;
        if (inTeam && me.myCard === null) {
          return `${top}<div class="action-btns">
            <button class="btn good" data-act="success">성공</button>
            <button class="btn evil" data-act="fail" ${me.canFail ? '' : 'disabled'}>실패</button></div>
            ${me.canFail ? '' : '<p>선 플레이어는 성공 카드만 낼 수 있습니다.</p>'}`;
        }
        if (inTeam) return `${top}<p>카드를 냈습니다. 다른 원정대원을 기다리는 중…</p>`;
        return top;
      }
      case 'assassination': {
        const assassin = g.assassinId;
        if (me.role === 'assassin') {
          return `<h3>🗡️ 멀린을 암살하세요</h3>
            <p>악 팀 회의 채팅에서 동료들과 상의한 뒤, 멀린이라고 생각하는 사람의 카드를 누르세요.</p>
            <p>지목: <b class="names">${target ? esc(pname(target)) : '없음'}</b></p>
            <div class="action-btns"><button class="btn evil" data-act="assassinate" ${target ? '' : 'disabled'}>암살하기</button></div>`;
        }
        if (me.evilReveal) {
          return `<h3>🗡️ 암살 회의</h3><p>악 플레이어들의 정체가 공개되었습니다. <b>악 팀 회의</b> 탭에서 암살자 <b class="names">${esc(pname(assassin))}</b>님과 멀린이 누군지 상의하세요.</p>`;
        }
        return `<h3>🗡️ 원정 3번 성공!</h3><p>암살자 <b class="names">${esc(pname(assassin))}</b>님이 악 동료들과 상의해 멀린을 찾고 있습니다… 멀린이 들키지 않으면 선의 승리!</p>`;
      }
      case 'over': {
        const win = g.winner === 'good';
        return `<h3 class="${win ? 'good' : 'evil'}-text">🏁 ${win ? '선' : '악'}의 승리!</h3>
          <p>${esc(g.reason)}</p>
          <div class="action-btns">
            <button class="btn" data-act="showFinal">결과 보기</button>
            ${isHost() ? '<button class="btn gold" data-act="toLobby">대기실로 (새 게임)</button>' : ''}
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

  // ── 역할 / 구성 ───────────────────────────────────────
  function renderRole() {
    const g = state.game;
    const me = g.me;
    const info = ROLE_INFO[me.role];
    const lines = [];
    const k = me.knowledge;
    const ids = (type) => g.order.filter((id) => k[id] === type);
    if (me.role === 'merlin') lines.push(`<b>악으로 보이는 사람:</b> <span class="evil-text">${names(ids('evil')) || '없음'}</span>`);
    else if (me.role === 'percival') lines.push(`<b>멀린 또는 모르가나:</b> <span style="color:var(--purple)">${names(ids('merlin?')) || '없음'}</span>`);
    else if (info.team === 'evil' && me.role !== 'oberon' && !me.role.startsWith('lancelot')) lines.push(`<b>악 동료:</b> <span class="evil-text">${names(ids('evil')) || '없음'}</span>`);
    if (me.role === 'lancelot_evil') lines.push(`<b>악 동료:</b> <span class="evil-text">${names(ids('evil')) || '없음'}</span>`);
    if (me.role.startsWith('lancelot')) {
      lines.push(`<b>다른 랜슬롯:</b> ${names(ids('lancelot')) || '없음'}`);
      lines.push(`<b>현재 소속:</b> <span class="${me.team}-text">${me.team === 'good' ? '선' : '악'}</span>${me.team !== me.initialTeam ? ' (충성이 바뀐 상태)' : ''}`);
    }
    if (me.role === 'oberon') lines.push('다른 악이 누구인지 모릅니다.');
    if (me.evilReveal) {
      lines.push(`<b>공개된 악 팀:</b> ${g.order.filter((id) => me.evilReveal[id]).map((id) => `${esc(pname(id))}(${esc(ROLE_INFO[me.evilReveal[id]].name)})`).join(', ')}`);
    }

    const panel = $('#role-panel');
    panel.className = `panel role-panel ${me.team}${concealed ? ' concealed' : ''}`;
    panel.innerHTML = `
      <div class="you-are">당신은</div>
      <div class="role-name ${me.team}">${esc(me.roleName)}</div>
      <div class="you-are">입니다.</div>
      <div class="role-desc">${esc(info.desc)}</div>
      ${lines.length ? `<div class="role-know">${lines.join('<br>')}</div>` : ''}
      <div class="action-btns hide-role">
        <button class="btn small ghost" data-role-act="conceal">${concealed ? '역할 보기' : '역할 가리기'}</button>
        ${isHost() && g.phase !== 'over' ? '<button class="btn small ghost" data-role-act="abort">게임 중단</button>' : ''}
        <button class="btn small ghost" data-role-act="leave">나가기</button>
      </div>`;
  }
  $('#role-panel').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-role-act]');
    if (!b) return;
    const act = b.dataset.roleAct;
    if (act === 'conceal') { concealed = !concealed; renderRole(); renderPlayers(); }
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
      <h3>${g.order.length}명</h3>
      ${g.composition.map((c) => `<div class="comp-row ${c.team}"><span class="rn">${esc(c.name)}</span><span class="cnt">${c.count}</span></div>`).join('')}
      <div class="comp-sum"><span style="color:#1f56a8">선 ${goodN}</span> · <span style="color:#a82121">악 ${g.order.length - goodN}</span></div>`;
  }

  // ── 역할 예상 팝업 ────────────────────────────────────
  let predictFor = null;
  function openPredict(id, anchor) {
    predictFor = id;
    const g = state.game;
    const pop = $('#predict');
    $('#predict-title').textContent = `${pname(id)}님의 역할 예상 (나만 보임)`;
    const opts = [['good', '선'], ['evil', '악'], ...g.composition.map((c) => [c.role, c.name])];
    $('#predict-opts').innerHTML = opts.map(([v, label]) => `<button class="${guessTeam(v)}" data-guess="${v}">${esc(label)}</button>`).join('') +
      (state.predictions[id] ? '<button class="clear" data-guess="">예상 지우기</button>' : '');
    pop.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
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
    for (let i = 0; i < r.successes; i++) cards.push(`<div class="qcard s" style="animation-delay:${i * 0.15}s">성공</div>`);
    for (let i = 0; i < r.fails; i++) cards.push(`<div class="qcard f" style="animation-delay:${(r.successes + i) * 0.15}s">실패</div>`);
    lastOverlay = 'quest';
    showOverlay(`
      <h2 class="${r.success ? 'good' : 'evil'}-text">${r.round + 1}번째 원정 ${r.success ? '성공!' : '실패!'}</h2>
      <p class="hint">원정대: ${names(r.team)}${r.required > 1 ? ' · 실패 2장 이상 필요' : ''}</p>
      <div class="cards-reveal">${cards.join('')}</div>
      <p>성공 ${r.successes}장 · 실패 ${r.fails}장</p>
      <button class="btn gold" data-close>${g.phase === 'over' ? '최종 결과 보기' : '확인'}</button>`);
  }

  function showFinal(g) {
    if (!g.allRoles) return;
    lastOverlay = 'final';
    const win = g.winner === 'good';
    const list = g.order.map((id) => {
      const role = g.allRoles[id];
      const team = g.finalTeams[id];
      const mark = (state.me.id === id ? ' (나)' : '') + (g.assassinTarget === id ? ' 🗡️' : '');
      return `<div><b>${esc(pname(id))}</b>${mark}<br><span class="${team}-text">${esc(ROLE_INFO[role].name)}${role.startsWith('lancelot') && team !== ROLE_INFO[role].team ? ` → ${team === 'good' ? '선' : '악'}` : ''}</span></div>`;
    }).join('');
    const myWin = g.me && g.me.team === g.winner;
    showOverlay(`
      <h2 class="${win ? 'good' : 'evil'}-text">${win ? '선' : '악'}의 승리!</h2>
      <p>${esc(g.reason)}</p>
      <p><b>${myWin ? '🎉 당신의 팀이 이겼습니다!' : '😢 당신의 팀이 졌습니다.'}</b></p>
      <div class="final-list">${list}</div>
      <button class="btn gold" data-close>닫기</button>`);
  }

  // 시작
  render();
  window.__avalon = { get state() { return state; } }; // 디버그용
})();
