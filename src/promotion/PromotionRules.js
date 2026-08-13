const text = value => value == null ? '' : String(value).trim();

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
    let alternativePasses = true;
    for (const rows of andGroups.values()) {
      const andPasses = rows.every(condition => {
        const comparison = compareCondition(condition, context);
        if (!comparison.supported) return false;
        return text(condition.INCLUIR).toUpperCase() === 'F'
          ? !comparison.matches
          : text(condition.INCLUIR).toUpperCase() === 'T' && comparison.matches;
      });
      if (!andPasses) {
        alternativePasses = false;
        break;
      }
    }
    if (alternativePasses) return true;
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

export const isSpecialPromotion = promotion => {
  const description = text(promotion.DESCRIPCION ?? promotion.description);
  if (/EMPLEADOS|MERCADEO/i.test(description)) return true;
  if (flagTrue(promotion.CLIENTEOBLIGATORIO)) return true;
  if (numberValue(promotion.IDGRUPOCLIENTES) > 0) return true;
  if (text(promotion.EANCUPON) || flagTrue(promotion.CUPONSERIALIZADO)) return true;
  if (flagTrue(promotion.VALIDACIONEXTERNA) || flagTrue(promotion.MANUAL)) return true;
  if (flagTrue(promotion.PEDIRCUPONSERIALIZADO)) return true;
  if (flagTrue(promotion.APLICARTIPOTERMINAL) || flagTrue(promotion.APLICARDELIVERY)) return true;
  if (flagTrue(promotion.DTOSASFORMAPAGO) || text(promotion.CODFORMAPAGODTOS)) return true;
  if (nonZero(promotion.CUMPLEANYOS)) return true;
  if (nonZero(promotion.APLICARNVECES)
    || nonZero(promotion.APLICARNVECESPORCLIENTE)
    || nonZero(promotion.APLICARNVECESPORCLIENTECADAPERIODO)
    || nonZero(promotion.APLICARNVECESPORCLIENTESINCONEX)
    || nonZero(promotion.CUMPLEANYOSXDIASANTES)
    || nonZero(promotion.CUMPLEANYOSXDIASDESPUES)) return true;
  if (numberValue(promotion.NUMEROARTICULOS) > 1 || numberValue(promotion.IMPORTEMINIMO) > 0) return true;
  if (nonZero(promotion.TIPOAPLICACION) || nonZero(promotion.CONDICIONAPLICACION) || nonZero(promotion.MOMENTOAPLICACION)) return true;
  return false;
};

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
