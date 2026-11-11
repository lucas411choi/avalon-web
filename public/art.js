/* 아발론 문장(紋章) 아이콘 — SVG 스프라이트 */
(() => {
  'use strict';

  const defs = `
  <linearGradient id="g-gold" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff2b8"/><stop offset=".35" stop-color="#f0c75e"/>
    <stop offset=".7" stop-color="#b8862b"/><stop offset="1" stop-color="#7a5418"/>
  </linearGradient>
  <linearGradient id="g-silver" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#c9ced9"/>
    <stop offset="1" stop-color="#6c7383"/>
  </linearGradient>
  <linearGradient id="g-blood" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ff7b7b"/><stop offset=".5" stop-color="#c0192b"/><stop offset="1" stop-color="#5c0610"/>
  </linearGradient>
  <linearGradient id="g-blue" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#8fc2ff"/><stop offset=".5" stop-color="#2f6fd6"/><stop offset="1" stop-color="#132f6b"/>
  </linearGradient>
  <linearGradient id="g-purple" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#e2b8ff"/><stop offset=".5" stop-color="#8a3fd1"/><stop offset="1" stop-color="#3a1260"/>
  </linearGradient>
  <linearGradient id="g-wood" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#7b4a24"/><stop offset="1" stop-color="#3b200c"/>
  </linearGradient>`;

  // viewBox 0 0 100 100
  const icons = {
    // 멀린: 별이 박힌 마법사 모자
    merlin: `<path d="M52 6 L28 72 Q52 80 76 72 Z" fill="url(#g-blue)" stroke="#0b1a3d" stroke-width="2"/>
      <path d="M52 6 Q60 30 64 40" fill="none" stroke="#bcd8ff" stroke-width="2" opacity=".6"/>
      <ellipse cx="52" cy="74" rx="38" ry="9" fill="url(#g-blue)" stroke="#0b1a3d" stroke-width="2"/>
      <path d="M33 70 Q52 76 71 70" fill="none" stroke="url(#g-gold)" stroke-width="4"/>
      <path d="M47 30 l2 5 5 0 -4 3 2 5 -5 -3 -5 3 2 -5 -4 -3 5 0z" fill="url(#g-gold)"/>
      <path d="M58 50 l1.5 3.5 3.5 0 -3 2 1.5 3.5 -3.5 -2 -3.5 2 1.5 -3.5 -3 -2 3.5 0z" fill="url(#g-gold)"/>
      <circle cx="40" cy="55" r="2" fill="#fff8d0"/><circle cx="62" cy="24" r="1.6" fill="#fff8d0"/>
      <path d="M80 30 l1 3 3 1 -3 1 -1 3 -1 -3 -3 -1 3 -1z M20 40 l1 3 3 1 -3 1 -1 3 -1 -3 -3 -1 3 -1z" fill="#fff4c0"/>`,
    // 퍼시벌: 십자 방패
    percival: `<path d="M50 6 L86 18 V48 Q86 78 50 94 Q14 78 14 48 V18 Z" fill="url(#g-silver)" stroke="#2a2f3a" stroke-width="2.5"/>
      <path d="M50 14 L78 24 V48 Q78 72 50 86 Q22 72 22 48 V24 Z" fill="url(#g-blue)"/>
      <rect x="44" y="20" width="12" height="60" fill="url(#g-gold)"/><rect x="26" y="40" width="48" height="11" fill="url(#g-gold)"/>`,
    // 충성스러운 신하: 곧게 선 검
    servant: `<rect x="46" y="6" width="8" height="58" rx="2" fill="url(#g-silver)" stroke="#2a2f3a" stroke-width="1.5"/>
      <path d="M50 6 L54 14 H46 Z" fill="#fff"/>
      <rect x="49" y="10" width="2" height="52" fill="#8a92a3"/>
      <rect x="26" y="62" width="48" height="8" rx="4" fill="url(#g-gold)" stroke="#5a3d10" stroke-width="1.5"/>
      <rect x="45" y="70" width="10" height="16" fill="url(#g-wood)"/>
      <circle cx="50" cy="91" r="6" fill="url(#g-gold)" stroke="#5a3d10" stroke-width="1.5"/>`,
    // 랜슬롯: 깃털 달린 기사 투구
    lancelot: `<path d="M50 4 Q72 2 70 22" fill="none" stroke="url(#g-blood)" stroke-width="8" stroke-linecap="round"/>
      <path d="M26 86 V46 Q26 16 50 14 Q74 16 74 46 V86 Q50 94 26 86 Z" fill="url(#g-silver)" stroke="#2a2f3a" stroke-width="2.5"/>
      <rect x="31" y="42" width="38" height="7" rx="2" fill="#1a1d26"/>
      <path d="M50 52 V86" stroke="#6c7383" stroke-width="3"/>
      <g fill="#1a1d26"><circle cx="40" cy="64" r="2"/><circle cx="40" cy="72" r="2"/><circle cx="60" cy="64" r="2"/><circle cx="60" cy="72" r="2"/></g>
      <path d="M26 86 Q50 94 74 86" fill="none" stroke="url(#g-gold)" stroke-width="4"/>`,
    // 암살자: 피 묻은 단검
    assassin: `<path d="M50 94 L44 40 H56 Z" fill="url(#g-silver)" stroke="#2a2f3a" stroke-width="1.5"/>
      <path d="M50 92 L48 46 H52 Z" fill="#8a92a3"/>
      <path d="M50 94 L47 74 H53 Z" fill="url(#g-blood)"/>
      <rect x="30" y="34" width="40" height="7" rx="3.5" fill="#2b2b33" stroke="url(#g-blood)" stroke-width="2"/>
      <rect x="45" y="12" width="10" height="22" fill="#2b1a12"/>
      <circle cx="50" cy="10" r="6" fill="url(#g-blood)" stroke="#2b0306" stroke-width="1.5"/>
      <path d="M74 60 Q78 70 74 74 Q70 70 74 60 Z" fill="url(#g-blood)"/>`,
    // 모르가나: 초승달과 마녀의 별
    morgana: `<path d="M64 10 A40 40 0 1 0 64 90 A46 46 0 0 1 64 10 Z" fill="url(#g-purple)" stroke="#1d0833" stroke-width="2"/>
      <path d="M70 30 l3 8 8 0 -6 5 2 8 -7 -5 -7 5 2 -8 -6 -5 8 0z" fill="url(#g-silver)"/>
      <circle cx="40" cy="50" r="5" fill="#d9a6ff" opacity=".6"/>`,
    // 모드레드: 금 간 검은 왕관
    mordred: `<path d="M14 74 L18 30 L34 52 L50 20 L66 52 L82 30 L86 74 Z" fill="#26222c" stroke="url(#g-blood)" stroke-width="3" stroke-linejoin="round"/>
      <rect x="14" y="72" width="72" height="12" rx="2" fill="url(#g-blood)"/>
      <circle cx="18" cy="28" r="4" fill="url(#g-blood)"/><circle cx="50" cy="18" r="5" fill="url(#g-blood)"/><circle cx="82" cy="28" r="4" fill="url(#g-blood)"/>
      <path d="M52 30 L46 46 L54 52 L47 70" fill="none" stroke="#0a080c" stroke-width="2.5"/>`,
    // 오베론: 뿔 달린 가면
    oberon: `<path d="M22 30 Q10 10 18 4 Q22 18 34 26 Z M78 30 Q90 10 82 4 Q78 18 66 26 Z" fill="url(#g-silver)"/>
      <path d="M50 20 Q80 20 80 50 Q80 82 50 92 Q20 82 20 50 Q20 20 50 20 Z" fill="#2a2430" stroke="url(#g-purple)" stroke-width="3"/>
      <path d="M30 46 Q38 38 46 48 Q38 54 30 46 Z M70 46 Q62 38 54 48 Q62 54 70 46 Z" fill="#ffb347"/>
      <path d="M38 72 Q50 64 62 72" fill="none" stroke="url(#g-purple)" stroke-width="3"/>`,
    // 모드레드의 수하: 전투 도끼
    minion: `<rect x="47" y="10" width="7" height="84" rx="3" fill="url(#g-wood)"/>
      <path d="M54 16 Q86 14 88 40 Q70 34 54 40 Z" fill="url(#g-silver)" stroke="#2a2f3a" stroke-width="2"/>
      <path d="M47 16 Q20 18 16 36 Q32 32 47 36 Z" fill="url(#g-silver)" stroke="#2a2f3a" stroke-width="2"/>
      <path d="M86 38 Q80 34 70 35" stroke="url(#g-blood)" stroke-width="3" fill="none"/>`,
    // 선: 성배
    good: `<path d="M26 14 H74 Q74 50 50 56 Q26 50 26 14 Z" fill="url(#g-gold)" stroke="#5a3d10" stroke-width="2"/>
      <path d="M32 20 H68" stroke="#fff4c0" stroke-width="3" opacity=".7"/>
      <rect x="46" y="56" width="8" height="18" fill="url(#g-gold)"/>
      <path d="M30 88 Q50 72 70 88 Z" fill="url(#g-gold)" stroke="#5a3d10" stroke-width="2"/>
      <circle cx="50" cy="34" r="6" fill="url(#g-blue)"/>`,
    // 악: 부러진 검
    evil: `<path d="M44 8 H56 V36 L50 40 L44 34 Z" fill="url(#g-silver)" stroke="#2a2f3a" stroke-width="1.5" transform="rotate(-12 50 24)"/>
      <path d="M44 46 L52 42 L56 48 V62 H44 Z" fill="url(#g-silver)" stroke="#2a2f3a" stroke-width="1.5"/>
      <rect x="28" y="62" width="44" height="8" rx="4" fill="url(#g-blood)"/>
      <rect x="45" y="70" width="10" height="14" fill="#2b1a12"/>
      <circle cx="50" cy="89" r="6" fill="url(#g-blood)"/>`,
    // 카드 뒷면 문장: 원탁과 엑스칼리버
    emblem: `<circle cx="50" cy="50" r="40" fill="none" stroke="url(#g-gold)" stroke-width="4"/>
      <circle cx="50" cy="50" r="31" fill="none" stroke="url(#g-gold)" stroke-width="1.5" stroke-dasharray="3 4"/>
      <rect x="47" y="12" width="6" height="56" fill="url(#g-silver)"/>
      <rect x="36" y="64" width="28" height="5" rx="2" fill="url(#g-gold)"/>
      <rect x="47" y="69" width="6" height="12" fill="url(#g-gold)"/>
      <path d="M30 88 Q50 74 70 88 Z" fill="#4a4652"/>`,
    crown: `<path d="M10 78 L16 28 L34 54 L50 18 L66 54 L84 28 L90 78 Z" fill="url(#g-gold)" stroke="#5a3d10" stroke-width="3" stroke-linejoin="round"/>
      <rect x="10" y="74" width="80" height="12" rx="3" fill="url(#g-gold)" stroke="#5a3d10" stroke-width="2"/>
      <circle cx="50" cy="80" r="4" fill="url(#g-blood)"/><circle cx="30" cy="80" r="3" fill="url(#g-blue)"/><circle cx="70" cy="80" r="3" fill="url(#g-blue)"/>`,
    sword: `<path d="M22 78 L72 18 L80 22 L30 82 Z" fill="url(#g-silver)" stroke="#2a2f3a" stroke-width="2"/>
      <path d="M18 66 L36 84" stroke="url(#g-gold)" stroke-width="7" stroke-linecap="round"/>
      <path d="M26 76 L14 88" stroke="url(#g-wood)" stroke-width="7" stroke-linecap="round"/>`,
    scroll: `<rect x="22" y="18" width="56" height="64" fill="#efe1bf" stroke="#7a5418" stroke-width="2"/>
      <rect x="16" y="12" width="68" height="10" rx="5" fill="url(#g-wood)"/><rect x="16" y="78" width="68" height="10" rx="5" fill="url(#g-wood)"/>`,
    robot: `<rect x="22" y="30" width="56" height="44" rx="10" fill="url(#g-silver)" stroke="#2a2f3a" stroke-width="3"/>
      <circle cx="38" cy="50" r="7" fill="#4fb6ff"/><circle cx="62" cy="50" r="7" fill="#4fb6ff"/>
      <rect x="38" y="62" width="24" height="4" rx="2" fill="#2a2f3a"/>
      <rect x="47" y="14" width="6" height="16" fill="#6c7383"/><circle cx="50" cy="12" r="6" fill="url(#g-blood)"/>`,
  };
  icons.lancelot_good = icons.lancelot;
  icons.lancelot_evil = icons.lancelot;

  const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">
    <defs>${defs}</defs>
    ${Object.entries(icons).map(([k, v]) => `<symbol id="ic-${k}" viewBox="0 0 100 100">${v}</symbol>`).join('')}
  </svg>`;
  document.body.insertAdjacentHTML('afterbegin', sprite);

  window.ART = {
    icon(name, cls = '') {
      const id = icons[name] ? name : 'emblem';
      return `<svg class="ic ${cls}" viewBox="0 0 100 100" aria-hidden="true"><use href="#ic-${id}"/></svg>`;
    },
  };
})();
