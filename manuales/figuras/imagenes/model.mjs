export function imageInitial() {
  return { scenario: 'new', storage: 'LOCAL', available: true, phase: 'original', cleanupPending: false };
}

export function imageTransition(state, action) {
  switch (action.type) {
    case 'scenario':
      return ['new', 'replacement', 'error', 'cleanup-failure'].includes(action.value)
        ? { ...state, scenario: action.value, phase: 'original', cleanupPending: false } : state;
    case 'storage':
      return ['LOCAL', 'NFS'].includes(action.value)
        ? { ...state, storage: action.value, phase: 'original', cleanupPending: false } : state;
    case 'availability':
      return typeof action.value === 'boolean'
        ? { ...state, available: action.value, phase: 'original', cleanupPending: false } : state;
    case 'process':
      if (!['original', 'blocked', 'failed'].includes(state.phase)) return state;
      if (!state.available) return { ...state, phase: 'blocked' };
      if (state.scenario === 'error') return { ...state, phase: 'failed' };
      if (state.scenario === 'replacement') return { ...state, phase: 'review' };
      return { ...state, phase: 'published', cleanupPending: state.scenario === 'cleanup-failure' };
    case 'confirm':
      if (state.phase !== 'review') return state;
      if (!state.available) return { ...state, phase: 'blocked' };
      return { ...state, phase: 'published', cleanupPending: state.scenario === 'cleanup-failure' };
    case 'cleanup':
      return state.phase === 'published' && state.available
        ? { ...state, cleanupPending: false } : state;
    case 'reset':
      return imageInitial();
    default:
      return state;
  }
}

export function imageView(state) {
  const descriptions = {
    original: ['Original en espera', 'FTP solo entrega los archivos. Pulsa Procesar para iniciar el lote.'],
    blocked: ['Destino no disponible', `${state.storage === 'NFS' ? 'NFS' : 'Local'} no está disponible. El destino seleccionado se conserva.`],
    failed: ['Lote con errores', 'El lote no se publicó y sus originales se conservan. Corrige los archivos antes de reintentar.'],
    review: ['Reemplazo en revisión', 'La copia existente se conserva hasta confirmar la publicación del reemplazo.'],
    published: ['Imágenes publicadas', state.cleanupPending ? 'La publicación terminó. Los originales siguen pendientes de limpieza.' : 'Los originales se retiraron después de publicar.'],
  };
  const [title, detail] = descriptions[state.phase];
  return {
    position: state.phase === 'published' ? 100 : ['review', 'failed'].includes(state.phase) ? 0 : -100,
    title, detail, storage: state.storage,
    canProcess: ['original', 'blocked', 'failed'].includes(state.phase),
    canConfirm: state.phase === 'review',
    canCleanup: state.phase === 'published' && state.cleanupPending && state.available,
    published: state.phase === 'published',
    originalPresent: state.phase !== 'published' || state.cleanupPending,
  };
}
