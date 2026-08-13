import sql from 'mssql';
import { ProductRepository } from './ProductRepository.js';

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
    A.DESCRIPCION AS description,
    A.DESCRIPADIC AS additionalDescription,
    A.TEMPORADA AS season,
    CL.REFERENCIA_STYLO AS ref,
    CL.STYLE AS style,
    CL.COLORDESC AS colorDescription,
    CL.COLOR_ESP AS colorSpanish,
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

const paramsFor = ({ warehouse, tariff, priceFormat }) => ({
  warehouse: { type: sql.VarChar(20), value: warehouse },
  tariff: { type: sql.Int, value: tariff },
  priceFormat: { type: sql.Int, value: priceFormat },
  hiddenDepartment: { type: sql.NVarChar(255), value: 'muebles' }
});

const mapVariant = row => ({
  CODBARRAS: clean(row.CODBARRAS),
  CODBARRAS2: clean(row.CODBARRAS2),
  CODBARRAS3: clean(row.CODBARRAS3),
  supplierRef: clean(row.supplierRef),
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

  async close() {
    if (this.pool?.close) await this.pool.close();
    this.pool = null;
    this.poolPromise = null;
  }
}

export const queries = { variantQuery, search: MATCHED_REFERENCES_CTE, catalogSummaryQuery, similarQuery, categoryQuery };
