'use strict';

/**
 * "Works with" agent dock -- an overlapping avatar stack in a pill (in the
 * spirit of Vercel's "Onboard your agent" control) that:
 *   - springs in once, staggered, when it scrolls into view
 *   - spotlights one agent at a time (lift + emerald ring) with the name
 *     cross-fading in the caption
 *   - fans the stack out on hover (desktop) and expands into a labelled
 *     grid on click/tap
 *   - respects prefers-reduced-motion (static, no cycling)
 *
 * Self-contained: no dependencies, no network. Used by the Connect page and
 * the /guide page. Logos live in AGENTS so any one can be swapped for the
 * vendor's official asset without touching markup, CSS or JS.
 *
 * NOTE: Claude, Cursor-style cube, ChatGPT and Lovable use the marks already
 * shipped on the Connect page. Zed, Cline, Raycast, Windsurf, Gemini and
 * Antigravity are simplified hand-drawn marks -- replace them with each
 * brand's official SVG from its press kit for pixel-exact branding.
 */

const AGENTS = [
  {
    name: 'Claude', bg: '#ffffff', vb: '0 0 24 24',
    body: '<path fill="#D97757" d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/>',
  },
  {
    // Isometric cube, three tonal faces
    name: 'Cursor', bg: '#0b0b0d', vb: '0 0 24 24',
    body: '<path fill="#fff" d="M12 3.2 19.6 7.6 12 12 4.4 7.6Z"/>' +
          '<path fill="#fff" fill-opacity=".55" d="M4.4 7.6 12 12v8.8L4.4 16.4Z"/>' +
          '<path fill="#fff" fill-opacity=".8" d="M19.6 7.6v8.8L12 20.8V12Z"/>',
  },
  {
    name: 'ChatGPT', bg: '#ffffff', vb: '0 0 512 509.64',
    body: '<path fill="#0b0b0d" d="M412.037 221.764a90.834 90.834 0 004.648-28.67 90.79 90.79 0 00-12.443-45.87c-16.37-28.496-46.738-46.089-79.605-46.089-6.466 0-12.943.683-19.264 2.04a90.765 90.765 0 00-67.881-30.515h-.576c-.059.002-.149.002-.216.002-39.807 0-75.108 25.686-87.346 63.554-25.626 5.239-47.748 21.31-60.682 44.03a91.873 91.873 0 00-12.407 46.077 91.833 91.833 0 0023.694 61.553 90.802 90.802 0 00-4.649 28.67 90.804 90.804 0 0012.442 45.87c16.369 28.504 46.74 46.087 79.61 46.087a91.81 91.81 0 0019.253-2.04 90.783 90.783 0 0067.887 30.516h.576l.234-.001c39.829 0 75.119-25.686 87.357-63.588 25.626-5.242 47.748-21.312 60.682-44.033a91.718 91.718 0 0012.383-46.035 91.83 91.83 0 00-23.693-61.553l-.004-.005zM275.102 413.161h-.094a68.146 68.146 0 01-43.611-15.8 56.936 56.936 0 002.155-1.221l72.54-41.901a11.799 11.799 0 005.962-10.251V241.651l30.661 17.704c.326.163.55.479.596.84v84.693c-.042 37.653-30.554 68.198-68.21 68.273h.001zm-146.689-62.649a68.128 68.128 0 01-9.152-34.085c0-3.904.341-7.817 1.005-11.663.539.323 1.48.897 2.155 1.285l72.54 41.901a11.832 11.832 0 0011.918-.002l88.563-51.137v35.408a1.1 1.1 0 01-.438.94l-73.33 42.339a68.43 68.43 0 01-34.11 9.12 68.359 68.359 0 01-59.15-34.11l-.001.004zm-19.083-158.36a68.044 68.044 0 0135.538-29.934c0 .625-.036 1.731-.036 2.5v83.801l-.001.07a11.79 11.79 0 005.954 10.242l88.564 51.13-30.661 17.704a1.096 1.096 0 01-1.034.093l-73.337-42.375a68.36 68.36 0 01-34.095-59.143 68.412 68.412 0 019.112-34.085l-.004-.003zm251.907 58.621l-88.563-51.137 30.661-17.697a1.097 1.097 0 011.034-.094l73.337 42.339c21.109 12.195 34.132 34.746 34.132 59.132 0 28.604-17.849 54.199-44.686 64.078v-86.308c.004-.032.004-.065.004-.096 0-4.219-2.261-8.119-5.919-10.217zm30.518-45.93c-.539-.331-1.48-.898-2.155-1.286l-72.54-41.901a11.842 11.842 0 00-5.958-1.611c-2.092 0-4.15.558-5.957 1.611l-88.564 51.137v-35.408l-.001-.061a1.1 1.1 0 01.44-.88l73.33-42.303a68.301 68.301 0 0134.108-9.129c37.704 0 68.281 30.577 68.281 68.281a68.69 68.69 0 01-.984 11.545v.005zm-191.843 63.109l-30.668-17.704a1.09 1.09 0 01-.596-.84v-84.692c.016-37.685 30.593-68.236 68.281-68.236a68.332 68.332 0 0143.689 15.804 63.09 63.09 0 00-2.155 1.222l-72.54 41.9a11.794 11.794 0 00-5.961 10.248v.068l-.05 102.23zm16.655-35.91l39.445-22.782 39.444 22.767v45.55l-39.444 22.767-39.445-22.767v-45.535z"/>',
  },
  {
    name: 'Lovable', bg: '#ffffff', vb: '0 0 512 512',
    body: '<path fill="url(#dk-lov)" fill-rule="evenodd" clip-rule="evenodd" d="M151.083 0c83.413 0 151.061 67.819 151.061 151.467v57.6h50.283c83.413 0 151.082 67.797 151.082 151.466 0 83.691-67.626 151.467-151.082 151.467H0V151.467C0 67.84 67.627 0 151.083 0z"/>',
  },
  {
    name: 'Zed', bg: '#0f1523', vb: '0 0 24 24',
    body: '<path d="M6.4 7.2h11.2L6.4 16.8h11.2" fill="none" stroke="#fff" stroke-width="2.3" stroke-linejoin="miter" stroke-linecap="square"/>',
  },
  {
    name: 'Cline', bg: '#ffffff', vb: '0 0 24 24',
    body: '<rect x="5.2" y="8.6" width="13.6" height="10" rx="3.2" fill="#111827"/>' +
          '<circle cx="9.4" cy="13.6" r="1.55" fill="#fff"/><circle cx="14.6" cy="13.6" r="1.55" fill="#fff"/>' +
          '<path d="M12 8.6V5.9M3.3 13.2v2.6M20.7 13.2v2.6" stroke="#111827" stroke-width="1.8" stroke-linecap="round"/>' +
          '<circle cx="12" cy="4.7" r="1.5" fill="#111827"/>',
  },
  {
    name: 'Raycast', bg: '#ff6363', vb: '0 0 24 24',
    body: '<path d="M12 3.6 3.6 12 12 20.4 20.4 12Z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>' +
          '<path d="M12 8.4 8.4 12 12 15.6 15.6 12Z" fill="#fff"/>',
  },
  {
    name: 'Windsurf', bg: '#ffffff', vb: '0 0 24 24',
    body: '<path d="M3 8.2 7.7 16.6 12 9.6 16.3 16.6 21 8.2" fill="none" stroke="#0b0b0d" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>',
  },
  {
    name: 'Gemini', bg: '#ffffff', vb: '0 0 24 24',
    body: '<path fill="url(#dk-gem)" d="M12 1.8C12.7 7.6 16.4 11.3 22.2 12 16.4 12.7 12.7 16.4 12 22.2 11.3 16.4 7.6 12.7 1.8 12 7.6 11.3 11.3 7.6 12 1.8Z"/>',
  },
  {
    name: 'Antigravity', bg: '#ffffff', vb: '0 0 24 24',
    body: '<path fill="url(#dk-ag)" d="M2.8 20.4C2.8 8.8 7.6 3.2 12 3.2s9.2 5.6 9.2 17.2h-4.7c0-6.6-1.9-10.4-4.5-10.4S7.5 13.8 7.5 20.4Z"/>',
  },
];

const DEFS =
  '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>' +
  '<radialGradient id="dk-lov" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="rotate(92.545 118.724 174.844) scale(480.474 650.325)">' +
  '<stop offset=".25" stop-color="#FE7B02"/><stop offset=".433" stop-color="#FE4230"/><stop offset=".548" stop-color="#FE529A"/>' +
  '<stop offset=".654" stop-color="#DD67EE"/><stop offset=".95" stop-color="#4B73FF"/></radialGradient>' +
  '<linearGradient id="dk-gem" x1="2" y1="22" x2="22" y2="2" gradientUnits="userSpaceOnUse">' +
  '<stop stop-color="#4285F4"/><stop offset=".55" stop-color="#9B72CB"/><stop offset="1" stop-color="#D96570"/></linearGradient>' +
  '<linearGradient id="dk-ag" x1="3" y1="21" x2="21" y2="4" gradientUnits="userSpaceOnUse">' +
  '<stop stop-color="#4285F4"/><stop offset=".5" stop-color="#9B72CB"/><stop offset="1" stop-color="#EA4335"/></linearGradient>' +
  '</defs></svg>';

const CSS = `
.dock{--s:44px;--o:-15px;--dk-ring:var(--bg,#09090b);--dk-strong:#fff;padding:26px 0 10px;border-top:1px solid var(--line,rgba(255,255,255,.14))}
.dock-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px}
.dock-head small{font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:var(--dim,#64748b)}
.dock-head em{font-style:normal;font-size:.78rem;color:var(--mute,#94a3b8)}

.dock button.dock-btn{all:unset;box-sizing:border-box;position:relative;overflow:hidden;display:flex;align-items:center;gap:18px;cursor:pointer;
  padding:9px 20px 9px 9px;border:1px solid var(--line,rgba(255,255,255,.14));border-radius:999px;background:rgba(255,255,255,.03);color:var(--fg,#e2e8f0);
  max-width:100%;transition:border-color .3s,background .3s,box-shadow .3s;-webkit-tap-highlight-color:transparent}
.dock button.dock-btn:hover{background:rgba(16,185,129,.07);border-color:rgba(16,185,129,.45)}
.dock button.dock-btn:focus-visible{outline:2px solid var(--g,#10b981);outline-offset:3px}
.dock.open button.dock-btn{border-color:rgba(16,185,129,.55);box-shadow:0 0 0 4px rgba(16,185,129,.08)}
.dock-btn::after{content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(100deg,transparent 32%,rgba(255,255,255,.1) 50%,transparent 68%);transform:translateX(-130%)}
.dock.in .dock-btn::after{animation:dk-sheen 1.5s cubic-bezier(.4,0,.2,1) 1.1s 1 forwards}

.dock .avs{display:flex;flex:none}
.dock .av{position:relative;flex:none;width:var(--s);height:var(--s);margin-left:var(--o);border-radius:50%;background:var(--bg-c,#fff);display:grid;place-items:center;
  box-shadow:0 0 0 3px var(--dk-ring),inset 0 0 0 1px rgba(0,0,0,.1);z-index:var(--i);
  transition:margin .55s cubic-bezier(.2,.8,.2,1),transform .6s cubic-bezier(.34,1.5,.5,1),box-shadow .4s ease}
.dock .av:first-child{margin-left:0}
.dock .av svg{width:56%;height:56%;display:block}
.dock .av.on{transform:translateY(-4px) scale(1.1);z-index:40;
  box-shadow:0 0 0 3px var(--dk-ring),0 0 0 5px rgba(16,185,129,.75),0 10px 24px rgba(16,185,129,.35)}

.dock.ready:not(.in) .avs .av{opacity:0;transform:translateY(14px) scale(.5)}
.dock.in .avs .av{animation:dk-pop .75s cubic-bezier(.34,1.56,.64,1) backwards;animation-delay:calc(var(--i)*55ms + 120ms)}

@media(hover:hover) and (min-width:760px){
  .dock button.dock-btn:hover .av:not(:first-child){margin-left:6px}
}

.dock-name{display:flex;flex-direction:column;min-width:0;line-height:1.25}
.dock-name b{display:block;min-width:9.5ch;font-size:1rem;font-weight:650;color:var(--dk-strong);letter-spacing:-.005em}
.dock-name span{font-size:.78rem;color:var(--mute,#94a3b8)}
.dock-name b.swap{animation:dk-swap .5s cubic-bezier(.2,.8,.2,1)}
.dock .chev{flex:none;width:18px;height:18px;margin-left:auto;color:var(--g2,#6ee7b7);transition:transform .55s cubic-bezier(.2,.8,.2,1)}
.dock.open .chev{transform:rotate(180deg)}

.dock-panel{display:grid;grid-template-rows:0fr;transition:grid-template-rows .6s cubic-bezier(.2,.8,.2,1)}
.dock.open .dock-panel{grid-template-rows:1fr}
.dock-panel>div{overflow:hidden;min-height:0}
.dock-panel ul{list-style:none;margin:16px 0 0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.dock-panel li{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--line,rgba(255,255,255,.14));border-radius:14px;
  background:rgba(255,255,255,.02);font-weight:600;font-size:.94rem;color:var(--fg,#e2e8f0);opacity:0;transform:translateY(10px);
  transition:opacity .4s ease,transform .55s cubic-bezier(.2,.8,.2,1),border-color .25s,background .25s}
.dock.open .dock-panel li{opacity:1;transform:none;transition-delay:calc(var(--i)*40ms + 140ms)}
.dock.open .dock-panel li:hover{transition-delay:0s;transform:translateY(-2px);border-color:rgba(16,185,129,.55);background:rgba(16,185,129,.07)}
.dock-panel li .av{--s:30px;margin:0;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);z-index:auto;transition:transform .5s cubic-bezier(.34,1.5,.5,1)}
.dock-panel li:hover .av{transform:rotate(-8deg) scale(1.08)}
@media(min-width:760px){.dock-panel ul{grid-template-columns:repeat(5,minmax(0,1fr))}}

@media(max-width:559px){
  .dock{--s:38px;--o:-13px}
  .dock button.dock-btn{flex-wrap:wrap;gap:12px 10px;border-radius:26px;padding:9px 16px 12px 9px;width:100%}
  .dock .avs{order:1}
  .dock .chev{order:2}
  .dock-name{order:3;flex:1 0 100%;padding-left:7px}
}

@keyframes dk-pop{from{opacity:0;transform:translateY(14px) scale(.5)}}
@keyframes dk-swap{from{opacity:0;transform:translateY(8px)}}
@keyframes dk-sheen{to{transform:translateX(130%)}}

@media(prefers-reduced-motion:reduce){
  .dock *,.dock *::after{animation:none!important;transition-duration:.01ms!important;transition-delay:0s!important}
  .dock.ready:not(.in) .avs .av{opacity:1;transform:none}
}
`;

const JS = `
(function(){
  var d=document.querySelector('[data-dock]'); if(!d) return;
  var btn=d.querySelector('.dock-btn'), avs=[].slice.call(d.querySelectorAll('.avs .av'));
  var nm=d.querySelector('.dock-name b'), more=d.querySelector('.dock-name span');
  var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  var i=0, timer=0;
  function show(n){
    i=n;
    avs.forEach(function(a,k){ a.classList.toggle('on',k===n); });
    nm.textContent=avs[n].getAttribute('data-name');
    more.textContent='and '+(avs.length-1)+' more agents';
    nm.classList.remove('swap'); void nm.offsetWidth; nm.classList.add('swap');
  }
  function start(){ if(reduce||timer||document.hidden||d.classList.contains('open')) return; timer=setInterval(function(){ show((i+1)%avs.length); },2300); }
  function stop(){ clearInterval(timer); timer=0; }

  d.classList.add('ready');
  function enter(){ d.classList.add('in'); setTimeout(function(){ if(!reduce) show(0); start(); }, 900); }
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){ if(es[0].isIntersecting){ io.disconnect(); enter(); } },{threshold:.35});
    io.observe(d);
  } else { enter(); }

  btn.addEventListener('click',function(){
    var open=d.classList.toggle('open');
    btn.setAttribute('aria-expanded',open?'true':'false');
    if(open){ stop(); avs.forEach(function(a){ a.classList.remove('on'); }); } else { start(); }
  });
  avs.forEach(function(a,k){
    a.addEventListener('pointerenter',function(e){ if(e.pointerType==='mouse'&&!d.classList.contains('open')){ stop(); show(k); } });
  });
  btn.addEventListener('pointerleave',function(e){ if(e.pointerType==='mouse') start(); });
  document.addEventListener('visibilitychange',function(){ document.hidden?stop():start(); });
})();
`;

function avatarHtml(a, i, withIndex) {
  return '<span class="av" style="--i:' + i + ';--bg-c:' + a.bg + '" data-name="' + a.name + '">' +
    '<svg viewBox="' + a.vb + '" aria-hidden="true" focusable="false">' + a.body + '</svg></span>';
}

function buildHtml() {
  const n = AGENTS.length;
  const stack = AGENTS.map((a, i) => avatarHtml(a, i)).join('');
  const items = AGENTS.map((a, i) =>
    '<li style="--i:' + i + '">' + avatarHtml(a, i) + '<span>' + a.name + '</span></li>').join('');
  return '<div class="dock" data-dock role="group" aria-label="Works with ' + AGENTS.map((a) => a.name).join(', ') + '">' +
    DEFS +
    '<div class="dock-head"><small>Works with</small><em>' + n + ' agents</em></div>' +
    '<button type="button" class="dock-btn" aria-expanded="false" aria-controls="dock-panel">' +
      '<span class="avs" aria-hidden="true">' + stack + '</span>' +
      '<span class="dock-name"><b>' + AGENTS[0].name + '</b><span>and ' + (n - 1) + ' more agents</span></span>' +
      '<svg class="chev" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 7.5l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    '</button>' +
    '<div class="dock-panel" id="dock-panel"><div><ul>' + items + '</ul></div></div>' +
  '</div>';
}

module.exports = {
  AGENTS,
  AGENT_DOCK_CSS: CSS,
  AGENT_DOCK_HTML: buildHtml(),
  AGENT_DOCK_JS: JS,
};
