export const SEARCH_MODES = ['smart', 'phrase', 'regex'];
export const SEARCH_SCOPES = ['all', 'title', 'meaning'];
export const MAX_QUERY_LENGTH = 200;
const FIELD_SETTINGS = {
  title: { label: 'Tên mẫu', weight: 600 },
  meaning: { label: 'Ý nghĩa', weight: 260 },
  structure: { label: 'Cách chia', weight: 160 },
  usage: { label: 'Cách dùng', weight: 100 },
  group: { label: 'Nhóm ngữ pháp', weight: 70 },
  example: { label: 'Câu ví dụ', weight: 40 },
  comparison: { label: 'Phân biệt/lưu ý', weight: 20 }
};

// NFKC unifies character width. Kana voicing and the long vowel mark stay intact.
export function normalizeSearchText(value = '') {
  return String(value).normalize('NFKC').toLowerCase()
    .replace(/[\u30a1-\u30f6\u30fd\u30fe]/gu, character => String.fromCodePoint(character.codePointAt(0) - 0x60))
    .replace(/[\u200b-\u200d\ufeff]/gu, '')
    .replace(/[~〜～]/gu, '')
    .replace(/\.{2,}/gu, ' ')
    .replace(/\s+/gu, ' ').trim();
}

export function foldVietnamese(value) {
  // Strip combining marks only after Latin letters, never after kana.
  return value.normalize('NFD').replace(/([a-z])([\u0300-\u036f]+)/gu, '$1')
    .replace(/đ/gu, 'd').normalize('NFC');
}

function titleVariants(title) {
  const pieces = [];
  let part = '', depth = 0;
  for (const character of title.normalize('NFKC')) {
    if (character === '(') depth++;
    if (character === ')') depth = Math.max(0, depth - 1);
    if (!depth && /[・/]/u.test(character)) { pieces.push(part); part = ''; }
    else part += character;
  }
  pieces.push(part);
  const variants = [title];
  for (const piece of pieces) {
    let options = [piece];
    for (let step = 0; step < 4 && options.some(option => /\([^()]*\)/u.test(option)); step++) {
      options = options.flatMap(option => {
        const match = /\(([^()]*)\)/u.exec(option);
        if (!match) return [option];
        return ['', ...match[1].split(/[・/]/u)].map(replacement => option.slice(0, match.index) + replacement + option.slice(match.index + match[0].length));
      }).slice(0, 32);
    }
    variants.push(...options);
  }
  return [...new Set(variants.map(normalizeSearchText).filter(Boolean))];
}

export function parseCardSections(back, hint = '') {
  const sections = {};
  const matches = [...back.matchAll(/(?:^|\n)- ([^:]+):\s*/g)];
  matches.forEach((match, index) => {
    sections[match[1]] = back.slice(match.index + match[0].length, matches[index + 1]?.index ?? back.length).trim();
  });
  sections['Nghĩa'] ||= hint;
  return sections;
}

export function buildSearchIndex(cards) {
  return cards.map((card, order) => {
    const section = parseCardSections(card.back, card.hint);
    const rawFields = {
      title: card.front, meaning: section['Nghĩa'], structure: section['Cách chia'],
      usage: section['Cách dùng'] || section['Cách dùng & cấu trúc'], group: card.groupName,
      example: section['Câu ví dụ'], comparison: section['Phân biệt/lưu ý']
    };
    return {
      id: card.id, order,
      fields: Object.entries(rawFields).filter(([, raw]) => raw).map(([key, raw]) => {
        const canonical = normalizeSearchText(raw);
        const variants = key === 'title' ? titleVariants(raw) : [canonical];
        return { key, raw, canonical, folded: foldVietnamese(canonical), variants, foldedVariants: variants.map(foldVietnamese), ...FIELD_SETTINGS[key] };
      })
    };
  });
}

export function validateSearch(query, mode = 'smart', scope = 'all') {
  if (typeof query !== 'string') throw new Error('Nội dung tìm kiếm phải là văn bản.');
  if (query.length > MAX_QUERY_LENGTH) throw new Error(`Nhập tối đa ${MAX_QUERY_LENGTH} ký tự để tìm kiếm.`);
  if (!SEARCH_MODES.includes(mode)) throw new Error('Chế độ tìm kiếm không hợp lệ.');
  if (!SEARCH_SCOPES.includes(scope)) throw new Error('Phạm vi tìm kiếm không hợp lệ.');
}

function selectedFields(document, scope) {
  return document.fields.filter(field => scope === 'all' || field.key === scope);
}

function literalMatcher(text) {
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) {
    return candidate => candidate.includes(text);
  }
  // Unicode word edges avoid matching Vietnamese words inside longer words.
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'u');
  return candidate => expression.test(candidate);
}

function ordered(hits) {
  return hits.sort((left, right) => right.score - left.score || left.order - right.order);
}

export function searchLiteral(index, query, { mode = 'smart', scope = 'all' } = {}) {
  validateSearch(query, mode, scope);
  if (mode === 'regex') throw new Error('Biểu thức cần được chạy trong bộ tìm kiếm Regex.');
  if (!query.trim()) return index.map(document => ({ id: document.id, order: document.order, score: 0, matchLabel: '' }));
  const canonicalQuery = normalizeSearchText(query);
  const foldedQuery = foldVietnamese(canonicalQuery);
  if (!foldedQuery) return [];
  const tokens = mode === 'phrase' ? [foldedQuery] : [...new Set(foldedQuery.split(' '))];
  const matchers = tokens.map(literalMatcher);
  const phraseMatcher = literalMatcher(foldedQuery);
  const hits = [];
  for (const document of index) {
    const fields = selectedFields(document, scope);
    let score = 0, bestField = null;
    const matchesAll = matchers.every(matches => {
      const matchingFields = fields.filter(field => field.foldedVariants.some(matches));
      if (!matchingFields.length) return false;
      const field = matchingFields[0];
      score += field.weight;
      if (!bestField || field.weight > bestField.weight) bestField = field;
      return true;
    });
    if (!matchesAll) continue;
    const title = fields.find(field => field.key === 'title');
    if (title?.foldedVariants.includes(foldedQuery)) score += 10000;
    else if (title?.foldedVariants.some(phraseMatcher)) score += 5000;
    else if (title && matchers.every(matches => title.foldedVariants.some(matches))) score += 3000;
    for (const field of fields) {
      if (field.foldedVariants.some(phraseMatcher)) score += field.weight;
      if (field.variants.includes(canonicalQuery)) score += 300;
      else if (field.canonical.includes(canonicalQuery)) score += 40;
    }
    hits.push({ id: document.id, order: document.order, score, matchLabel: bestField.label });
  }
  return ordered(hits);
}

// Called only inside a disposable worker in the web app. Never normalize regex syntax.
export function searchRegex(index, query, scope = 'all') {
  validateSearch(query, 'regex', scope);
  if (!query.trim()) return index.map(document => ({ id: document.id, order: document.order, score: 0, matchLabel: '' }));
  let expression;
  try { expression = new RegExp(query, 'iu'); }
  catch { throw new Error('Biểu thức chưa hợp lệ. Kiểm tra dấu ngoặc, dấu [ ] và ký tự \\.'); }
  return ordered(index.flatMap(document => {
    const field = selectedFields(document, scope).find(field => expression.test(field.raw));
    return field ? [{ id: document.id, order: document.order, score: field.weight, matchLabel: field.label }] : [];
  }));
}
