'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { RoomManager } = require('./src/rooms');
const { GameError } = require('./src/game');

function createServer({ rng } = {}) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    pingInterval: 20000,
    pingTimeout: 25000,
    maxHttpBufferSize: 1e5,
  });
  const manager = new RoomManager({ rng });

  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: manager.rooms.size }));

  const roomChan = (code) => `r:${code}`;
  const playerChan = (id) => `p:${id}`;

  // 시스템 메시지는 방 전체에 바로 전송
  manager.onSystem = (room, msg) => io.to(roomChan(room.code)).emit('chat', msg);

  function broadcastState(room) {
    if (!manager.rooms.has(room.code)) return;
    for (const p of room.players) {
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
      // 같은 플레이어의 다른 탭도 함께 정리
      const sockets = await socketsOfPlayer(playerId);
      manager.leave(room, playerId);
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
      broadcastState(room);
    });

    on(socket, 'toLobby', () => {
      const { room, playerId } = ctx(socket);
      manager.returnToLobby(room, playerId);
      broadcastState(room);
    });

    for (const action of ['propose', 'vote', 'card', 'assassinate']) {
      on(socket, action, (payload) => {
        const { room, playerId } = ctx(socket);
        const before = room.game ? room.game.phase : null;
        manager.act(room, playerId, action, payload);
        broadcastState(room);
        // 암살 단계로 넘어가면 악 플레이어에게 악 채팅 초기화
        if (before !== 'assassination' && room.game && room.game.phase === 'assassination') {
          for (const id of manager.evilMembers(room)) {
            io.to(playerChan(id)).emit('evilChatInit', room.evilChat.slice());
          }
        }
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
    });

    on(socket, 'evilChat', ({ text }) => {
      const { room, playerId } = ctx(socket);
      const msg = manager.evilChat(room, playerId, text);
      for (const id of manager.evilMembers(room)) io.to(playerChan(id)).emit('evilChat', msg);
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
    const removed = manager.sweep();
    const touched = new Set(removed.map((r) => r.room));
    for (const room of touched) broadcastState(room);
  }, 30 * 1000);
  sweeper.unref();

  server.on('close', () => clearInterval(sweeper));

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
