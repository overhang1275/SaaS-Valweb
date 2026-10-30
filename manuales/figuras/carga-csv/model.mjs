export const EXAMPLES = {
  valid: [
    { folio: '0001', alfanum: 'ABC101' },
    { folio: '0002', alfanum: 'ABC102' },
    { folio: '0003', alfanum: 'ABC103' },
  ],
  errors: [
    { folio: '0001', alfanum: 'ABC101' },
    { folio: '0002', alfanum: 'ABC102' },
    { folio: '0003', alfanum: 'abc102' },
  ],
};

export function initialState(example = 'valid') {
  return { example, stage: 'empty', mapped: false, wrongMapping: false, published: 0, active: false };
}

export function transition(state, action) {
  if (action === 'load') return { ...state, stage: 'mapping', mapped: false, wrongMapping: false };
  if (action === 'reset') return { ...initialState(state.example), published: state.published };
  if (state.stage === 'mapping' && action === 'clear-map') return { ...state, mapped: false, wrongMapping: false };
  if (state.stage === 'mapping' && (action === 'map' || action === 'wrong-map')) {
    return { ...state, mapped: action === 'map', wrongMapping: action === 'wrong-map' };
  }
  if (state.stage === 'mapping' && state.mapped && action === 'process') {
    const rows = EXAMPLES[state.example];
    const codes = rows.map(row => row.alfanum.toUpperCase());
    return { ...state, stage: new Set(codes).size === codes.length ? 'review' : 'errors' };
  }
  if (state.stage === 'review' && action === 'publish') {
    return { ...state, stage: 'published', published: EXAMPLES[state.example].length, active: false };
  }
  return state;
}

export function describe(state) {
  const descriptions = {
    empty: ['Antes de cargar', 'Elige un CSV de ejemplo. Recibir el archivo no cambia la base publicada.', -100, 0],
    mapping: state.wrongMapping
      ? ['Corrige el mapeo', 'El folio conserva sus ceros iniciales. La columna de búsqueda debe ser alfanum, no folio.', -45, 1]
      : [state.mapped ? 'Mapeo listo' : 'Selecciona el mapeo', state.mapped
        ? 'folio → folio; alfanum → alfanum. Ya puedes pedir al worker que procese el ejemplo.'
        : 'Asigna folio y alfanum. El worker necesita este mapeo para validar los registros.', -45, 1],
    errors: ['Corrige el CSV', 'ABC102 y abc102 son el mismo alfanumérico normalizado. Corrige el archivo y vuelve a cargarlo; este lote no se puede publicar.', 0, 2],
    review: ['Revisa la base candidata', 'Los 3 registros del ejemplo son válidos. La base candidata está lista, pero aún no sustituye la base publicada. Revisa y pulsa Publicar.', 0, 2],
    published: ['Base publicada', 'La base candidata ya es la base publicada. El enlace sigue pendiente de activación: comprueba cuenta activa, registros e imágenes requeridas antes de activarlo en el panel.', 100, 3],
  };
  const [title, detail, position, step] = descriptions[state.stage];
  return { title, detail, position, step, canMap: state.stage === 'mapping',
    canProcess: state.stage === 'mapping' && state.mapped, canPublish: state.stage === 'review' };
}
