const clean = value => value == null ? '' : String(value).trim();

const STYLE_PATTERN = /^\d{8}$/;
const COLOR_PATTERN = /^[A-Z0-9]{4}$/;

export const styleColorFromParts = (style, color) => {
  const normalizedStyle = clean(style);
  const normalizedColor = clean(color).toUpperCase();
  if (!STYLE_PATTERN.test(normalizedStyle) || !COLOR_PATTERN.test(normalizedColor)) return null;
  return `${normalizedStyle}-${normalizedColor}`;
};

export const normalizeStyleColor = value => {
  const normalized = clean(value).toUpperCase();
  const match = normalized.match(/^(\d{8})-([A-Z0-9]{4})$/);
  return match ? `${match[1]}-${match[2]}` : null;
};
