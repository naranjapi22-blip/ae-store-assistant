import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePromotionPrice,
  classifyPromotionConditions,
  EXCLUDED_PROMOTION_CATEGORIES,
  evaluatePromotionGroup,
  isExcludedPromotion,
  isInternalPromotion,
  isPromotionCurrent,
  isSpecialPromotion,
  parsePromotionAction
} from '../src/promotion/PromotionRules.js';

const current = {
  FECHAINICIAL: '2026-08-01',
  FECHAFINAL: '2026-08-31',
  HORAINICIAL: null,
  HORAFINAL: null,
  DIASSEMANA: '1111111'
};

test('acción tipo 4 se interpreta como porcentaje', () => {
  assert.deepEqual(parsePromotionAction({ TIPOACCION: 4, VALOR: '20|0||0|0' }), {
    type: 'percentage', percentage: 20, promotionalPrice: null
  });
  assert.equal(calculatePromotionPrice(parsePromotionAction({ TIPOACCION: 4, VALOR: '20|0||0|0' }), 36800), 29440);
});

test('acción tipo 17 se interpreta como precio fijo', () => {
  const action = parsePromotionAction({ TIPOACCION: 17, VALOR: '12000|0|0|0' });
  assert.deepEqual(action, { type: 'fixed_price', percentage: null, promotionalPrice: 12000 });
  assert.equal(calculatePromotionPrice(action, 36800), 12000);
});

test('acción desconocida no inventa un beneficio', () => {
  const action = parsePromotionAction({ TIPOACCION: 3, VALOR: '50|0|0' });
  assert.equal(action.type, 'unknown');
  assert.equal(calculatePromotionPrice(action, 36800), null);
});

test('promoción fuera de fecha o con días no demostrados queda excluida', () => {
  const now = new Date('2026-08-12T12:00:00Z');
  assert.equal(isPromotionCurrent({ ...current, FECHAFINAL: '2026-08-11' }, now), false);
  assert.equal(isPromotionCurrent({ ...current, DIASSEMANA: '0100000' }, now), false);
  assert.equal(isPromotionCurrent(current, now), true);
});

test('promociones especiales no se consideran automáticas', () => {
  assert.equal(isSpecialPromotion({ ...current, PEDIRCUPONSERIALIZADO: 'T' }), true);
  assert.equal(isSpecialPromotion({ ...current, DESCRIPCION: '20% EMPLEADOS GD CRI' }), true);
  assert.equal(isSpecialPromotion({ ...current, CLIENTEOBLIGATORIO: 'T' }), true);
  assert.equal(isSpecialPromotion({ ...current, NUMEROARTICULOS: 2 }), true);
  assert.equal(isSpecialPromotion({ ...current, DESCRIPCION: '20% OFF NEW ARRIVAL', CLIENTEOBLIGATORIO: 'F' }), false);
});

test('clasifica condiciones externas con labels informativos', () => {
  assert.deepEqual(classifyPromotionConditions({ PEDIRCUPONSERIALIZADO: 'T' }), {
    isConditional: true,
    conditionType: 'serialized_coupon',
    conditionTypes: ['serialized_coupon'],
    conditionLabel: 'Requiere cupón',
    requiresValidation: true
  });
  assert.deepEqual(classifyPromotionConditions({ IDGRUPOCLIENTES: 4 }), {
    isConditional: true,
    conditionType: 'customer',
    conditionTypes: ['customer'],
    conditionLabel: 'Depende del cliente',
    requiresValidation: true
  });
  assert.deepEqual(classifyPromotionConditions({ IMPORTEMINIMO: 10000 }), {
    isConditional: true,
    conditionType: 'minimum_purchase',
    conditionTypes: ['minimum_purchase'],
    conditionLabel: 'Requiere compra mínima',
    requiresValidation: true
  });
  assert.equal(classifyPromotionConditions({}).isConditional, false);
});

test('promociones internas de empleados y mercadeo se excluyen por descripción normalizada', () => {
  assert.equal(isInternalPromotion({ description: '20% EMPLEADOS GD CRI' }), true);
  assert.equal(isInternalPromotion({ description: '30% empleados gd países' }), true);
  assert.equal(isInternalPromotion({ description: '30% MERCADEO GD' }), true);
  assert.equal(isInternalPromotion({ description: '  20%   Empleado  ' }), true);
  assert.equal(isInternalPromotion({ description: '15% OFF MOUNT VIEW SCHOOL' }), true);
  assert.equal(isInternalPromotion({ description: '  15% off   mount view school  ' }), true);
  assert.equal(isInternalPromotion({ description: '20% OFF NEW ARRIVAL' }), false);
});

test('varias condiciones usan label general de validación en caja', () => {
  const result = classifyPromotionConditions({ PEDIRCUPONSERIALIZADO: 'T', IMPORTEMINIMO: 10000 });
  assert.equal(result.conditionType, 'multiple');
  assert.deepEqual(result.conditionTypes, ['serialized_coupon', 'minimum_purchase']);
  assert.equal(result.conditionLabel, 'Aplican condiciones - validar en caja');
  assert.equal(result.requiresValidation, true);
});

test('grupo 468 se evalúa con alternativas OR y condiciones AND actuales', () => {
  const conditions = [
    { GRUPOOR: 3, GRUPOAND: 0, INCLUIR: 'F', TABLA: 0, CAMPO: 'TEMPORADA', OPERADOR: '=', VALOR: 'SPRING 2025' },
    { GRUPOOR: 3, GRUPOAND: 0, INCLUIR: 'T', TABLA: 0, CAMPO: 'DPTO', OPERADOR: '=', VALOR: '2' },
    { GRUPOOR: 3, GRUPOAND: 1, INCLUIR: 'T', TABLA: 0, CAMPO: 'TEMPORADA', OPERADOR: 'LIKE1', VALOR: '2026' }
  ];
  assert.equal(evaluatePromotionGroup(conditions, { DPTO: 2, TEMPORADA: 'SPRING 2026' }), true);
  assert.equal(evaluatePromotionGroup(conditions, { DPTO: 1, TEMPORADA: 'SPRING 2026' }), false);
});

test('campo u operador no soportado produce falso negativo', () => {
  assert.equal(evaluatePromotionGroup([
    { GRUPOOR: 0, GRUPOAND: 0, INCLUIR: 'T', TABLA: 0, CAMPO: 'PRECIO', OPERADOR: '=', VALOR: '100' }
  ], { DPTO: 2 }), false);
  assert.equal(evaluatePromotionGroup([
    { GRUPOOR: 0, GRUPOAND: 0, INCLUIR: 'T', TABLA: 0, CAMPO: 'DPTO', OPERADOR: '>', VALOR: '1' }
  ], { DPTO: 2 }), false);
});

test('una alternativa solo con inclusiones F no hace elegible el grupo', () => {
  assert.equal(evaluatePromotionGroup([
    { GRUPOOR: 0, GRUPOAND: 0, INCLUIR: 'F', TABLA: 0, CAMPO: 'TEMPORADA', OPERADOR: '=', VALOR: 'SUMMER 2025' }
  ], { TEMPORADA: 'SPRING 2026' }), false);
});

test('una exclusión de temporada no hace elegible otro año', () => {
  assert.equal(evaluatePromotionGroup([
    { GRUPOOR: 0, GRUPOAND: 0, INCLUIR: 'F', TABLA: 0, CAMPO: 'TEMPORADA', OPERADOR: '=', VALOR: 'SUMMER 2025' }
  ], { TEMPORADA: 'SPRING 2024' }), false);
});

test('una inclusión T satisfecha puede hacer elegible la alternativa', () => {
  assert.equal(evaluatePromotionGroup([
    { GRUPOOR: 0, GRUPOAND: 0, INCLUIR: 'T', TABLA: 0, CAMPO: 'TEMPORADA', OPERADOR: 'LIKE1', VALOR: '2026' }
  ], { TEMPORADA: 'SPRING 2026' }), true);
});

test('una inclusión T satisfecha con una exclusión F que coincide queda vetada', () => {
  assert.equal(evaluatePromotionGroup([
    { GRUPOOR: 0, GRUPOAND: 0, INCLUIR: 'T', TABLA: 0, CAMPO: 'DPTO', OPERADOR: '=', VALOR: '3' },
    { GRUPOOR: 0, GRUPOAND: 0, INCLUIR: 'F', TABLA: 0, CAMPO: 'DPTO', OPERADOR: '=', VALOR: '3' }
  ], { DPTO: 3 }), false);
});

test('una alternativa contradictoria F/T del mismo campo produce falso negativo', () => {
  assert.equal(evaluatePromotionGroup([
    { GRUPOOR: 0, GRUPOAND: 0, INCLUIR: 'F', TABLA: 0, CAMPO: 'DPTO', OPERADOR: '=', VALOR: '3' },
    { GRUPOOR: 0, GRUPOAND: 0, INCLUIR: 'T', TABLA: 0, CAMPO: 'DPTO', OPERADOR: '=', VALOR: '3' }
  ], { DPTO: 3 }), false);
  assert.equal(evaluatePromotionGroup([
    { GRUPOOR: 0, GRUPOAND: 0, INCLUIR: 'F', TABLA: 0, CAMPO: 'DPTO', OPERADOR: '=', VALOR: '3' },
    { GRUPOOR: 0, GRUPOAND: 0, INCLUIR: 'T', TABLA: 0, CAMPO: 'DPTO', OPERADOR: '=', VALOR: '3' }
  ], { DPTO: 2 }), false);
});

test('exclusiones explícitas por ID clasifican categorías conocidas', () => {
  assert.deepEqual(EXCLUDED_PROMOTION_CATEGORIES, {
    2: 'internal',
    3: 'internal',
    4: 'internal',
    541: 'partner',
    620: 'clearance',
    621: 'clearance',
    622: 'clearance'
  });

  for (const id of [2, 3, 4, 541, 620, 621, 622]) {
    assert.equal(isExcludedPromotion({ id, description: 'Promoción comercial' }), true, `ID ${id}`);
  }
});

test('la promociÃ³n comercial 70% vigente no queda excluida por clearance', () => {
  assert.equal(isExcludedPromotion({ id: 361, description: '70% OFF 2025 EOSS CRI' }), false);
});

test('las promociones clearance conocidas siguen excluidas', () => {
  for (const id of [620, 621, 622]) {
    assert.equal(isExcludedPromotion({ id, description: 'PromociÃ³n comercial' }), true, `ID ${id}`);
  }
});

test('las promociones comerciales no se excluyen por palabras genéricas', () => {
  for (const id of [17, 98, 286, 536, 537, 574, 607]) {
    assert.equal(isExcludedPromotion({ id, description: '70% OFF EOSS 2025 COMERCIAL' }), false, `ID ${id}`);
  }
  assert.equal(isExcludedPromotion({ id: 999, description: '20% OFF EOSS 2025 COMERCIAL' }), false);
});
