import sql from 'mssql';
import { ProductRepository } from './ProductRepository.js';
import {
  calculatePromotionPrice,
  classifyPromotionConditions,
  evaluatePromotionGroup,
  isInternalPromotion,
  isPromotionCurrent,
  parsePromotionAction
} from '../promotion/PromotionRules.js';

const clean = value => value == null ? '' : String(value).trim();
const numberOrZero = value => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};
const numberOrNull = value => {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const maxLimit = (value, fallback) => Math.min(Math.max(Number(value) || fallback, 1), fallback);

const STOCK_JOIN = `
LEFT JOIN dbo.STOCKS ST
    ON ST.CODARTICULO = A.CODARTICULO
   AND ST.TALLA = L.TALLA
   AND ST.COLOR = L.COLOR
   AND ST.CODALMACEN = @warehouse`;

const PRICE_APPLY = `
OUTER APPLY (
    SELECT P.PNETO
    FROM dbo.PRECIOSVENTA P
    WHERE P.IDTARIFAV = @tariff
      AND P.CODARTICULO = A.CODARTICULO
      AND P.TALLA = L.TALLA
      AND P.COLOR = L.COLOR
      AND ISNULL(P.DESCATALOGADO, 0) = 0
      AND (
          (@priceFormat IS NOT NULL AND P.CODFORMATO = @priceFormat)
          OR (
              @priceFormat IS NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM dbo.PRECIOSVENTA P2
                  WHERE P2.IDTARIFAV = P.IDTARIFAV
                    AND P2.CODARTICULO = P.CODARTICULO
                    AND P2.TALLA = P.TALLA
                    AND P2.COLOR = P.COLOR
                    AND ISNULL(P2.DESCATALOGADO, 0) = 0
                    AND P2.CODFORMATO <> P.CODFORMATO
              )
          )
      )
) PV`;

const ENRICHMENT_JOINS = `${STOCK_JOIN}${PRICE_APPLY}`;

const HIERARCHY_JOINS = `
LEFT JOIN dbo.DEPARTAMENTO D
    ON D.NUMDPTO = A.DPTO
LEFT JOIN dbo.SECCIONES S
    ON S.NUMDPTO = A.DPTO
   AND S.NUMSECCION = A.SECCION
LEFT JOIN dbo.FAMILIAS F
    ON F.NUMDPTO = A.DPTO
   AND F.NUMSECCION = A.SECCION
   AND F.NUMFAMILIA = A.FAMILIA
LEFT JOIN dbo.SUBFAMILIAS SF
    ON SF.NUMDPTO = A.DPTO
   AND SF.NUMSECCION = A.SECCION
   AND SF.NUMFAMILIA = A.FAMILIA
   AND SF.NUMSUBFAMILIA = A.SUBFAMILIA`;

const VARIANT_COLUMNS = `
    A.CODARTICULO AS articleCode,
    A.REFPROVEEDOR AS supplierRef,
    A.DPTO AS departmentCode,
    A.SECCION AS sectionCode,
    A.FAMILIA AS familyCode,
    A.SUBFAMILIA AS subfamilyCode,
    A.DESCRIPCION AS description,
    A.DESCRIPADIC AS additionalDescription,
    A.TEMPORADA AS season,
    CL.REFERENCIA_STYLO AS ref,
    CL.STYLE AS style,
    CL.COLORDESC AS colorDescription,
    CL.COLOR_ESP AS colorSpanish,
    CL.PROMO01 AS promo01,
    CL.PROMO05 AS promo05,
    CL.PROMO18 AS promo18,
    CL.MAYOR_CW AS mayorCw,
    L.TALLA AS size,
    L.COLOR AS color,
    L.CODBARRAS,
    L.CODBARRAS2,
    L.CODBARRAS3,
    COALESCE(ST.STOCK, 0) AS stock,
    PV.PNETO AS price,
    LTRIM(RTRIM(D.DESCRIPCION)) AS department,
    LTRIM(RTRIM(S.DESCRIPCION)) AS section,
    LTRIM(RTRIM(F.DESCRIPCION)) AS family,
    LTRIM(RTRIM(SF.DESCRIPCION)) AS subfamily`;

const VARIANT_FROM = `
FROM dbo.ARTICULOS A
INNER JOIN dbo.ARTICULOSCAMPOSLIBRES CL
    ON CL.CODARTICULO = A.CODARTICULO
INNER JOIN dbo.ARTICULOSLIN L
    ON L.CODARTICULO = A.CODARTICULO${ENRICHMENT_JOINS}${HIERARCHY_JOINS}`;

const variantQuery = where => `
SELECT ${VARIANT_COLUMNS}
${VARIANT_FROM}
WHERE ${where}
ORDER BY A.CODARTICULO, L.TALLA, L.COLOR`;

const MATCHED_REFERENCES_CTE = where => `
WITH MatchedReferences AS (
    SELECT DISTINCT CL.REFERENCIA_STYLO AS ref
    FROM dbo.ARTICULOS A
    INNER JOIN dbo.ARTICULOSCAMPOSLIBRES CL
        ON CL.CODARTICULO = A.CODARTICULO
    INNER JOIN dbo.ARTICULOSLIN L
        ON L.CODARTICULO = A.CODARTICULO
    WHERE ${where}
      AND CL.REFERENCIA_STYLO IS NOT NULL
), VariantRows AS (
    SELECT ${VARIANT_COLUMNS}
    ${VARIANT_FROM}
    INNER JOIN MatchedReferences MR
        ON MR.ref = CL.REFERENCIA_STYLO
)
`;

const summarySelect = `
SELECT TOP (@limit)
    ref,
    MAX(style) AS style,
    MAX(description) AS description,
    MAX(additionalDescription) AS additionalDescription,
    MAX(color) AS color,
    MAX(colorDescription) AS colorDescription,
    MAX(colorSpanish) AS colorSpanish,
    MAX(price) AS price,
    MAX(season) AS season,
    SUM(stock) AS stockTotal,
    COUNT(DISTINCT CASE WHEN stock > 0 THEN size END) AS sizesWithStock
FROM VariantRows
GROUP BY ref
HAVING SUM(stock) > 0
ORDER BY SUM(stock) DESC, ref`;

const SUMMARY_COLUMNS = `
    CL.REFERENCIA_STYLO AS ref,
    MAX(CL.STYLE) AS style,
    MAX(A.DESCRIPCION) AS description,
    MAX(A.DESCRIPADIC) AS additionalDescription,
    MAX(CL.COLORDESC) AS colorDescription,
    MAX(CL.COLOR_ESP) AS colorSpanish,
    MAX(L.COLOR) AS color,
    MAX(PV.PNETO) AS price,
    MAX(A.TEMPORADA) AS season,
    SUM(COALESCE(ST.STOCK, 0)) AS stockTotal,
    COUNT(DISTINCT CASE WHEN COALESCE(ST.STOCK, 0) > 0 THEN L.TALLA END) AS sizesWithStock`;

const SUMMARY_FROM = `
FROM dbo.ARTICULOS A
INNER JOIN dbo.ARTICULOSCAMPOSLIBRES CL
    ON CL.CODARTICULO = A.CODARTICULO
INNER JOIN dbo.ARTICULOSLIN L
    ON L.CODARTICULO = A.CODARTICULO${ENRICHMENT_JOINS}`;

const CATEGORY_FROM = `
FROM dbo.ARTICULOS A
INNER JOIN dbo.ARTICULOSCAMPOSLIBRES CL
    ON CL.CODARTICULO = A.CODARTICULO
INNER JOIN dbo.ARTICULOSLIN L
    ON L.CODARTICULO = A.CODARTICULO${STOCK_JOIN}`;

const catalogSummaryQuery = `
SELECT TOP (@limit) ${SUMMARY_COLUMNS}
${SUMMARY_FROM}
${HIERARCHY_JOINS}
WHERE LOWER(LTRIM(RTRIM(D.DESCRIPCION))) = LOWER(@department)
  AND LOWER(LTRIM(RTRIM(S.DESCRIPCION))) = LOWER(@section)
  AND LOWER(LTRIM(RTRIM(F.DESCRIPCION))) = LOWER(@family)
  AND CL.REFERENCIA_STYLO IS NOT NULL
GROUP BY CL.REFERENCIA_STYLO
HAVING SUM(COALESCE(ST.STOCK, 0)) > 0
ORDER BY SUM(COALESCE(ST.STOCK, 0)) DESC, CL.REFERENCIA_STYLO`;

const similarQuery = `
SELECT TOP (@limit) ${SUMMARY_COLUMNS}
${SUMMARY_FROM}
${HIERARCHY_JOINS}
WHERE LOWER(LTRIM(RTRIM(D.DESCRIPCION))) = LOWER(@department)
  AND LOWER(LTRIM(RTRIM(S.DESCRIPCION))) = LOWER(@section)
  AND LOWER(LTRIM(RTRIM(F.DESCRIPCION))) = LOWER(@family)
  AND CL.REFERENCIA_STYLO IS NOT NULL
  AND CL.REFERENCIA_STYLO <> @excludeReference
  AND (
      CHARINDEX('-', CL.REFERENCIA_STYLO) = 0
      OR CHARINDEX('-', @excludeReference) = 0
      OR LEFT(CL.REFERENCIA_STYLO, LEN(CL.REFERENCIA_STYLO) - CHARINDEX('-', REVERSE(CL.REFERENCIA_STYLO)))
         <> LEFT(@excludeReference, LEN(@excludeReference) - CHARINDEX('-', REVERSE(@excludeReference)))
  )
GROUP BY CL.REFERENCIA_STYLO
HAVING SUM(COALESCE(ST.STOCK, 0)) > 0
ORDER BY SUM(COALESCE(ST.STOCK, 0)) DESC, CL.REFERENCIA_STYLO`;

const categoryQuery = kind => {
  const select = kind === 'department'
    ? 'LTRIM(RTRIM(D.DESCRIPCION)) AS value'
    : kind === 'section'
      ? 'LTRIM(RTRIM(S.DESCRIPCION)) AS value'
      : 'LTRIM(RTRIM(F.DESCRIPCION)) AS value';
  const group = select.replace(' AS value', '');
  const filters = kind === 'department'
    ? 'LOWER(LTRIM(RTRIM(D.DESCRIPCION))) <> LOWER(@hiddenDepartment)'
    : kind === 'section'
      ? 'LOWER(LTRIM(RTRIM(D.DESCRIPCION))) = LOWER(@department)'
      : 'LOWER(LTRIM(RTRIM(D.DESCRIPCION))) = LOWER(@department) AND LOWER(LTRIM(RTRIM(S.DESCRIPCION))) = LOWER(@section)';
  return `
SELECT ${select}
${CATEGORY_FROM}
${HIERARCHY_JOINS}
WHERE ${filters}
GROUP BY ${group}
HAVING SUM(COALESCE(ST.STOCK, 0)) > 0
ORDER BY ${group}`;
};

const PROMOTION_QUERY = `
SELECT
    P.IDPROMOCION AS promotionId,
    P.PRIORIDAD AS priority,
    P.DESCRIPCION AS promotionDescription,
    P.TEXTOIMPRIMIR AS printText,
    P.TEXTOALAPLICAR AS applyText,
    P.TEXTOVISIBLEENVISOR AS visibleText,
    P.FECHAINICIAL AS startDate,
    P.FECHAFINAL AS endDate,
    P.HORAINICIAL AS startTime,
    P.HORAFINAL AS endTime,
    P.DIASSEMANA AS weekDays,
    P.IDTARIFAV AS directTariff,
    P.IDGRUPO AS promotionGroup,
    P.CLIENTEOBLIGATORIO AS clientRequired,
    P.IDGRUPOCLIENTES AS clientGroup,
    P.EANCUPON AS couponEan,
    P.CUPONSERIALIZADO AS serializedCoupon,
    P.VALIDACIONEXTERNA AS externalValidation,
    P.MANUAL AS manualPromotion,
    P.PEDIRCUPONSERIALIZADO AS requestSerializedCoupon,
    P.APLICARTIPOTERMINAL AS terminalTypeRequired,
    P.APLICARDELIVERY AS deliveryPromotion,
    P.DTOSASFORMAPAGO AS paymentMethodDiscount,
    P.CODFORMAPAGODTOS AS paymentMethodCode,
    P.CUMPLEANYOS AS birthdayRequired,
    P.APLICARNVECES AS applyCount,
    P.APLICARNVECESPORCLIENTE AS applyCountPerClient,
    P.APLICARNVECESPORCLIENTECADAPERIODO AS applyCountPerClientPeriod,
    P.APLICARNVECESPORCLIENTESINCONEX AS applyCountPerClientOffline,
    P.CUMPLEANYOSXDIASANTES AS birthdayDaysBefore,
    P.CUMPLEANYOSXDIASDESPUES AS birthdayDaysAfter,
    P.NUMEROARTICULOS AS articleCount,
    P.IMPORTEMINIMO AS minimumAmount,
    P.TIPOAPLICACION AS applicationType,
    P.CONDICIONAPLICACION AS applicationCondition,
    P.MOMENTOAPLICACION AS applicationMoment,
    AP.IDACCION AS actionId,
    AP.TIPOACCION AS actionType,
    AP.VALOR AS actionValue,
    AP.VALOR2 AS actionValue2,
    C.GRUPOOR AS groupOr,
    C.GRUPOAND AS groupAnd,
    C.INCLUIR AS includeRule,
    C.TABLA AS conditionTable,
    C.CAMPO AS conditionField,
    C.OPERADOR AS conditionOperator,
    C.VALOR AS conditionValue,
    CASE WHEN EXISTS (
        SELECT 1
        FROM dbo.ARTICPROMOCION AD
        WHERE AD.CODARTICULO = @articleCode
          AND AD.IDPROMOCION = P.IDPROMOCION
    ) THEN 1 ELSE 0 END AS directMatch,
    CASE WHEN EXISTS (
        SELECT 1
        FROM dbo.ELEMENTOSGRUPO EG
        WHERE EG.CODARTICULO = @articleCode
          AND EG.IDGRUPO = P.IDGRUPO
    ) THEN 1 ELSE 0 END AS explicitGroupMatch,
    SYSDATETIME() AS serverNow
FROM dbo.PROMOCIONES P
LEFT JOIN dbo.ACCIONESPROMOCION AP
    ON AP.IDPROMOCION = P.IDPROMOCION
LEFT JOIN dbo.CONDICIONESGRUPOSARTICULOS C
    ON C.IDGRUPO = P.IDGRUPO
WHERE (
        P.IDTARIFAV = @tariff
        OR EXISTS (
            SELECT 1
            FROM dbo.PROMOCIONESTARIFAS PT
            WHERE PT.IDPROMOCION = P.IDPROMOCION
              AND PT.IDTARIFAV = @tariff
        )
    )
  AND (P.FECHAINICIAL IS NULL OR CAST(P.FECHAINICIAL AS date) <= CAST(SYSDATETIME() AS date))
  AND (P.FECHAFINAL IS NULL OR CAST(P.FECHAFINAL AS date) >= CAST(SYSDATETIME() AS date))
  AND (P.HORAINICIAL IS NULL OR CAST(SYSDATETIME() AS time) >= CAST(P.HORAINICIAL AS time))
  AND (P.HORAFINAL IS NULL OR CAST(SYSDATETIME() AS time) <= CAST(P.HORAFINAL AS time))
  AND (P.HORAINICIAL IS NULL OR P.HORAFINAL IS NULL OR CAST(P.HORAINICIAL AS time) <= CAST(P.HORAFINAL AS time))
  AND (P.DIASSEMANA IS NULL OR LTRIM(RTRIM(P.DIASSEMANA)) IN ('', '1111111'))
  AND (
        NOT EXISTS (
            SELECT 1
            FROM dbo.PROMOCIONESGRUPOSALMACEN PGS
            WHERE PGS.IDPROMOCION = P.IDPROMOCION
        )
        OR EXISTS (
            SELECT 1
            FROM dbo.PROMOCIONESGRUPOSALMACEN PGS
            INNER JOIN dbo.GRUPOSALMACENLIN GAL
                ON GAL.IDGRUPO = PGS.IDGRUPO
               AND GAL.CODALMACEN = @warehouse
            WHERE PGS.IDPROMOCION = P.IDPROMOCION
        )
    )
  AND (
        EXISTS (
            SELECT 1
            FROM dbo.ARTICPROMOCION AD
            WHERE AD.CODARTICULO = @articleCode
              AND AD.IDPROMOCION = P.IDPROMOCION
        )
        OR EXISTS (
            SELECT 1
            FROM dbo.ELEMENTOSGRUPO EG
            WHERE EG.CODARTICULO = @articleCode
              AND EG.IDGRUPO = P.IDGRUPO
        )
        OR P.IDGRUPO IS NOT NULL
    )
ORDER BY P.PRIORIDAD, P.IDPROMOCION, AP.IDACCION, C.GRUPOOR, C.GRUPOAND`;

const paramsFor = ({ warehouse, tariff, priceFormat }) => ({
  warehouse: { type: sql.VarChar(20), value: warehouse },
  tariff: { type: sql.Int, value: tariff },
  priceFormat: { type: sql.Int, value: priceFormat },
  hiddenDepartment: { type: sql.NVarChar(255), value: 'muebles' }
});

const promotionParamsFor = ({ warehouse, tariff, articleCode }) => ({
  warehouse: { type: sql.VarChar(20), value: warehouse },
  tariff: { type: sql.Int, value: tariff },
  articleCode: { type: sql.Int, value: Number.isInteger(Number(articleCode)) ? Number(articleCode) : null }
});

const mapVariant = row => ({
  CODBARRAS: clean(row.CODBARRAS),
  CODBARRAS2: clean(row.CODBARRAS2),
  CODBARRAS3: clean(row.CODBARRAS3),
  supplierRef: clean(row.supplierRef),
  departmentCode: row.departmentCode ?? null,
  sectionCode: row.sectionCode ?? null,
  familyCode: row.familyCode ?? null,
  subfamilyCode: row.subfamilyCode ?? null,
  season: clean(row.season),
  description: clean(row.description),
  additionalDescription: clean(row.additionalDescription),
  size: clean(row.size),
  color: clean(row.color),
  ref: clean(row.ref),
  style: clean(row.style),
  stock: numberOrZero(row.stock),
  price: numberOrNull(row.price),
  materialSpanish: '',
  composition: '',
  colorDescription: clean(row.colorDescription),
  colorSpanish: clean(row.colorSpanish),
  promo01: row.promo01 == null ? null : clean(row.promo01),
  promo05: row.promo05 == null ? null : clean(row.promo05),
  promo18: row.promo18 == null ? null : clean(row.promo18),
  mayorCw: row.mayorCw == null ? null : clean(row.mayorCw),
  department: clean(row.department),
  section: clean(row.section),
  family: clean(row.family),
  subfamily: clean(row.subfamily),
  articleCode: clean(row.articleCode)
});

const mapSummary = row => ({
  ref: clean(row.ref),
  style: clean(row.style),
  description: clean(row.description),
  additionalDescription: clean(row.additionalDescription),
  color: clean(row.color),
  colorDescription: clean(row.colorDescription),
  colorSpanish: clean(row.colorSpanish),
  price: numberOrNull(row.price),
  season: clean(row.season),
  stockTotal: numberOrZero(row.stockTotal),
  sizesWithStock: numberOrZero(row.sizesWithStock)
});

const promotionContextFrom = row => ({
  DPTO: row.departmentCode,
  SECCION: row.sectionCode,
  FAMILIA: row.familyCode,
  SUBFAMILIA: row.subfamilyCode,
  TEMPORADA: row.season,
  REFPROVEEDOR: row.supplierRef,
  REFERENCIA_STYLO: row.ref,
  PROMO01: row.promo01,
  PROMO05: row.promo05,
  PROMO18: row.promo18,
  MAYOR_CW: row.mayorCw
});

const uniqueRows = (rows, key) => [...new Map(rows.map(row => [key(row), row])).values()];

const promotionFromRows = (rows, productContext) => {
  const first = rows[0];
  const conditions = uniqueRows(
    rows.filter(row => row.conditionField != null),
    row => [row.groupOr, row.groupAnd, row.includeRule, row.conditionTable, row.conditionField, row.conditionOperator, row.conditionValue].join('|')
  ).map(row => ({
    GRUPOOR: row.groupOr,
    GRUPOAND: row.groupAnd,
    INCLUIR: row.includeRule,
    TABLA: row.conditionTable,
    CAMPO: row.conditionField,
    OPERADOR: row.conditionOperator,
    VALOR: row.conditionValue
  }));
  const actions = uniqueRows(
    rows.filter(row => row.actionType != null || row.actionId != null),
    row => [row.actionId, row.actionType, row.actionValue, row.actionValue2].join('|')
  );
  const directMatch = rows.some(row => Number(row.directMatch) === 1);
  const explicitGroupMatch = rows.some(row => Number(row.explicitGroupMatch) === 1);
  const dynamicMatch = first.promotionGroup != null && evaluatePromotionGroup(conditions, promotionContextFrom(productContext));
  const eligible = directMatch || explicitGroupMatch || dynamicMatch;
  const promotion = {
    IDPROMOCION: first.promotionId,
    DESCRIPCION: first.promotionDescription,
    FECHAINICIAL: first.startDate,
    FECHAFINAL: first.endDate,
    HORAINICIAL: first.startTime,
    HORAFINAL: first.endTime,
    DIASSEMANA: first.weekDays,
    CLIENTEOBLIGATORIO: first.clientRequired,
    IDGRUPOCLIENTES: first.clientGroup,
    EANCUPON: first.couponEan,
    CUPONSERIALIZADO: first.serializedCoupon,
    VALIDACIONEXTERNA: first.externalValidation,
    MANUAL: first.manualPromotion,
    PEDIRCUPONSERIALIZADO: first.requestSerializedCoupon,
    APLICARTIPOTERMINAL: first.terminalTypeRequired,
    APLICARDELIVERY: first.deliveryPromotion,
    DTOSASFORMAPAGO: first.paymentMethodDiscount,
    CODFORMAPAGODTOS: first.paymentMethodCode,
    CUMPLEANYOS: first.birthdayRequired,
    APLICARNVECES: first.applyCount,
    APLICARNVECESPORCLIENTE: first.applyCountPerClient,
    APLICARNVECESPORCLIENTECADAPERIODO: first.applyCountPerClientPeriod,
    APLICARNVECESPORCLIENTESINCONEX: first.applyCountPerClientOffline,
    CUMPLEANYOSXDIASANTES: first.birthdayDaysBefore,
    CUMPLEANYOSXDIASDESPUES: first.birthdayDaysAfter,
    NUMEROARTICULOS: first.articleCount,
    IMPORTEMINIMO: first.minimumAmount,
    TIPOAPLICACION: first.applicationType,
    CONDICIONAPLICACION: first.applicationCondition,
    MOMENTOAPLICACION: first.applicationMoment,
    serverNow: first.serverNow
  };
  if (!eligible || isInternalPromotion(promotion) || !isPromotionCurrent(promotion, first.serverNow || new Date())) return null;

  const action = actions.length === 1
    ? parsePromotionAction(actions[0])
    : { type: 'unknown', percentage: null, promotionalPrice: null };
  if (action.type === 'unknown') return null;
  const conditionState = classifyPromotionConditions(promotion);
  const basePrice = numberOrNull(productContext.price);
  const result = {
    id: numberOrNull(first.promotionId),
    description: clean(first.promotionDescription || first.applyText || first.printText),
    type: action.type,
    percentage: action.percentage,
    promotionalPrice: action.promotionalPrice,
    calculatedPrice: calculatePromotionPrice(action, basePrice),
    startDate: first.startDate ?? null,
    endDate: first.endDate ?? null,
    priority: numberOrNull(first.priority),
    source: 'sqlserver'
  };
  if (conditionState.isConditional) {
    return {
      ...result,
      calculatedPrice: null,
      conditionType: conditionState.conditionType,
      conditionTypes: conditionState.conditionTypes,
      conditionLabel: conditionState.conditionLabel,
      requiresValidation: true
    };
  }
  return result;
};

const boolFromEnv = (value, fallback) => {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'si'].includes(String(value).trim().toLowerCase());
};

export const sqlConfigFromEnv = (env = process.env) => {
  const config = {
    server: env.DB_SERVER || 'localhost',
    database: env.DB_DATABASE,
    options: {
      encrypt: boolFromEnv(env.DB_ENCRYPT, true),
      trustServerCertificate: boolFromEnv(env.DB_TRUST_SERVER_CERTIFICATE, false)
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: Number(env.DB_REQUEST_TIMEOUT_MS || 3000),
    connectionTimeout: Number(env.DB_CONNECTION_TIMEOUT_MS || 3000)
  };
  if (env.DB_USER) config.user = env.DB_USER;
  if (env.DB_PASSWORD) config.password = env.DB_PASSWORD;
  if (env.DB_PORT) config.port = Number(env.DB_PORT);
  return config;
};

export class SqlServerProductRepository extends ProductRepository {
  constructor({
    pool = null,
    poolFactory = null,
    env = process.env,
    config = sqlConfigFromEnv(env),
    warehouse = env.STORE_WAREHOUSE || 'V08',
    tariff = Number(env.SALES_TARIFF_ID || 5),
    priceFormat = env.SALES_PRICE_FORMAT ? Number(env.SALES_PRICE_FORMAT) : null,
    requestTimeoutMs = Number(env.DB_REQUEST_TIMEOUT_MS || config.requestTimeout || 3000)
  } = {}) {
    super();
    this.pool = pool;
    this.poolPromise = null;
    this.poolFactory = poolFactory || (connectionConfig => {
      const connectionPool = new sql.ConnectionPool(connectionConfig);
      return connectionPool.connect();
    });
    this.config = config;
    this.warehouse = warehouse;
    this.tariff = tariff;
    this.priceFormat = priceFormat;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async getPool() {
    if (this.pool) return this.pool;
    if (!this.poolPromise) this.poolPromise = Promise.resolve(this.poolFactory(this.config));
    this.pool = await this.poolPromise;
    return this.pool;
  }

  async query(text, values = {}) {
    const request = (await this.getPool()).request();
    request.timeout = this.requestTimeoutMs;
    for (const [name, { type, value }] of Object.entries(values)) request.input(name, type, value);
    const result = await request.query(text);
    return result.recordset ?? [];
  }

  commonParams(extra = {}) {
    return { ...paramsFor({ warehouse: this.warehouse, tariff: this.tariff, priceFormat: this.priceFormat }), ...extra };
  }

  async findByBarcode(barcode) {
    const rows = await this.query(variantQuery('(L.CODBARRAS = @query OR L.CODBARRAS2 = @query OR L.CODBARRAS3 = @query)'), this.commonParams({
      query: { type: sql.NVarChar(255), value: clean(barcode) }
    }));
    return rows.length ? mapVariant(rows[0]) : null;
  }

  async findByQuery(query) {
    // Rendimiento: findByQuery y searchProducts combinan en OR
    // CODBARRAS/CODBARRAS2/CODBARRAS3/REFPROVEEDOR/REFERENCIA_STYLO/STYLE/
    // CODARTICULO. REFERENCIA_STYLO y STYLE no tienen índice confirmado; sin
    // un plan real no se rediseña todavía porque este OR puede dificultar
    // index seeks y requerir rutas separadas.
    const rows = await this.query(variantQuery(`
        L.CODBARRAS = @query
        OR L.CODBARRAS2 = @query
        OR L.CODBARRAS3 = @query
        OR A.REFPROVEEDOR = @query
        OR CL.REFERENCIA_STYLO = @query
        OR CL.STYLE = @query
        OR A.CODARTICULO = TRY_CONVERT(INT, @query)`), this.commonParams({
      query: { type: sql.NVarChar(255), value: clean(query) }
    }));
    return rows.length ? mapVariant(rows[0]) : null;
  }

  async findByReference(reference) {
    const rows = await this.query(variantQuery('CL.REFERENCIA_STYLO = @reference'), this.commonParams({
      reference: { type: sql.NVarChar(255), value: clean(reference) }
    }));
    return rows.map(mapVariant);
  }

  async findByStyle(style) {
    const rows = await this.query(variantQuery('CL.STYLE = @style'), this.commonParams({
      style: { type: sql.NVarChar(255), value: clean(style) }
    }));
    return rows.map(mapVariant);
  }

  async searchProducts(text, limit = 20) {
    const maxResults = maxLimit(limit, 20);
    const matched = `
        L.CODBARRAS = @query
        OR L.CODBARRAS2 = @query
        OR L.CODBARRAS3 = @query
        OR A.REFPROVEEDOR = @query
        OR CL.REFERENCIA_STYLO = @query
        OR CL.STYLE = @query
        OR A.CODARTICULO = TRY_CONVERT(INT, @query)`;
    const query = `${MATCHED_REFERENCES_CTE(matched)}${summarySelect}`;
    const rows = await this.query(query, this.commonParams({
      query: { type: sql.NVarChar(255), value: clean(text) },
      limit: { type: sql.Int, value: maxResults }
    }));
    return rows.map(mapSummary);
  }

  async getDepartments() {
    const rows = await this.query(categoryQuery('department'), this.commonParams());
    return rows.map(row => clean(row.value)).filter(Boolean);
  }

  async getSections(department) {
    const rows = await this.query(categoryQuery('section'), this.commonParams({
      department: { type: sql.NVarChar(255), value: clean(department) }
    }));
    return rows.map(row => clean(row.value)).filter(Boolean);
  }

  async getFamilies(department, section) {
    const rows = await this.query(categoryQuery('family'), this.commonParams({
      department: { type: sql.NVarChar(255), value: clean(department) },
      section: { type: sql.NVarChar(255), value: clean(section) }
    }));
    return rows.map(row => clean(row.value)).filter(Boolean);
  }

  async getProductsByCategory(department, section, family, limit = 20) {
    const maxResults = maxLimit(limit, 20);
    const rows = await this.query(catalogSummaryQuery, this.commonParams({
      department: { type: sql.NVarChar(255), value: clean(department) },
      section: { type: sql.NVarChar(255), value: clean(section) },
      family: { type: sql.NVarChar(255), value: clean(family) },
      limit: { type: sql.Int, value: maxResults }
    }));
    return rows.map(mapSummary);
  }

  async findSimilarProducts({ department, section, family, excludeReference, limit = 6 }) {
    const maxResults = maxLimit(limit, 6);
    const rows = await this.query(similarQuery, this.commonParams({
      department: { type: sql.NVarChar(255), value: clean(department) },
      section: { type: sql.NVarChar(255), value: clean(section) },
      family: { type: sql.NVarChar(255), value: clean(family) },
      excludeReference: { type: sql.NVarChar(255), value: clean(excludeReference) },
      limit: { type: sql.Int, value: maxResults }
    }));
    return rows.map(mapSummary);
  }

  async findApplicablePromotions(productContext) {
    const rows = await this.query(PROMOTION_QUERY, promotionParamsFor({
      warehouse: this.warehouse,
      tariff: this.tariff,
      articleCode: productContext?.articleCode
    }));
    const grouped = new Map();
    for (const row of rows) {
      const key = row.promotionId;
      if (key == null) continue;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }
    const evaluatedPromotions = [...grouped.values()]
      .map(group => promotionFromRows(group, productContext || {}))
      .filter(Boolean)
      .sort((left, right) => (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER)
        || (left.id ?? Number.MAX_SAFE_INTEGER) - (right.id ?? Number.MAX_SAFE_INTEGER));
    const promotions = evaluatedPromotions.filter(promotion => !promotion.requiresValidation);
    const conditionalPromotions = evaluatedPromotions.filter(promotion => promotion.requiresValidation);
    // No hay regla confirmada de acumulación/prioridad entre varias promociones.
    // El precio "mejor" solo es seguro cuando existe una única opción aplicable.
    const comparable = promotions.length === 1
      && promotions.every(promotion => promotion.type !== 'unknown' && Number.isFinite(promotion.calculatedPrice));
    return {
      promotions,
      conditionalPromotions,
      bestPromotionalPrice: comparable ? Math.min(...promotions.map(promotion => promotion.calculatedPrice)) : null
    };
  }

  async close() {
    if (this.pool?.close) await this.pool.close();
    this.pool = null;
    this.poolPromise = null;
  }
}

export const queries = {
  variantQuery,
  search: MATCHED_REFERENCES_CTE,
  catalogSummaryQuery,
  similarQuery,
  categoryQuery,
  promotions: PROMOTION_QUERY
};
