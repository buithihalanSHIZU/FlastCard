export const SEARCH_MODES = ['smart', 'phrase', 'regex'];
export const SEARCH_SCOPES = ['all', 'title', 'meaning'];
export const MAX_QUERY_LENGTH = 200;
const FIELD_SETTINGS = {
  title: { label: 'Chữ Hán', weight: 600 },
  meaning: { label: 'Nghĩa tiếng Việt', weight: 260 },
  pinyin: { label: 'Pinyin', weight: 220 },
  zhuyin: { label: 'Zhuyin', weight: 220 },
  hanviet: { label: 'Âm Hán Việt', weight: 140 },
  characters: { label: 'Chữ Hán thành phần', weight: 80 },
  usage: { label: 'Cách dùng', weight: 70 },
  group: { label: 'Bài học', weight: 50 },
  example: { label: 'Câu ví dụ', weight: 45 },
  related: { label: 'Từ liên quan', weight: 30 }
};

export function normalizeSearchText(value = '') {
  return String(value).normalize('NFKC').toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/gu, '')
    .replace(/\s+/gu, ' ').trim();
}
export function foldVietnamese(value = '') {
  return String(value).normalize('NFD').replace(/([a-z])([\u0300-\u036f]+)/gu, '$1')
    .replace(/đ/gu, 'd').normalize('NFC');
}
function pinyinVariants(pinyin) {
  const raw = normalizeSearchText(pinyin);
  return [...new Set([raw, raw.replace(/[\s'’,-]+/gu, ''), raw.replace(/ü/gu,'v')].filter(Boolean))];
}
export function buildSearchIndex(cards) {
  return cards.map((card, order) => {
    const rawFields = {
      title: card.front, meaning: card.meaningFull || card.meaning,
      pinyin: card.pinyin, zhuyin: card.zhuyin, hanviet: card.hanViet,
      characters: card.characters.map(c => `${c.character} ${c.hanViet}`).join(' '),
      usage: card.usage, group: card.groupName,
      example: card.examples.map(e => `${e.traditional} ${e.meaning_vi || ''}`).join(' '),
      related: card.related.map(r => `${r.word} ${r.meaning}`).join(' ')
    };
    return { id: card.id, order, fields: Object.entries(rawFields).filter(([,raw]) => raw).map(([key, raw]) => {
      const canonical = normalizeSearchText(raw);
      const variants = key === 'pinyin' ? pinyinVariants(raw) :
        key === 'title' ? [...new Set([canonical, ...card.variants.map(variant => normalizeSearchText(typeof variant === 'string' ? variant : variant?.form || variant?.traditional || ''))].filter(Boolean))] : [canonical];
      return { key, raw, canonical, folded: foldVietnamese(canonical), variants,
        foldedVariants: variants.map(foldVietnamese), ...FIELD_SETTINGS[key] };
    })};
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
  if (/[\p{Script=Han}\p{Script=Bopomofo}]/u.test(text)) return candidate => candidate.includes(text);
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'u');
  return candidate => expression.test(candidate);
}
function ordered(hits) { return hits.sort((a,b) => b.score - a.score || a.order - b.order); }
export function searchLiteral(index, query, { mode = 'smart', scope = 'all' } = {}) {
  validateSearch(query, mode, scope);
  if (mode === 'regex') throw new Error('Biểu thức cần chạy trong bộ tìm kiếm Regex.');
  if (!query.trim()) return index.map(doc => ({id:doc.id,order:doc.order,score:0,matchLabel:''}));
  const canonicalQuery = normalizeSearchText(query);
  const foldedQuery = foldVietnamese(canonicalQuery);
  const tokens = mode === 'phrase' ? [foldedQuery] : [...new Set(foldedQuery.split(' '))];
  const matchers = tokens.map(literalMatcher), phrase = literalMatcher(foldedQuery);
  const hits=[];
  for (const doc of index) {
    const fields = selectedFields(doc,scope);
    let score=0,bestField=null;
    const tokenMatch = matchers.every(match => {
      const found = fields.find(field => field.foldedVariants.some(match));
      if(!found)return false;
      score += found.weight;
      if(!bestField || found.weight > bestField.weight)bestField=found;
      return true;
    });
    // Accept both "xuexiao" and "xue xiao" when the Pinyin record has no spaces.
    const compact = /^[a-z\s'’,-]+$/u.test(foldedQuery) ? foldedQuery.replace(/[\s'’,-]+/gu,'') : '';
    const compactField = !tokenMatch && compact ? fields.find(field => field.key === 'pinyin' && field.foldedVariants.some(v => v.replace(/[\s'’,-]+/gu,'') === compact)) : null;
    if(!tokenMatch && !compactField)continue;
    if(compactField){score = compactField.weight;bestField = compactField;}
    const title=fields.find(field=>field.key==='title');
    if(title?.foldedVariants.includes(foldedQuery))score+=10000;
    else if(title?.foldedVariants.some(phrase))score+=5000;
    for(const field of fields){
      if(field.foldedVariants.some(phrase))score+=field.weight;
      if(field.variants.includes(canonicalQuery))score+=300;
      else if(field.canonical.includes(canonicalQuery))score+=40;
    }
    hits.push({id:doc.id,order:doc.order,score,matchLabel:bestField?.label || ''});
  }
  return ordered(hits);
}
// Search runs inside a disposable worker with an external timeout.
export function searchRegex(index, query, scope = 'all') {
  validateSearch(query,'regex',scope);
  if(!query.trim())return index.map(doc=>({id:doc.id,order:doc.order,score:0,matchLabel:''}));
  let expression;
  try{expression=new RegExp(query,'iu');}catch{throw new Error('Biểu thức Regex chưa hợp lệ.');}
  return ordered(index.flatMap(doc=>{
    const field=selectedFields(doc,scope).find(f=>expression.test(f.raw));
    return field?[{id:doc.id,order:doc.order,score:field.weight,matchLabel:field.label}]:[];
  }));
}