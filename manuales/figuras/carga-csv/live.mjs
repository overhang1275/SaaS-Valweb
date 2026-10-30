import { EXAMPLES, initialState, transition, describe } from './model.mjs';

export function mount({ axis, orders, indices }) {
  const $ = selector => document.querySelector(selector);
  const stage = $('.stage'), svg = stage.querySelector('svg');
  const nodes = new Map([...svg.querySelectorAll('[data-piece]')].map(node => [node.dataset.piece, node]));
  const sheets = [...svg.querySelectorAll('[data-sheet]')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let state = initialState(), position = describe(state).position, target = position;
  let frame = 0, last = 0, elapsed = 0, visible = false, order = -1, touring = !reduced.matches;
  const tourActions = ['load', 'map', 'process', 'publish', 'reset'];
  let tourIndex = 0;

  function draw() {
    for (const node of sheets) node.setAttribute('transform', `translate(${axis[0] * position} ${axis[1] * position})`);
    const nextOrder = indices[Math.round(position) + 100];
    if (nextOrder !== order) {
      for (const id of orders[nextOrder]) svg.append(nodes.get(id));
      order = nextOrder;
    }
  }

  function render() {
    const view = describe(state);
    $('#status').setAttribute('aria-live', touring ? 'off' : 'polite');
    target = view.position;
    $('#state-title').textContent = view.title;
    $('#detail').textContent = view.detail;
    $('[data-readout]').textContent = view.title;
    $('#published-count').textContent = String(state.published);
    $('#base-state').textContent = state.published ? 'Base publicada' : 'Sin base publicada';
    $('#map').disabled = !view.canMap;
    $('#mapping').disabled = !view.canMap;
    $('#process').disabled = !view.canProcess;
    $('#publish').disabled = !view.canPublish;
    $('#load').textContent = state.stage === 'empty' ? '1. Cargar ejemplo' : 'Volver a cargar';
    for (const [i, step] of [...$('.steps').children].entries()) {
      if (i === view.step) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    }
    const body = $('#rows');
    body.replaceChildren(...EXAMPLES[state.example].map(row => {
      const tr = document.createElement('tr');
      for (const value of [row.folio, row.alfanum]) {
        const cell = document.createElement('td'); cell.textContent = value; tr.append(cell);
      }
      return tr;
    }));
    $('#tour').textContent = reduced.matches ? 'Reiniciar recorrido manual' : touring ? 'Pausar recorrido' : 'Reproducir recorrido';
    $('#tour').setAttribute('aria-pressed', String(touring));
    if (reduced.matches) { position = target; draw(); }
    run();
  }

  function tick(now) {
    frame = 0;
    if (!visible || document.hidden) return;
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 0;
    last = now;
    if (touring && !reduced.matches) {
      elapsed += dt;
      if (elapsed >= 5) {
        elapsed = 0;
        state = transition(state, tourActions[tourIndex++ % tourActions.length]);
        render();
      }
    }
    position = reduced.matches ? target : position + (target - position) * (1 - Math.exp(-dt / 0.3));
    if (Math.abs(target - position) < 0.01) position = target;
    draw();
    if (touring || position !== target) run();
  }
  function run() {
    if (!frame && visible && !document.hidden && (!reduced.matches || position !== target)) frame = requestAnimationFrame(tick);
  }
  function pause() { touring = false; elapsed = 0; render(); }
  function act(action) { touring = false; elapsed = 0; state = transition(state, action); render(); }

  $('#load').addEventListener('click', () => act('load'));
  $('#map').addEventListener('click', () => act($('#mapping').value === 'alfanum' ? 'map' : 'wrong-map'));
  $('#mapping').addEventListener('change', () => act($('#mapping').value === 'folio' ? 'wrong-map' : 'clear-map'));
  $('#process').addEventListener('click', () => act('process'));
  $('#publish').addEventListener('click', () => act('publish'));
  $('#example').addEventListener('change', event => {
    state = { ...initialState(event.target.value), published: state.published };
    $('#mapping').value = 'alfanum';
    pause();
  });
  $('#tour').addEventListener('click', () => {
    if (touring) { pause(); return; }
    state = { ...initialState(), published: state.published };
    $('#example').value = 'valid'; $('#mapping').value = 'alfanum';
    tourIndex = 0; elapsed = 0; touring = true;
    // Reduced motion still offers the walkthrough, one explicit step at a time.
    if (reduced.matches) { touring = false; state = transition(state, 'load'); }
    render();
  });
  $('.controls').addEventListener('focusin', () => { if (touring) pause(); });
  $('.controls').addEventListener('pointerdown', () => { if (touring) pause(); });

  new IntersectionObserver(entries => {
    visible = entries.at(-1).isIntersecting;
    if (!visible) { cancelAnimationFrame(frame); frame = 0; }
    last = 0;
    run();
  }).observe(stage);
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(frame); frame = 0; last = 0; run();
  });
  reduced.addEventListener('change', () => {
    cancelAnimationFrame(frame); frame = 0; last = 0;
    if (reduced.matches) touring = false;
    render();
  });
  $('#interactive').hidden = false;
  render(); draw();
}
