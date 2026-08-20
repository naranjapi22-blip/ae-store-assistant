const text = value => value == null ? '' : String(value).trim();

export const normalizePromotionDescription = value => text(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/\s+/g, ' ');

export const EXCLUDED_PROMOTION_CATEGORIES = Object.freeze({
  2: 'internal',
  3: 'internal',
  4: 'internal',
  541: 'partner',
  620: 'clearance',
  621: 'clearance',
  622: 'clearance'
});

const promotionId = promotion => {
  const rawId = promotion?.IDPROMOCION ?? promotion?.id;
  if (rawId == null || text(rawId) === '') return null;
  const id = Number(rawId);
  return Number.isInteger(id) ? id : null;
};

export const isExcludedPromotion = promotion => {
  const id = promotionId(promotion);
  if (id != null && Object.hasOwn(EXCLUDED_PROMOTION_CATEGORIES, id)) return true;

  const description = normalizePromotionDescription(promotion?.DESCRIPCION ?? promotion?.description);
  return /\b(?:EMPLEADO|EMPLEADOS|MERCADEO)\b/.test(description)
    || description.includes('MOUNT VIEW SCHOOL');
};

// Mantener este nombre por compatibilidad con consumidores existentes.
export const isInternalPromotion = isExcludedPromotion;

const flagTrue = value => ['1', 'true', 'yes', 'si', 's', 't'].includes(text(value).toLowerCase());
const numberValue = value => {
  if (value == null || text(value) === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const nonZero = value => {
  const number = numberValue(value);
  return number != null ? number !== 0 : text(value) !== '';
};

export const SUPPORTED_PROMOTION_FIELDS = Object.freeze({
  0: Object.freeze(['DPTO', 'SECCION', 'FAMILIA', 'SUBFAMILIA', 'TEMPORADA', 'REFPROVEEDOR']),
  1: Object.freeze(['REFERENCIA_STYLO', 'PROMO01', 'PROMO05', 'PROMO18', 'MAYOR_CW'])
});

const fieldValue = (condition, context) => {
  const table = text(condition.TABLA);
  const field = text(condition.CAMPO).toUpperCase();
  const supported = SUPPORTED_PROMOTION_FIELDS[table]?.includes(field) ?? false;
  if (!supported) return { supported: false, value: null };
  return { supported: true, value: context[field] };
};

const compareCondition = (condition, context) => {
  const { supported, value } = fieldValue(condition, context);
  if (!supported || value == null || text(value) === '') return { supported: false, matches: false };

  const operator = text(condition.OPERADOR).toUpperCase();
  const actual = text(value).toUpperCase();
  const expected = text(condition.VALOR).toUpperCase();
  if (!expected || !['=', 'LIKE1'].includes(operator)) return { supported: false, matches: false };
  if (operator === '=') return { supported: true, matches: actual === expected };
  return { supported: true, matches: actual.includes(expected) };
};

const groupsByAlternative = conditions => {
  const alternatives = new Map();
  for (const condition of conditions) {
    const alternative = text(condition.GRUPOOR || 0);
    const andKey = text(condition.GRUPOAND || 0);
    if (!alternatives.has(alternative)) alternatives.set(alternative, new Map());
    const andGroups = alternatives.get(alternative);
    if (!andGroups.has(andKey)) andGroups.set(andKey, []);
    andGroups.get(andKey).push(condition);
  }
  return alternatives;
};

export const evaluatePromotionGroup = (conditions, context) => {
  if (!Array.isArray(conditions) || conditions.length === 0) return false;
  for (const andGroups of groupsByAlternative(conditions).values()) {
    const alternativeRows = [...andGroups.values()].flat();
    const inclusionRows = alternativeRows.filter(condition => text(condition.INCLUIR).toUpperCase() === 'T');
    if (!inclusionRows.length) continue;

    const contradictory = alternativeRows.some((condition, index) => alternativeRows.some((other, otherIndex) => {
      if (index >= otherIndex) return false;
      const sameRule = [condition.TABLA, condition.CAMPO, condition.OPERADOR, condition.VALOR]
        .map(value => text(value).toUpperCase())
        .every((value, ruleIndex) => value === [other.TABLA, other.CAMPO, other.OPERADOR, other.VALOR]
          .map(otherValue => text(otherValue).toUpperCase())[ruleIndex]);
      return sameRule && text(condition.INCLUIR).toUpperCase() !== text(other.INCLUIR).toUpperCase();
    }));
    if (contradictory) continue;

    let alternativePasses = true;
    let inclusionSatisfied = false;
    for (const rows of andGroups.values()) {
      const andPasses = rows.every(condition => {
        const comparison = compareCondition(condition, context);
        if (!comparison.supported) return false;
        const includeRule = text(condition.INCLUIR).toUpperCase();
        if (includeRule === 'T') {
          if (comparison.matches) inclusionSatisfied = true;
          return comparison.matches;
        }
        if (includeRule === 'F') return !comparison.matches;
        return false;
      });
      if (!andPasses) {
        alternativePasses = false;
        break;
      }
    }
    if (alternativePasses && inclusionSatisfied) return true;
  }
  return false;
};

const dateKey = value => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

const minutesOf = value => {
  if (value == null || text(value) === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getUTCHours() * 60 + date.getUTCMinutes();
};

export const isPromotionCurrent = (promotion, now = new Date()) => {
  const currentDate = dateKey(now);
  const startDate = dateKey(promotion.FECHAINICIAL ?? promotion.startDate);
  const endDate = dateKey(promotion.FECHAFINAL ?? promotion.endDate);
  if (currentDate == null) return false;
  if (startDate != null && currentDate < startDate) return false;
  if (endDate != null && currentDate > endDate) return false;

  const days = text(promotion.DIASSEMANA);
  // La codificación de días no quedó demostrada en la base. Solo aceptamos
  // vacío/todos los días; cualquier patrón distinto es un falso negativo seguro.
  if (days && !/^1{7}$/.test(days)) return false;

  const currentMinutes = minutesOf(now);
  const startMinutes = minutesOf(promotion.HORAINICIAL);
  const endMinutes = minutesOf(promotion.HORAFINAL);
  if (startMinutes == null || endMinutes == null) return true;
  if (startMinutes > endMinutes) return false;
  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
};

export const classifyPromotionConditions = promotion => {
  const conditions = [];
  const add = (type, label) => {
    if (!conditions.some(condition => condition.type === type)) conditions.push({ type, label });
  };
  const description = text(promotion.DESCRIPCION ?? promotion.description);
  if (/EMPLEADOS/i.test(description)) add('customer', 'Depende del cliente');
  if (/MERCADEO/i.test(description)) add('external', 'Validar condiciones en caja');
  if (flagTrue(promotion.CLIENTEOBLIGATORIO) || numberValue(promotion.IDGRUPOCLIENTES) > 0) add('customer', 'Depende del cliente');
  if (text(promotion.EANCUPON) || flagTrue(promotion.CUPONSERIALIZADO) || flagTrue(promotion.PEDIRCUPONSERIALIZADO)) {
    add('serialized_coupon', 'Requiere cupón');
  }
  if (flagTrue(promotion.VALIDACIONEXTERNA)) add('external', 'Validar condiciones en caja');
  if (flagTrue(promotion.MANUAL)) add('manual', 'Requiere validación en caja');
  if (flagTrue(promotion.APLICARTIPOTERMINAL) || flagTrue(promotion.APLICARDELIVERY)) add('external', 'Validar condiciones en caja');
  if (flagTrue(promotion.DTOSASFORMAPAGO) || text(promotion.CODFORMAPAGODTOS)) add('payment', 'Depende de la forma de pago');
  if (nonZero(promotion.CUMPLEANYOS)) add('customer', 'Depende del cliente');
  if (nonZero(promotion.APLICARNVECES)
    || nonZero(promotion.APLICARNVECESPORCLIENTE)
    || nonZero(promotion.APLICARNVECESPORCLIENTECADAPERIODO)
    || nonZero(promotion.APLICARNVECESPORCLIENTESINCONEX)
    || nonZero(promotion.CUMPLEANYOSXDIASANTES)
    || nonZero(promotion.CUMPLEANYOSXDIASDESPUES)) add('customer', 'Depende del cliente');
  if (numberValue(promotion.NUMEROARTICULOS) > 1) add('multiple_items', 'Requiere múltiples artículos');
  if (numberValue(promotion.IMPORTEMINIMO) > 0) add('minimum_purchase', 'Requiere compra mínima');
  if (nonZero(promotion.TIPOAPLICACION) || nonZero(promotion.CONDICIONAPLICACION) || nonZero(promotion.MOMENTOAPLICACION)) {
    add('external', 'Validar condiciones en caja');
  }
  if (!conditions.length) {
    return { isConditional: false, conditionType: null, conditionTypes: [], conditionLabel: null, requiresValidation: false };
  }
  const conditionTypes = conditions.map(condition => condition.type);
  const conditionLabel = conditions.length === 1
    ? conditions[0].label
    : 'Aplican condiciones - validar en caja';
  return {
    isConditional: true,
    conditionType: conditions.length === 1 ? conditions[0].type : 'multiple',
    conditionTypes,
    conditionLabel,
    requiresValidation: true
  };
};

export const isSpecialPromotion = promotion => classifyPromotionConditions(promotion).isConditional;

export const parsePromotionAction = action => {
  const segments = text(action?.VALOR ?? action?.actionValue).split('|');
  const value = numberValue(segments[0]);
  if (value == null) return { type: 'unknown', percentage: null, promotionalPrice: null };
  const actionType = Number(action?.TIPOACCION ?? action?.actionType);
  if (actionType === 4 && value >= 0 && value <= 100) {
    return { type: 'percentage', percentage: value, promotionalPrice: null };
  }
  if (actionType === 17 && value >= 0) {
    return { type: 'fixed_price', percentage: null, promotionalPrice: value };
  }
  return { type: 'unknown', percentage: null, promotionalPrice: null };
};

export const roundCrc = value => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
};

export const calculatePromotionPrice = (action, basePrice) => {
  if (action.type === 'fixed_price') return roundCrc(action.promotionalPrice);
  if (action.type === 'percentage' && numberValue(basePrice) != null) {
    return roundCrc(Number(basePrice) * (1 - action.percentage / 100));
  }
  return null;
};
