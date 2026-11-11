'use strict';

// 혼자 테스트할 때 쓰는 봇: 방 코드에 봇 N명을 넣고 자동으로 플레이합니다.
//   사용법: node scripts/bots.js <방코드> [봇 수=4] [서버주소=http://localhost:3000]
const { io } = require('socket.io-client');

const [code, countArg, urlArg] = process.argv.slice(2);
if (!code) {
  console.log('사용법: node scripts/bots.js <방코드> [봇 수] [서버주소]');
  process.exit(1);
}
const count = Number(countArg || 4);
const url = urlArg || 'http://localhost:3000';
// 악 봇이 실패 카드를 낼 확률 (환경변수 BOT_FAIL 로 조절, 기본 0.6)
const FAIL_RATE = process.env.BOT_FAIL !== undefined ? Number(process.env.BOT_FAIL) : 0.6;
const NAMES = ['아서', '가웨인', '트리스탄', '갤러해드', '보르스', '케이', '베디비어', '퍼시', '라모락'];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function bot(name) {
  const s = io(url, { transports: ['websocket'] });
  let state = null;
  let busy = false;
  const emit = (ev, payload) => new Promise((r) => s.emit(ev, payload || {}, r));

  async function act() {
    if (busy || !state || !state.game) return;
    const g = state.game;
    const me = state.me.id;
    busy = true;
    try {
      await delay(700 + Math.random() * 900);
      if (!state.game) return;
      if (g.phase === 'team' && g.leaderId === me) {
        const others = g.order.filter((id) => id !== me).sort(() => Math.random() - 0.5);
        await emit('propose', { team: [me, ...others].slice(0, g.questSizes[g.round]) });
      } else if (g.phase === 'vote' && g.me.myVote === null) {
        await emit('vote', { approve: Math.random() < 0.75 });
      } else if (g.phase === 'quest' && g.proposal.includes(me) && g.me.myCard === null) {
        await emit('card', { card: g.me.canFail && Math.random() < FAIL_RATE ? 'fail' : 'success' });
      } else if (g.phase === 'assassination' && g.me.role === 'assassin') {
        await delay(2500);
        const targets = g.order.filter((id) => id !== me && !(g.me.evilReveal || {})[id]);
        await emit('assassinate', { targetId: pick(targets) });
      }
    } finally {
      busy = false;
    }
  }

  s.on('connect', async () => {
    const r = await emit('join', { code, name });
    console.log(r.ok ? `🤖 ${name} 입장` : `🤖 ${name} 입장 실패: ${r.error}`);
  });
  s.on('state', (st) => { state = st; act(); });
  s.on('dm', ({ msg }) => {
    if (state && msg.from !== state.me.id) {
      setTimeout(() => emit('dm', { to: msg.from, text: pick(['저는 선이에요!', '음… 글쎄요', '믿어 주세요 🙏']) }), 800);
    }
  });
  setInterval(act, 1500);
}

for (let i = 0; i < count; i++) bot(`${NAMES[i % NAMES.length]}봇`);
