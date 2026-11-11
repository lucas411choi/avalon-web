'use strict';

const crypto = require('crypto');
const { AI_NAMES } = require('./ai');
const {
  Game, GameError, ROLES, MIN_PLAYERS, MAX_PLAYERS,
  normalizeOptions, validateOptions, composition, DEFAULT_OPTIONS,
} = require('./game');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // I, O 제외
const MAX_CHAT = 300;          // 저장할 최대 메시지 수
const MAX_TEXT = 300;          // 메시지 최대 글자 수
const MAX_NAME = 12;

function randomId(bytes = 8) {
  return crypto.randomBytes(bytes).toString('hex');
}

function cleanName(name) {
  if (typeof name !== 'string') throw new GameError('이름을 입력해 주세요.');
  const n = name.replace(/\s+/g, ' ').trim();
  if (!n) throw new GameError('이름을 입력해 주세요.');
  if ([...n].length > MAX_NAME) throw new GameError(`이름은 ${MAX_NAME}자 이하로 입력해 주세요.`);
  return n;
}

function cleanText(text) {
  if (typeof text !== 'string') throw new GameError('메시지를 입력해 주세요.');
  const t = text.trim();
  if (!t) throw new GameError('메시지를 입력해 주세요.');
  return [...t].slice(0, MAX_TEXT).join('');
}

function dmKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

class RoomManager {
  constructor({ rng = Math.random } = {}) {
    this.rooms = new Map();
    this.rng = rng;
    this.msgSeq = 0;
  }

  newCode() {
    for (let tries = 0; tries < 1000; tries++) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new GameError('방을 만들 수 없습니다. 잠시 후 다시 시도해 주세요.');
  }

  getRoom(code) {
    if (typeof code !== 'string') return null;
    return this.rooms.get(code.trim().toUpperCase()) || null;
  }

  requireRoom(code) {
    const room = this.getRoom(code);
    if (!room) throw new GameError('방을 찾을 수 없습니다. 방 코드를 확인해 주세요.');
    return room;
  }

  makePlayer(name, ai = false) {
    return { id: randomId(6), token: ai ? null : randomId(16), name, connected: true, disconnectedAt: null, ai };
  }

  humans(room) { return room.players.filter((p) => !p.ai); }

  // AI 인원 맞추기 (방장만, 대기실에서만)
  setAICount(room, playerId, count) {
    this.requireHost(room, playerId);
    if (room.phase !== 'lobby') throw new GameError('대기실에서만 AI 인원을 바꿀 수 있습니다.');
    const want = Math.floor(Number(count));
    if (!Number.isFinite(want) || want < 0) throw new GameError('AI 인원이 올바르지 않습니다.');
    const humans = this.humans(room).length;
    if (humans + want > MAX_PLAYERS) throw new GameError(`최대 ${MAX_PLAYERS}명까지입니다. (사람 ${humans}명 + AI ${want}명)`);
    let ais = room.players.filter((p) => p.ai);
    while (ais.length > want) {
      const last = ais[ais.length - 1];
      room.players = room.players.filter((p) => p.id !== last.id);
      ais = ais.slice(0, -1);
    }
    while (ais.length < want) {
      const used = new Set(room.players.map((p) => p.name));
      const base = AI_NAMES.find((n) => !used.has(`AI ${n}`));
      const name = base ? `AI ${base}` : `AI ${ais.length + 1}`;
      const p = this.makePlayer(name, true);
      room.players.push(p);
      ais.push(p);
    }
    room.lastActive = Date.now();
  }

  createRoom(name) {
    const n = cleanName(name);
    const code = this.newCode();
    const player = this.makePlayer(n);
    const room = {
      code,
      hostId: player.id,
      players: [player],
      phase: 'lobby',          // lobby | setup | game
      options: { ...DEFAULT_OPTIONS },
      game: null,
      chat: [],
      dms: new Map(),
      evilChat: [],
      predictions: {},
      lastActive: Date.now(),
    };
    this.rooms.set(code, room);
    this.system(room, `${n}님이 방을 만들었습니다. 방 코드: ${code}`);
    return { room, player };
  }

  joinRoom(code, name) {
    const room = this.requireRoom(code);
    const n = cleanName(name);
    if (room.phase !== 'lobby') throw new GameError('이미 게임이 시작되었거나 준비 중인 방입니다.');
    if (room.players.length >= MAX_PLAYERS) throw new GameError(`방이 가득 찼습니다. (최대 ${MAX_PLAYERS}명)`);
    if (room.players.some((p) => p.name === n)) throw new GameError('이미 같은 이름의 플레이어가 있습니다.');
    const player = this.makePlayer(n);
    room.players.push(player);
    room.lastActive = Date.now();
    this.system(room, `${n}님이 입장했습니다.`);
    return { room, player };
  }

  rejoin(code, playerId, token) {
    const room = this.requireRoom(code);
    const player = room.players.find((p) => p.id === playerId);
    if (!player || typeof token !== 'string' || player.token !== token) throw new GameError('이전 게임 정보를 찾을 수 없습니다.');
    return { room, player };
  }

  getPlayer(room, playerId) {
    const p = room.players.find((x) => x.id === playerId);
    if (!p) throw new GameError('방에 없는 플레이어입니다.');
    return p;
  }

  requireHost(room, playerId) {
    if (room.hostId !== playerId) throw new GameError('방장만 할 수 있습니다.');
  }

  setConnected(room, playerId, connected) {
    const p = room.players.find((x) => x.id === playerId);
    if (!p) return;
    p.connected = connected;
    p.disconnectedAt = connected ? null : Date.now();
    room.lastActive = Date.now();
    // 방장이 나가면 연결된 다른 사람에게 방장 위임
    if (!connected && room.hostId === playerId) {
      const next = room.players.find((x) => x.connected && !x.ai && x.id !== playerId);
      if (next) {
        room.hostId = next.id;
        this.system(room, `방장이 ${next.name}님으로 바뀌었습니다.`);
      }
    }
    if (connected && !p.ai && !room.players.some((x) => x.id === room.hostId && x.connected)) {
      room.hostId = playerId;
    }
  }

  // 로비/준비 중에는 완전히 나감, 게임 중에는 자리 유지(연결 끊김 처리)
  leave(room, playerId) {
    const p = room.players.find((x) => x.id === playerId);
    if (!p) return;
    if (room.phase === 'game') {
      this.setConnected(room, playerId, false);
      this.system(room, `${p.name}님이 게임에서 나갔습니다.`);
      return;
    }
    this.removePlayer(room, playerId);
    this.system(room, `${p.name}님이 나갔습니다.`);
  }

  removePlayer(room, playerId) {
    room.players = room.players.filter((x) => x.id !== playerId);
    delete room.predictions[playerId];
    if (room.phase === 'setup') {
      room.phase = 'lobby';
      this.system(room, '인원이 바뀌어 캐릭터 선정이 취소되었습니다.');
    }
    // 사람이 아무도 없으면 방 삭제 (AI 만 남은 방은 의미 없음)
    if (this.humans(room).length === 0) {
      this.rooms.delete(room.code);
      return;
    }
    if (room.hostId === playerId) {
      const humans = this.humans(room);
      const next = humans.find((x) => x.connected) || humans[0];
      room.hostId = next.id;
      this.system(room, `방장이 ${next.name}님으로 바뀌었습니다.`);
    }
  }

  kick(room, hostId, targetId) {
    this.requireHost(room, hostId);
    if (room.phase === 'game') throw new GameError('게임 중에는 내보낼 수 없습니다.');
    if (targetId === hostId) throw new GameError('자기 자신은 내보낼 수 없습니다.');
    const p = this.getPlayer(room, targetId);
    this.removePlayer(room, targetId);
    this.system(room, `${p.name}님이 방에서 내보내졌습니다.`);
    return p;
  }

  beginSetup(room, playerId) {
    this.requireHost(room, playerId);
    if (room.phase !== 'lobby') throw new GameError('대기실에서만 시작할 수 있습니다.');
    if (room.players.length < MIN_PLAYERS) throw new GameError(`${MIN_PLAYERS}명 이상이어야 시작할 수 있습니다. (현재 ${room.players.length}명)`);
    if (room.players.length > MAX_PLAYERS) throw new GameError(`최대 ${MAX_PLAYERS}명까지 플레이할 수 있습니다.`);
    room.phase = 'setup';
    // 인원에 맞지 않는 옵션은 자동으로 맞춰 줌
    if (validateOptions(room.players.length, room.options)) {
      room.options = { ...DEFAULT_OPTIONS };
      if (validateOptions(room.players.length, room.options)) {
        room.options = { percival: true, morgana: false, mordred: false, oberon: false, lancelot: false };
      }
    }
    this.system(room, `${room.players.length}명으로 확정! 방장이 캐릭터를 고르는 중입니다.`);
  }

  cancelSetup(room, playerId) {
    this.requireHost(room, playerId);
    if (room.phase !== 'setup') throw new GameError('캐릭터 선정 중이 아닙니다.');
    room.phase = 'lobby';
    this.system(room, '방장이 캐릭터 선정을 취소했습니다. 대기실로 돌아갑니다.');
  }

  setOptions(room, playerId, options) {
    this.requireHost(room, playerId);
    if (room.phase !== 'setup' && room.phase !== 'lobby') throw new GameError('게임 중에는 바꿀 수 없습니다.');
    room.options = normalizeOptions({ ...room.options, ...(options || {}) });
  }

  startGame(room, playerId) {
    this.requireHost(room, playerId);
    if (room.phase !== 'setup') throw new GameError('먼저 게임 시작을 눌러 캐릭터를 골라 주세요.');
    const err = validateOptions(room.players.length, room.options);
    if (err) throw new GameError(err);
    const disconnected = room.players.filter((p) => !p.connected);
    if (disconnected.length) throw new GameError(`연결이 끊긴 플레이어가 있습니다: ${disconnected.map((p) => p.name).join(', ')}`);
    room.game = new Game(room.players.map((p) => ({ id: p.id, name: p.name })), room.options, this.rng);
    room.phase = 'game';
    room.predictions = {};
    room.evilChat = [];
    room.dms = new Map();
    this.flushLogs(room);
  }

  // 게임 종료 후(또는 방장 중단) 대기실로
  returnToLobby(room, playerId) {
    this.requireHost(room, playerId);
    if (room.phase !== 'game') throw new GameError('게임 중이 아닙니다.');
    const aborted = room.game && room.game.phase !== 'over';
    room.phase = 'lobby';
    room.game = null;
    room.predictions = {};
    room.evilChat = [];
    // 연결이 끊긴 사람은 정리
    for (const p of room.players.filter((x) => !x.connected)) this.removePlayer(room, p.id);
    if (this.rooms.has(room.code)) this.system(room, aborted ? '방장이 게임을 중단했습니다. 대기실로 돌아갑니다.' : '대기실로 돌아왔습니다. 새 게임을 시작할 수 있습니다.');
  }

  // 게임 행동 (propose / vote / card / assassinate)
  act(room, playerId, action, payload) {
    if (room.phase !== 'game' || !room.game) throw new GameError('게임 중이 아닙니다.');
    const g = room.game;
    const p = payload || {};
    switch (action) {
      case 'propose': g.propose(playerId, p.team); break;
      case 'vote': g.vote(playerId, p.approve); break;
      case 'card': g.playCard(playerId, p.card); break;
      case 'assassinate': g.assassinate(playerId, p.targetId); break;
      default: throw new GameError('알 수 없는 행동입니다.');
    }
    room.lastActive = Date.now();
    this.flushLogs(room);
  }

  flushLogs(room) {
    if (!room.game) return;
    for (const text of room.game.drainLogs()) this.system(room, text);
  }

  makeMsg(fields) {
    return { id: ++this.msgSeq, ts: Date.now(), ...fields };
  }

  pushCapped(list, msg) {
    list.push(msg);
    if (list.length > MAX_CHAT) list.splice(0, list.length - MAX_CHAT);
  }

  system(room, text) {
    const msg = this.makeMsg({ system: true, text });
    this.pushCapped(room.chat, msg);
    if (this.onSystem) this.onSystem(room, msg);
    return msg;
  }

  chat(room, playerId, text) {
    const p = this.getPlayer(room, playerId);
    const msg = this.makeMsg({ from: p.id, name: p.name, text: cleanText(text) });
    this.pushCapped(room.chat, msg);
    room.lastActive = Date.now();
    return msg;
  }

  dm(room, fromId, toId, text) {
    const from = this.getPlayer(room, fromId);
    const to = room.players.find((x) => x.id === toId);
    if (!to) throw new GameError('상대 플레이어를 찾을 수 없습니다.');
    if (to.id === from.id) throw new GameError('자기 자신에게는 보낼 수 없습니다.');
    const key = dmKey(from.id, to.id);
    if (!room.dms.has(key)) room.dms.set(key, []);
    const msg = this.makeMsg({ from: from.id, to: to.id, name: from.name, text: cleanText(text) });
    this.pushCapped(room.dms.get(key), msg);
    room.lastActive = Date.now();
    return msg;
  }

  dmsFor(room, playerId) {
    const out = {};
    for (const [key, list] of room.dms) {
      const [a, b] = key.split('|');
      if (a === playerId) out[b] = list.slice();
      else if (b === playerId) out[a] = list.slice();
    }
    return out;
  }

  // 암살 단계에서 악 플레이어끼리 상의하는 채팅
  canEvilChat(room, playerId) {
    const g = room.game;
    return !!(g && (g.phase === 'assassination' || g.phase === 'over') && g.isPlayer(playerId) && g.teamOf(playerId) === 'evil');
  }

  evilChat(room, playerId, text) {
    if (!this.canEvilChat(room, playerId)) throw new GameError('악 플레이어만 암살 단계에서 사용할 수 있습니다.');
    const p = this.getPlayer(room, playerId);
    const msg = this.makeMsg({ from: p.id, name: p.name, text: cleanText(text) });
    this.pushCapped(room.evilChat, msg);
    return msg;
  }

  evilMembers(room) {
    const g = room.game;
    if (!g) return [];
    return g.order.filter((id) => g.teamOf(id) === 'evil');
  }

  // 개인 메모: 다른 플레이어의 역할 예상
  predict(room, playerId, targetId, role) {
    if (room.phase !== 'game') throw new GameError('게임 중에만 예상할 수 있습니다.');
    this.getPlayer(room, playerId);
    if (targetId === playerId) throw new GameError('자기 자신은 예상할 수 없습니다.');
    if (!room.players.some((x) => x.id === targetId)) throw new GameError('플레이어를 찾을 수 없습니다.');
    if (role !== null && role !== 'good' && role !== 'evil' && !ROLES[role]) throw new GameError('알 수 없는 역할입니다.');
    if (!room.predictions[playerId]) room.predictions[playerId] = {};
    if (role === null) delete room.predictions[playerId][targetId];
    else room.predictions[playerId][targetId] = role;
  }

  // 플레이어별로 보내는 전체 상태
  stateFor(room, playerId) {
    const me = room.players.find((x) => x.id === playerId);
    const n = room.players.length;
    let comp = null;
    let optionsError = null;
    if (n >= MIN_PLAYERS && n <= MAX_PLAYERS) {
      optionsError = validateOptions(n, room.options);
      if (!optionsError) comp = composition(n, room.options);
    }
    const state = {
      me: me ? { id: me.id, name: me.name } : null,
      room: {
        code: room.code,
        hostId: room.hostId,
        phase: room.phase,
        players: room.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected, ai: !!p.ai })),
        options: { ...room.options },
        composition: comp,
        optionsError,
        minPlayers: MIN_PLAYERS,
        maxPlayers: MAX_PLAYERS,
      },
      game: null,
      predictions: room.predictions[playerId] ? { ...room.predictions[playerId] } : {},
    };
    if (room.game) {
      state.game = { ...room.game.publicView(), me: room.game.privateView(playerId) };
    }
    return state;
  }

  // 오래 비어 있는 방 정리
  sweep(now = Date.now(), { idleMs = 30 * 60 * 1000, lobbyGraceMs = 2 * 60 * 1000 } = {}) {
    const removedPlayers = [];
    for (const room of [...this.rooms.values()]) {
      // 대기실에서 오래 끊긴 사람은 자동 퇴장
      if (room.phase !== 'game') {
        for (const p of room.players.filter((x) => !x.connected && x.disconnectedAt && now - x.disconnectedAt > lobbyGraceMs)) {
          this.removePlayer(room, p.id);
          if (this.rooms.has(room.code)) this.system(room, `${p.name}님이 연결이 끊겨 퇴장 처리되었습니다.`);
          removedPlayers.push({ room, player: p });
        }
      }
      if (!this.rooms.has(room.code)) continue;
      const anyone = room.players.some((p) => p.connected && !p.ai);
      if (!anyone && now - room.lastActive > idleMs) this.rooms.delete(room.code);
    }
    return removedPlayers;
  }
}

module.exports = { RoomManager, dmKey, cleanName, cleanText };
