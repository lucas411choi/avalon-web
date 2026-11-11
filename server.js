'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const compression = require('compression');
const { Server } = require('socket.io');
const { RoomManager } = require('./src/rooms');
const { GameError } = require('./src/game');
const ai = require('./src/ai');

/**
 * @param {object} opts
 * @param {() => number} [opts.rng]            게임 난수 (테스트용)
 * @param {() => number} [opts.aiDelay]        AI 행동 지연(ms)
 * @param {number} [opts.aiAssassinWait]       AI 암살자가 사람 악 동료의 의견을 기다리는 시간(ms)
 * @param {number} [opts.aiChatChance]         원정 후 AI 가 한마디 할 확률
 */
function createServer({
  rng,
  aiDelay = () => 900 + Math.random() * 1400,
  aiAssassinWait = 25000,
  aiChatChance = 0.45,
} = {}) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    pingInterval: 20000,
    pingTimeout: 25000,
    maxHttpBufferSize: 1e5,
  });
  const manager = new RoomManager({ rng });

  app.use(compression());
  app.use(express.static(path.join(__dirname, 'public')));
  // 3D 배경용 three.js (CDN 없이 직접 제공)
  app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three', 'build'), { maxAge: '7d' }));
  app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: manager.rooms.size }));

  const roomChan = (code) => `r:${code}`;
  const playerChan = (id) => `p:${id}`;
  const nameIn = (room) => (id) => {
    const p = room.players.find((x) => x.id === id);
    return p ? p.name : '???';
  };

  // 시스템 메시지는 방 전체에 바로 전송
  manager.onSystem = (room, msg) => io.to(roomChan(room.code)).emit('chat', msg);

  function broadcastState(room) {
    if (!manager.rooms.has(room.code)) return;
    for (const p of room.players) {
      if (p.ai) continue;
      io.to(playerChan(p.id)).emit('state', manager.stateFor(room, p.id));
    }
  }

  function sendInit(socket, room, player) {
    socket.emit('session', { code: room.code, playerId: player.id, token: player.token });
    socket.emit('chatInit', {
      chat: room.chat.slice(),
      dms: manager.dmsFor(room, player.id),
      evilChat: manager.canEvilChat(room, player.id) ? room.evilChat.slice() : [],
    });
    socket.emit('state', manager.stateFor(room, player.id));
  }

  function emitEvil(room, msg) {
    for (const id of manager.evilMembers(room)) io.to(playerChan(id)).emit('evilChat', msg);
  }

  // ── AI 진행 ──────────────────────────────────────────────
  function aiState(room) {
    if (!room.ai) room.ai = { timers: new Map(), hint: null, asked: false, game: null };
    if (room.ai.game !== room.game) {
      clearAI(room);
      room.ai.game = room.game;
    }
    return room.ai;
  }

  function clearAI(room) {
    if (!room.ai) return;
    for (const t of room.ai.timers.values()) clearTimeout(t);
    room.ai.timers.clear();
    room.ai.hint = null;
    room.ai.asked = false;
  }

  function later(room, key, ms, fn, { requireGame = true } = {}) {
    const st = aiState(room);
    if (st.timers.has(key)) clearTimeout(st.timers.get(key));
    const gameRef = room.game;
    const t = setTimeout(() => {
      st.timers.delete(key);
      if (!manager.rooms.has(room.code)) return;
      if (requireGame && (room.game !== gameRef || room.phase !== 'game')) return;
      try { fn(); } catch (err) { if (!(err instanceof GameError)) console.error('[ai]', err); }
    }, ms);
    st.timers.set(key, t);
  }

  function humanEvilCount(room) {
    return manager.evilMembers(room).filter((id) => {
      const p = room.players.find((x) => x.id === id);
      return p && !p.ai;
    }).length;
  }

  function scheduleAI(room) {
    if (room.phase !== 'game' || !room.game || room.game.phase === 'over') return;
    const st = aiState(room);
    const g = room.game;
    for (const p of room.players) {
      if (!p.ai || st.timers.has(p.id)) continue;
      const act = ai.decide(g, p.id);
      if (!act) continue;
      let wait = aiDelay();
      if (act.action === 'assassinate') {
        // 사람 악 동료가 있으면 의견을 받을 시간을 줌
        if (humanEvilCount(room) > 0) {
          if (!st.asked) {
            st.asked = true;
            const msg = manager.evilChat(room, p.id, `악 팀 여러분, 멀린이 누구 같나요? 이 채팅에 이름을 적어 주세요. (${Math.round(aiAssassinWait / 1000)}초 뒤 결정)`);
            emitEvil(room, msg);
          }
          wait = aiAssassinWait;
        } else {
          wait = aiDelay() + 1500;
        }
      }
      later(room, p.id, wait, () => {
        const now = ai.decide(room.game, p.id);
        if (!now) { scheduleAI(room); return; }
        if (now.action === 'assassinate' && st.hint) now.payload.targetId = ai.chooseAssassination(room.game, p.id, Math.random, st.hint);
        performAction(room, p.id, now.action, now.payload);
      });
    }
  }

  // 사람·AI 공통: 게임 행동 처리 후 후속 작업
  function performAction(room, playerId, action, payload) {
    const g = room.game;
    const before = { phase: g ? g.phase : null, results: g ? g.results.length : 0 };
    manager.act(room, playerId, action, payload);
    afterAction(room, before);
  }

  function afterAction(room, before) {
    broadcastState(room);
    const g = room.game;
    if (!g) return;
    // 암살 단계 진입: 악 채팅 열기 + AI 악 동료의 의견
    if (before.phase !== 'assassination' && g.phase === 'assassination') {
      for (const id of manager.evilMembers(room)) io.to(playerChan(id)).emit('evilChatInit', room.evilChat.slice());
      const assassinId = g.playerWithRole('assassin');
      const assassin = room.players.find((p) => p.id === assassinId);
      const helper = room.players.find((p) => p.ai && p.id !== assassinId && manager.evilMembers(room).includes(p.id));
      if (assassin && !assassin.ai && helper) {
        later(room, `hint:${helper.id}`, aiDelay() + 800, () => {
          const s = ai.assassinSuggestion(room.game, helper.id, nameIn(room), Math.random);
          emitEvil(room, manager.evilChat(room, helper.id, s.text));
        });
      }
    }
    // 원정 직후 AI 한마디
    if (g.results.length > before.results && g.phase !== 'over' && Math.random() < aiChatChance) {
      const speakers = room.players.filter((p) => p.ai);
      if (speakers.length) {
        const sp = speakers[Math.floor(Math.random() * speakers.length)];
        const result = g.results[g.results.length - 1];
        later(room, `talk:${sp.id}`, 1500 + Math.random() * 1500, () => {
          const text = ai.questComment(room.game, sp.id, result, nameIn(room), Math.random);
          io.to(roomChan(room.code)).emit('chat', manager.chat(room, sp.id, text));
        });
      }
    }
    scheduleAI(room);
  }

  // 사람 악 플레이어가 악 채팅에 멀린 후보 이름을 적으면 AI 암살자가 참고
  function onHumanEvilChat(room, fromId, text) {
    const g = room.game;
    if (!g || g.phase !== 'assassination') return;
    const assassinId = g.playerWithRole('assassin');
    const assassin = room.players.find((p) => p.id === assassinId);
    if (!assassin || !assassin.ai || fromId === assassinId) return;
    const cands = g.order.filter((id) => id !== assassinId && g.teamOf(id) === 'good');
    // 가장 긴 이름부터 찾아서 부분 일치 오인을 줄임
    const named = cands
      .map((id) => ({ id, name: nameIn(room)(id) }))
      .sort((a, b) => b.name.length - a.name.length)
      .find((c) => text.includes(c.name));
    if (!named) return;
    const st = aiState(room);
    st.hint = named.id;
    later(room, `ack:${assassinId}`, 700, () => {
      emitEvil(room, manager.evilChat(room, assassinId, `좋아요, ${named.name}님을 멀린으로 지목하겠습니다.`));
    });
    // 곧바로 실행하도록 다시 예약
    later(room, assassinId, 3500, () => {
      const now = ai.decide(room.game, assassinId);
      if (!now || now.action !== 'assassinate') return;
      now.payload.targetId = ai.chooseAssassination(room.game, assassinId, Math.random, st.hint);
      performAction(room, assassinId, now.action, now.payload);
    });
  }

  function aiReplyDm(room, aiId, toId, text) {
    later(room, `dm:${aiId}:${toId}`, 1000 + Math.random() * 1200, () => {
      const reply = ai.dmReply(room.phase === 'game' ? room.game : null, aiId, text, nameIn(room), Math.random);
      const msg = manager.dm(room, aiId, toId, reply);
      io.to(playerChan(toId)).emit('dm', { with: aiId, msg });
    }, { requireGame: false });
  }

  // ── 소켓 ─────────────────────────────────────────────────
  function attach(socket, room, player) {
    detach(socket);
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    socket.join(roomChan(room.code));
    socket.join(playerChan(player.id));
  }

  function detach(socket) {
    const { code, playerId } = socket.data;
    if (code) socket.leave(roomChan(code));
    if (playerId) socket.leave(playerChan(playerId));
    socket.data.code = null;
    socket.data.playerId = null;
  }

  async function socketsOfPlayer(playerId) {
    return io.in(playerChan(playerId)).fetchSockets();
  }

  function ctx(socket) {
    const room = manager.getRoom(socket.data.code);
    if (!room || !room.players.some((p) => p.id === socket.data.playerId)) {
      throw new GameError('방에 접속되어 있지 않습니다. 새로고침해 주세요.');
    }
    return { room, playerId: socket.data.playerId };
  }

  // 공통 핸들러 래퍼: 오류는 ack 로 돌려줌
  function on(socket, event, handler) {
    socket.on(event, async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const result = await handler(payload || {});
        reply({ ok: true, ...(result || {}) });
      } catch (err) {
        if (!(err instanceof GameError)) console.error(`[${event}]`, err);
        reply({ ok: false, error: err instanceof GameError ? err.message : '서버 오류가 발생했습니다.' });
      }
    });
  }

  io.on('connection', (socket) => {
    socket.data.code = null;
    socket.data.playerId = null;

    on(socket, 'create', ({ name }) => {
      const { room, player } = manager.createRoom(name);
      attach(socket, room, player);
      sendInit(socket, room, player);
      return { code: room.code };
    });

    on(socket, 'join', ({ code, name }) => {
      const { room, player } = manager.joinRoom(code, name);
      attach(socket, room, player);
      sendInit(socket, room, player);
      broadcastState(room);
      return { code: room.code };
    });

    on(socket, 'rejoin', ({ code, playerId, token }) => {
      const { room, player } = manager.rejoin(code, playerId, token);
      const wasConnected = player.connected;
      attach(socket, room, player);
      manager.setConnected(room, player.id, true);
      if (!wasConnected) manager.system(room, `${player.name}님이 다시 접속했습니다.`);
      sendInit(socket, room, player);
      broadcastState(room);
      return { code: room.code };
    });

    on(socket, 'leave', async () => {
      const { room, playerId } = ctx(socket);
      const sockets = await socketsOfPlayer(playerId);
      manager.leave(room, playerId);
      if (!manager.rooms.has(room.code)) clearAI(room);
      for (const s of sockets) {
        if (s.id !== socket.id) s.emit('kicked', { reason: '다른 창에서 방을 나갔습니다.' });
        detach(s);
      }
      broadcastState(room);
    });

    on(socket, 'kick', async ({ targetId }) => {
      const { room, playerId } = ctx(socket);
      manager.kick(room, playerId, targetId);
      const sockets = await socketsOfPlayer(targetId);
      for (const s of sockets) {
        s.emit('kicked', { reason: '방장이 방에서 내보냈습니다.' });
        detach(s);
      }
      broadcastState(room);
    });

    on(socket, 'setAI', ({ count }) => {
      const { room, playerId } = ctx(socket);
      manager.setAICount(room, playerId, count);
      broadcastState(room);
    });

    on(socket, 'setupBegin', () => {
      const { room, playerId } = ctx(socket);
      manager.beginSetup(room, playerId);
      broadcastState(room);
    });

    on(socket, 'setupCancel', () => {
      const { room, playerId } = ctx(socket);
      manager.cancelSetup(room, playerId);
      broadcastState(room);
    });

    on(socket, 'setOptions', ({ options }) => {
      const { room, playerId } = ctx(socket);
      manager.setOptions(room, playerId, options);
      broadcastState(room);
    });

    on(socket, 'start', () => {
      const { room, playerId } = ctx(socket);
      manager.startGame(room, playerId);
      clearAI(room);
      broadcastState(room);
      scheduleAI(room);
    });

    on(socket, 'toLobby', () => {
      const { room, playerId } = ctx(socket);
      manager.returnToLobby(room, playerId);
      clearAI(room);
      broadcastState(room);
    });

    for (const action of ['propose', 'vote', 'card', 'assassinate']) {
      on(socket, action, (payload) => {
        const { room, playerId } = ctx(socket);
        performAction(room, playerId, action, payload);
      });
    }

    on(socket, 'chat', ({ text }) => {
      const { room, playerId } = ctx(socket);
      const msg = manager.chat(room, playerId, text);
      io.to(roomChan(room.code)).emit('chat', msg);
    });

    on(socket, 'dm', ({ to, text }) => {
      const { room, playerId } = ctx(socket);
      const msg = manager.dm(room, playerId, to, text);
      io.to(playerChan(playerId)).emit('dm', { with: to, msg });
      io.to(playerChan(to)).emit('dm', { with: playerId, msg });
      const target = room.players.find((p) => p.id === to);
      if (target && target.ai) aiReplyDm(room, to, playerId, msg.text);
    });

    on(socket, 'evilChat', ({ text }) => {
      const { room, playerId } = ctx(socket);
      const msg = manager.evilChat(room, playerId, text);
      emitEvil(room, msg);
      onHumanEvilChat(room, playerId, msg.text);
    });

    on(socket, 'predict', ({ targetId, role }) => {
      const { room, playerId } = ctx(socket);
      manager.predict(room, playerId, targetId, role === undefined ? null : role);
      io.to(playerChan(playerId)).emit('state', manager.stateFor(room, playerId));
    });

    socket.on('disconnect', async () => {
      const { code, playerId } = socket.data;
      if (!code || !playerId) return;
      const room = manager.getRoom(code);
      if (!room) return;
      const remaining = await socketsOfPlayer(playerId);
      if (remaining.length > 0) return; // 다른 탭이 아직 연결됨
      const p = room.players.find((x) => x.id === playerId);
      if (!p || !p.connected) return;
      manager.setConnected(room, playerId, false);
      manager.system(room, `${p.name}님의 연결이 끊겼습니다.`);
      broadcastState(room);
    });
  });

  // 주기적으로 빈 방/끊긴 대기실 플레이어 정리
  const sweeper = setInterval(() => {
    const before = new Set(manager.rooms.values());
    const removed = manager.sweep();
    for (const room of before) if (!manager.rooms.has(room.code)) clearAI(room);
    const touched = new Set(removed.map((r) => r.room));
    for (const room of touched) broadcastState(room);
  }, 30 * 1000);
  sweeper.unref();

  server.on('close', () => {
    clearInterval(sweeper);
    for (const room of manager.rooms.values()) clearAI(room);
  });

  return { app, server, io, manager };
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const { server } = createServer();
  server.listen(PORT, () => {
    console.log(`Avalon server listening on http://localhost:${PORT}`);
  });
}

module.exports = { createServer };
