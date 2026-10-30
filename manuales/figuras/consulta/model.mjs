const RECORD = { folio: '0001', alfanum: 'ABC101', tipo: 'Constancia' };
const LABELS = { folio: 'Folio', alfanum: 'Alfanumérico', tipo: 'Tipo de documento' };
const FLAGS = new Set(['active', 'published', 'protected', 'access', 'knownCode', 'imageAvailable', 'showImage']);

export function publicInitial() {
  return { active: true, published: true, protected: false, access: false, knownCode: true,
    imageAvailable: true, showImage: true, selectedFields: ['folio', 'alfanum', 'tipo'],
    delivery: null, found: null, message: 'La ficha espera una consulta.' };
}

export function publicTransition(state, action) {
  if (action.type === 'reset') return publicInitial();
  if (action.type === 'set') {
    if (FLAGS.has(action.key) && typeof action.value === 'boolean') return { ...state, [action.key]: action.value };
    if (action.key === 'selectedFields' && Array.isArray(action.value)) {
      return { ...state, selectedFields: [...new Set(action.value.filter(key => Object.hasOwn(RECORD, key)))] };
    }
    return state;
  }
  if (action.type === 'revoke') return { ...state, active: false, message: state.delivery
    ? 'Enlace revocado. La ficha ya recibida permanece; se bloquean nuevas consultas.'
    : 'Enlace revocado. No se entregan nuevas fichas.' };
  if (action.type !== 'consult') return state;
  if (!state.active || !state.published) return { ...state, found: null,
    message: !state.active ? 'Enlace inactivo: nueva entrega bloqueada.' : 'Base sin publicar: nueva entrega bloqueada.' };
  if (state.protected && !state.access) return { ...state, found: null,
    message: 'Acceso vigente requerido. Conocer el código no concede acceso.' };
  if (!state.knownCode) return { ...state, found: false, message: 'Código no encontrado. No hay nueva entrega.' };
  const fields = state.selectedFields.map(key => ({ label: LABELS[key], value: RECORD[key] }));
  const image = state.showImage && state.imageAvailable;
  return { ...state, found: true, delivery: { fields, image, imageUnavailable: state.showImage && !image },
    message: `Registro encontrado: ${fields.length} campos entregados${state.showImage && !image ? '; imagen no disponible' : ''}.` };
}

export function publicView(state) {
  return { position: state.delivery ? 100 : -100, readout: state.message,
    fields: state.delivery?.fields ?? [], image: state.delivery?.image ?? false,
    imageUnavailable: state.delivery?.imageUnavailable ?? false,
    found: state.found, delivered: Boolean(state.delivery),
    canConsult: state.active && state.published && (!state.protected || state.access) };
}
