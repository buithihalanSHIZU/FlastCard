import { buildSearchIndex, parseCardSections, searchLiteral, validateSearch } from './search.js';
import { runRegexSearch } from './search-client.js';
import { buildStudyCards } from './cards.js';

const STORAGE_KEY = 'jlpt-n1-progress';
const QUIZ_HISTORY_KEY = 'jlpt-n1-quiz-history';
const REVIEW_INTERVALS = [1, 3, 7, 14, 30];
const PAGE_SIZE = 5;
const state = { cards: [], quizData: [], quizHistory: loadQuizHistory(), filtered: [], active: [], index: 0, listPage: 1, flipped: false, mode: 'study', view: 'deck', quizGroup: 'all', quizCardIndex: 0, query: '', group: 'all', status: 'ALL', progress: loadProgress(), searchIndex: [], searchHits: new Map(), searchMode: 'smart', searchScope: 'all', searchError: '', searching: false };
const $ = selector => document.querySelector(selector);
let searchRevision = 0;
let searchController;
let searchInputTimer;

async function boot() {
  try{
    const [response, quizResponse] = await Promise.all([fetch('./FlastCard/grammar.json'), fetch('./quiz-data.json')]);
    if (!response.ok || !quizResponse.ok) throw new Error('grammar data unavailable');
    const source = await response.json();
    state.quizData = await quizResponse.json();
    state.cards = buildStudyCards(source, state.quizData);
    state.searchIndex = buildSearchIndex(state.cards);
    $('#cardCountLabel').textContent = `${state.cards.length} mẫu ngữ pháp và biểu đạt`;
    populateGroups();
    populateQuizGroups();
    populateQuizCards();
    bindEvents();
    bindModeEvents();
    await applyFilters();
    registerGrammarTools();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Offline mode unavailable', error));
  } catch (error) {
    $('#deckView').innerHTML = '<div class="empty"><strong>Không thể tải dữ liệu</strong>Kiểm tra kết nối rồi tải lại trang.</div>';
    console.error(error);
  }
}
function registerGrammarTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  window.addEventListener('pagehide', event => { if (!event.persisted) lifecycle.abort(); }, { once: true });
  const tools = [{
    name: 'search_grammar_cards',
    title: 'Tìm mẫu ngữ pháp',
    description: 'Search grammar using the same normalized, ranked search as the page without changing it. Supports all-keyword, contiguous-phrase and raw Unicode regex modes; an empty query returns all cards. Does not apply the page group or progress filters.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 200 }, mode: { type: 'string', enum: ['smart', 'phrase', 'regex'] }, scope: { type: 'string', enum: ['all', 'title', 'meaning'] } }, required: ['query'], additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input) {
      if (!input || Object.keys(input).some(key => !['query', 'mode', 'scope'].includes(key))) throw new Error('Invalid search input');
      const { query, mode = 'smart', scope = 'all' } = input;
      validateSearch(query, mode, scope);
      const hits = mode === 'regex' && query.trim() ? await runRegexSearch(state.searchIndex, query, scope) : searchLiteral(state.searchIndex, query, { mode: mode === 'regex' ? 'smart' : mode, scope });
      const cards = new Map(state.cards.map(card => [card.id, card]));
      return hits.map(hit => ({ id: hit.id, title: cards.get(hit.id).front, category: cards.get(hit.id).groupName, matchedField: hit.matchLabel }));
    }
  }, {
    name: 'open_grammar_card',
    title: 'Mở thẻ ngữ pháp',
    description: 'Open the front of one grammar flashcard by its ID. Clears the current filters and switches to the flashcard view without changing learning progress.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input) {
      if (!input || typeof input.id !== 'string' || Object.keys(input).some(key => key !== 'id')) throw new Error('id must be a string');
      const index = state.cards.findIndex(card => card.id === input.id);
      if (index < 0) throw new Error('Unknown grammar card');
      state.mode = 'study'; state.view = 'deck'; state.query = ''; state.group = 'all'; state.status = 'ALL';
      state.searchMode = 'smart'; state.searchScope = 'all';
      $('#searchMode').value = 'smart'; $('#searchScope').value = 'all';
      $('#searchInput').value = ''; $('#clearSearch').hidden = true; $('#groupSelect').value = 'all'; $('#statusSelect').value = 'ALL'; $('#menu').hidden = true;
      await applyFilters(); state.index = index; render();
      const card = state.cards[index];
      return { id: card.id, title: card.front, view: 'deck', side: 'front' };
    }
  }];
  for (const tool of tools) {
    try { Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(error => console.warn('Grammar tools unavailable', error)); }
    catch (error) { console.warn('Grammar tools unavailable', error); }
  }
}
function loadProgress() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; } }
function loadQuizHistory() { try { return JSON.parse(localStorage.getItem(QUIZ_HISTORY_KEY)) || {}; } catch { return {}; } }
function saveQuizHistory() { localStorage.setItem(QUIZ_HISTORY_KEY, JSON.stringify(state.quizHistory)); }
function statusOf(card) { return state.progress[card.id] || card.initialStatus || 'NEW'; }
function saveProgress() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress)); updateProgress(); }
function parseSections(back, hint) { return parseCardSections(back, hint); }

function cancelSearch() {
  searchRevision++;
  searchController?.abort();
  searchController = undefined;
}
function updateSearchHelp() {
  const help = {
    smart: 'Có thể gõ tiếng Việt không dấu, hiragana hoặc katakana. Kết quả chứa đủ từ khóa;',
    phrase: 'Tìm các từ đứng liền nhau, đúng thứ tự sau khi chuẩn hóa. Hỗ trợ tiếng Việt không dấu và chữ Nhật khác độ rộng.',
    regex: 'Nhập biểu thức chính quy UnicoSde. Ví dụ: が早いか|や否や'
  };
  $('#searchHelp').textContent = help[state.searchMode];
  $('#searchInput').placeholder = state.searchMode === 'regex' ? 'Ví dụ: が早いか|や否や' : 'Nhập mẫu ngữ pháp hoặc nghĩa, có thể không dấu...';
  $('#searchError').textContent = state.searchError;
  $('#searchError').hidden = !state.searchError;
  $('#searchInput').setAttribute('aria-invalid', String(Boolean(state.searchError)));
  $('#deckView').setAttribute('aria-busy', String(state.searching));
  $('#listView').setAttribute('aria-busy', String(state.searching));
}
function searchEmptyTemplate() {
  if (state.searching) return '<div class="empty"><strong>Đang tìm kiếm…</strong></div>';
  if (state.searchError) return '<div class="empty"><strong>Chưa có kết quả</strong>Sửa nội dung tìm kiếm ở trên để thử lại.</div>';
  return '<div class="empty"><strong>Không tìm thấy thẻ phù hợp</strong>Thử bớt từ khóa, mở rộng phạm vi hoặc đổi bộ lọc.</div>';
}
function matchLabel(card) {
  const hit = state.searchHits.get(card.id);
  return hit?.matchLabel ? `<span class="search-match">Khớp: ${escapeHtml(hit.matchLabel)}</span>` : '';
}

function populateGroups() { const groups = [...new Map(state.cards.map(card => [card.group, card.groupName])).entries()].sort((a, b) => a[1].localeCompare(b[1])); $('#groupSelect').insertAdjacentHTML('beforeend', groups.map(([id, name]) => `<option value="${escapeHtml(id)}">▦ &nbsp; ${escapeHtml(name)}</option>`).join('')); }
function populateQuizGroups() { const groups = [...new Set(state.quizData.map(item => item.category))].sort((a, b) => a.localeCompare(b)); $('#quizGroupSelect').innerHTML = `<option value="all">▦ Tất cả nhóm</option>` + groups.map(group => `<option value="${escapeHtml(group)}">▦ ${escapeHtml(group)}</option>`).join(''); }
function quizItems() { return state.quizData.filter(item => state.quizGroup === 'all' || item.category === state.quizGroup); }
function populateQuizCards() { const items = quizItems(); if (!items.length) return; state.quizCardIndex = Math.min(state.quizCardIndex, items.length - 1); const selected = items[state.quizCardIndex]; $('#quizCardSelect').innerHTML = items.map((item, index) => `<option value="${index}">${String(index + 1).padStart(2, '0')}. ${escapeHtml(item.title)}</option>`).join(''); state.quizCardIndex = items.indexOf(selected) >= 0 ? items.indexOf(selected) : 0; }
function currentQuizItem() { return quizItems()[state.quizCardIndex]; }
function renderQuiz() { populateQuizCards(); const item = currentQuizItem(); if (!item) return; $('#quizGroupSelect').value = state.quizGroup; $('#quizCardSelect').value = String(state.quizCardIndex); $('#quizTarget').textContent = item.title; $('#quizDiff1Field').firstChild.textContent = `3. ${item.diff1Label}`; $('#quizDiff2Field').firstChild.textContent = `4. ${item.diff2Label}`; renderQuizHistory(item); updateAdaptiveStatus(); }
function renderQuizHistory(item) { const history = state.quizHistory[item.id]; const summary = $('#quizHistorySummary'); const panel = $('#quizHistoryPanel'); if (!history) { summary.textContent = 'Chưa có lịch sử làm bài cho mẫu này.'; panel.hidden = true; return; } const wrongAreas = history.wrongAreas.length ? history.wrongAreas.join(', ') : 'Không có'; summary.textContent = `Đã làm ${history.attempts} lần · Cao nhất ${history.bestScore}% · Gần nhất ${history.lastScore}%`; panel.hidden = false; panel.innerHTML = `<h3>Lịch sử & phần cần ôn</h3><p>Lần gần nhất: ${new Date(history.lastAttemptAt).toLocaleString('vi-VN')}</p><p>Phần thường sai: <strong>${escapeHtml(wrongAreas)}</strong></p>`; }
function isDue(history) { return !history?.nextReviewAt || new Date(history.nextReviewAt) <= new Date(); }
function dueQuizItems() { return state.quizData.filter(item => isDue(state.quizHistory[item.id])); }
function updateAdaptiveStatus() { const dueCount = dueQuizItems().length; $('#adaptiveQuizStatus').textContent = `${dueCount} mẫu đến hạn`; }
function chooseAdaptiveQuiz() { const candidates = dueQuizItems(); if (!candidates.length) return showToast('Chưa có mẫu đến hạn để ôn'); const ranked = candidates.sort((left, right) => { const leftHistory = state.quizHistory[left.id]; const rightHistory = state.quizHistory[right.id]; if (!leftHistory && rightHistory) return -1; if (leftHistory && !rightHistory) return 1; return (leftHistory?.bestScore ?? 0) - (rightHistory?.bestScore ?? 0) || (rightHistory?.wrongAreas?.length ?? 0) - (leftHistory?.wrongAreas?.length ?? 0); }); const selected = ranked[0]; state.quizGroup = 'all'; state.quizCardIndex = state.quizData.indexOf(selected); resetQuiz(); }
function resetQuiz() { $('#quizForm').reset(); $('#quizResult').hidden = true; renderQuiz(); }
function quizMatch(answer, expected, minimum = 1) { const normalizedAnswer = answer.toLocaleLowerCase(); const terms = expected.toLocaleLowerCase().match(/[\p{L}\p{N}～〜ーV+-]+/gu)?.filter(term => term.length >= 1) || []; return terms.filter(term => normalizedAnswer.includes(term)).length >= minimum; }
function normalizeAnswer(value) { return value.normalize('NFKC').toLocaleLowerCase().replace(/[。、！？!?，,；;：:「」『』（）()]/g, ' ').replace(/\s+/g, ' ').trim(); }
function scoreKeywordField(answer, keywords, minimumMatches) { const normalizedAnswer = normalizeAnswer(answer); if (!normalizedAnswer) return { score: 0, matched: [], missing: keywords }; const matched = keywords.filter(keyword => normalizedAnswer.includes(normalizeAnswer(keyword))); const missing = keywords.filter(keyword => !matched.includes(keyword)); const required = Math.min(minimumMatches, keywords.length); let score; if (matched.length < required) { score = Math.round(matched.length * 55 / Math.max(1, required)); } else { const remaining = keywords.length - required; score = remaining ? 60 + Math.round((matched.length - required) * 40 / remaining) : 100; } return { score: Math.min(100, score), matched, missing }; }
function evaluateQuiz(event) { event.preventDefault(); const item = currentQuizItem(); const scoring = item.scoring || {}; const answers = { meaning: $('#quizMeaning').value, usage: $('#quizUsage').value, diff1: $('#quizDiff1').value, diff2: $('#quizDiff2').value, example: $('#quizExampleJp').value }; const meaning = scoreKeywordField(answers.meaning, item.meaningKeywords, scoring.meaningMinMatches || 2); const usage = scoreKeywordField(answers.usage, item.usageKeywords, scoring.usageMinMatches || 2); const diff1 = scoreKeywordField(answers.diff1, item.diff1Keywords, scoring.diff1MinMatches || 1); const diff2 = scoreKeywordField(answers.diff2, item.diff2Keywords, scoring.diff2MinMatches || 1); const checks = [{ title: '1. Ý nghĩa', answer: answers.meaning, expected: item.meaningRef, ...meaning }, { title: '2. Cách dùng & cấu trúc', answer: answers.usage, expected: item.usageRef, ...usage }, { title: `3. ${item.diff1Label}`, answer: answers.diff1, expected: item.diff1Ref, ...diff1 }, { title: `4. ${item.diff2Label}`, answer: answers.diff2, expected: item.diff2Ref, ...diff2 }, { title: '5. Câu ví dụ tiếng Nhật', answer: answers.example, expected: item.exampleRef, ...scoreExample(answers.example, item, scoring) }]; const score = Math.round(checks.reduce((sum, check) => sum + check.score, 0) / checks.length); const wrongAreas = checks.filter(check => check.score < 80).map(check => check.title.split('. ')[1] || check.title); const previous = state.quizHistory[item.id] || { attempts: 0, bestScore: 0, lastScore: 0, lastAttemptAt: null, wrongAreas: [], repetitions: 0, intervalDays: 0 }; const passed = score >= 80; const repetitions = passed ? (previous.repetitions || 0) + 1 : 0; const intervalDays = passed ? REVIEW_INTERVALS[Math.min(repetitions - 1, REVIEW_INTERVALS.length - 1)] : 0; const nextReviewAt = new Date(Date.now() + intervalDays * 86400000).toISOString(); state.quizHistory[item.id] = { attempts: previous.attempts + 1, bestScore: Math.max(previous.bestScore, score), lastScore: score, lastAttemptAt: new Date().toISOString(), wrongAreas: [...new Set(wrongAreas)], repetitions, intervalDays, nextReviewAt }; saveQuizHistory(); const result = $('#quizResult'); result.hidden = false; result.innerHTML = `<div class="quiz-score"><strong>${score}%</strong><span>${passed ? `Ôn lại sau ${intervalDays} ngày` : 'Cần ôn lại ngay'}</span></div><h3>Đối chiếu kết quả</h3>${checks.map(check => `<div class="quiz-feedback ${check.score >= 80 ? 'quiz-ok' : 'quiz-warn'}"><strong>${check.score >= 80 ? '✓' : '△'} ${escapeHtml(check.title)} · ${check.score}%</strong><div>${escapeHtml(check.answer)}</div>${check.missing?.length ? `<em>Ý còn thiếu: ${escapeHtml(check.missing.join(', '))}</em>` : '<em>Đã bao phủ các ý chính.</em>'}<em>Đáp án: ${escapeHtml(check.expected || 'Chưa có dữ liệu')}</em></div>`).join('')}`; renderQuizHistory(item); result.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function scoreExample(answer, item, scoring) { const normalizedAnswer = normalizeAnswer(answer); const minLength = scoring.exampleMinLength || 8; if (!normalizedAnswer) return { score: 0, matched: [], missing: ['Câu ví dụ'] }; if (normalizedAnswer.length < minLength) return { score: 25, matched: [], missing: [`Tối thiểu ${minLength} ký tự`] }; if (!/[\u3040-\u30ff\u3400-\u9fff]/u.test(answer)) return { score: 20, matched: [], missing: ['Câu tiếng Nhật'] }; const patterns = item.examplePatterns || []; if (!patterns.length) return { score: 50, matched: [], missing: ['Pattern cần rà soát thủ công'] }; const matched = patterns.filter(pattern => normalizedAnswer.includes(normalizeAnswer(pattern))); return matched.length ? { score: 100, matched, missing: [] } : { score: 30, matched: [], missing: [`Mẫu: ${patterns.join(' / ')}`] }; }
function bindModeEvents() { $('#studyModeButton').addEventListener('click', () => { state.mode = 'study'; $('#menu').hidden = true; render(); }); $('#testModeButton').addEventListener('click', () => { state.mode = 'test'; $('#menu').hidden = true; resetQuiz(); render(); }); $('#adaptiveQuizButton').addEventListener('click', chooseAdaptiveQuiz); $('#quizGroupSelect').addEventListener('change', event => { state.quizGroup = event.target.value; state.quizCardIndex = 0; resetQuiz(); }); $('#quizCardSelect').addEventListener('change', event => { state.quizCardIndex = Number(event.target.value); resetQuiz(); }); $('#quizForm').addEventListener('submit', evaluateQuiz); }
async function applyFilters() {
  clearTimeout(searchInputTimer);
  cancelSearch();
  const revision = searchRevision;
  state.searchError = '';
  state.searchHits = new Map();
  state.index = 0; state.listPage = 1; state.flipped = false;
  const eligible = new Map(state.cards.filter(card => (state.group === 'all' || card.group === state.group) && (state.status === 'ALL' || statusOf(card) === state.status)).map(card => [card.id, card]));
  const index = state.searchIndex.filter(document => eligible.has(document.id));
  try {
    let hits;
    if (state.searchMode === 'regex' && state.query.trim()) {
      state.searching = true; state.filtered = []; state.active = [];
      updateSearchHelp(); render();
      searchController = new AbortController();
      hits = await runRegexSearch(index, state.query, state.searchScope, { signal: searchController.signal });
    } else {
      hits = searchLiteral(index, state.query, { mode: state.searchMode === 'regex' ? 'smart' : state.searchMode, scope: state.searchScope });
    }
    if (revision !== searchRevision) return;
    state.searchHits = new Map(hits.map(hit => [hit.id, hit]));
    state.filtered = hits.map(hit => eligible.get(hit.id));
  } catch (error) {
    if (revision !== searchRevision || error.name === 'AbortError') return;
    state.searchError = error.message;
    state.filtered = [];
  } finally {
    if (revision === searchRevision) {
      state.searching = false; state.active = state.filtered;
      updateSearchHelp(); render();
    }
  }
}

function render() {
  const isStudy = state.mode === 'study';
  $('#progressPanel').hidden = !isStudy; $('#controlsPanel').hidden = !isStudy;
  $('#deckView').hidden = !isStudy || state.view !== 'deck';
  $('#listView').hidden = !isStudy || state.view !== 'list'; $('#quizView').hidden = isStudy;
  if (isStudy) {
    updateProgress();
    $('#resultCount').textContent = state.searching ? 'Đang tìm…' : `${state.filtered.length} thẻ`;
    document.querySelectorAll('[data-view]').forEach(button => {
      button.classList.toggle('active', button.dataset.view === state.view);
      button.setAttribute('aria-selected', String(button.dataset.view === state.view));
    });
    state.view === 'deck' ? renderDeck() : renderList();
  } else renderQuiz();
}

function renderDeck() {
  const card = state.active[state.index];
  if (!card) { $('#deckView').innerHTML = searchEmptyTemplate(); return; }
  const section = parseSections(card.back, card.hint);
  $('#deckView').innerHTML = `<div class="deck-top"><span>Thẻ ${state.index + 1} / ${state.active.length}</span>${matchLabel(card)}${badge(card)}</div>${state.flipped ? backTemplate(card, section) : frontTemplate(card)}<div class="deck-actions"><button data-action="previous">← &nbsp; Trước</button><button class="primary" data-action="flip">↻ &nbsp; Lật thẻ</button><button data-action="next">Tiếp &nbsp; →</button></div>`;
}

function frontTemplate(card) { return `<article class="card" data-action="flip"><div class="card-face"><div class="card-label"><span>MẶT TRƯỚC</span><button class="speak" data-action="speak-front" aria-label="Phát âm">◖</button></div><div class="card-front-content"><h2>${escapeHtml(card.front)}</h2><span class="hint">Chạm vào thẻ để xem chi tiết</span></div><div class="card-footer">${badge(card)}<span class="group">${escapeHtml(card.groupName)}</span></div></div></article>`; }
function backTemplate(card, section) { const detail = [['Nghĩa', section['Nghĩa']], ['Cách chia', section['Cách chia']], ['Câu ví dụ', section['Câu ví dụ']], ['Cách dùng', section['Cách dùng']], ['Phân biệt/lưu ý', section['Phân biệt/lưu ý']]].filter(([, text]) => text); return `<article class="card" data-action="flip"><div class="card-face"><div class="card-label"><span>MẶT SAU · CHI TIẾT</span><button class="speak" data-action="speak-example" aria-label="Phát âm ví dụ">◖</button></div><div class="back-content">${detail.map(([title, text]) => `<div class="detail"><strong>${title.toUpperCase()}</strong><p>${escapeHtml(text || 'Chưa có dữ liệu')}</p></div>`).join('')}</div><div class="back-actions"><button data-action="review">◷ &nbsp; Cần ôn</button><button data-action="mastered">✓ &nbsp; Đã thuộc</button></div></div></article>`; }
function renderList() {
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
  state.listPage = Math.min(state.listPage, totalPages);
  const start = (state.listPage - 1) * PAGE_SIZE;
  const pageCards = state.filtered.slice(start, start + PAGE_SIZE);
  const items = pageCards.map(card => `<button class="list-item" data-card="${escapeHtml(card.id)}"><span><strong>${escapeHtml(card.front)}</strong><p>${escapeHtml(parseSections(card.back, card.hint)['Nghĩa'] || card.hint)}</p>${matchLabel(card)}</span>${badge(card)}</button>`).join('');
  const pagination = state.filtered.length ? `<div class="pagination"><button data-page="first" ${state.listPage === 1 ? 'disabled' : ''}>« Đầu</button><button data-page="previous" ${state.listPage === 1 ? 'disabled' : ''}>← Trước</button><span>Trang ${state.listPage} / ${totalPages}</span><button data-page="next" ${state.listPage === totalPages ? 'disabled' : ''}>Sau →</button><button data-page="last" ${state.listPage === totalPages ? 'disabled' : ''}>Cuối »</button></div>` : '';
  $('#listView').innerHTML = `<h2>DANH SÁCH NGỮ PHÁP</h2>${state.filtered.length ? items + pagination : searchEmptyTemplate()}`;
}

function badge(card) { const status = statusOf(card); const labels = { NEW: '○ Chưa học', REVIEW: '◷ Cần ôn', MASTERED: '✓ Đã thuộc' }; return `<span class="status ${status}">${labels[status] || labels.NEW}</span>`; }
function updateProgress() { const mastered = state.cards.filter(card => statusOf(card) === 'MASTERED').length; const review = state.cards.filter(card => statusOf(card) === 'REVIEW').length; const total = state.cards.length; const percent = total ? Math.round(mastered * 100 / total) : 0; $('#masteredCount').textContent = mastered; $('#reviewCount').textContent = review; $('#newCount').textContent = Math.max(0, total - mastered - review); $('#progressText').textContent = `${mastered} / ${total} · ${percent}%`; $('#progressValue').style.width = `${percent}%`; }
function speak(text) { if (!('speechSynthesis' in window)) return showToast('Safari không hỗ trợ phát âm trên thiết bị này'); speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'ja-JP'; utterance.rate = .45; speechSynthesis.speak(utterance); }
async function setStatus(status) {
  const card = state.active[state.index];
  if (!card) return;
  const previousIndex = state.index;
  state.progress[card.id] = status; saveProgress();
  await applyFilters();
  const retainedIndex = state.active.findIndex(item => item.id === card.id);
  state.index = retainedIndex >= 0 ? retainedIndex : Math.min(previousIndex, Math.max(0, state.active.length - 1));
  render();
  showToast(status === 'MASTERED' ? 'Đã đánh dấu đã thuộc' : 'Đã đưa vào danh sách cần ôn');
}

function escapeHtml(value = '') { return value.replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char])); }
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800); }
function bindEvents() {
  let composing = false;
  const scheduleSearch = () => {
    state.query = $('#searchInput').value;
    $('#clearSearch').hidden = !state.query;
    clearTimeout(searchInputTimer); cancelSearch();
    searchInputTimer = setTimeout(() => applyFilters(), 120);
  };
  $('#searchInput').addEventListener('compositionstart', () => { composing = true; clearTimeout(searchInputTimer); cancelSearch(); });
  $('#searchInput').addEventListener('compositionend', () => { composing = false; scheduleSearch(); });
  $('#searchInput').addEventListener('input', event => { if (!composing && !event.isComposing) scheduleSearch(); });
  $('#clearSearch').addEventListener('click', () => { $('#searchInput').value = ''; state.query = ''; $('#clearSearch').hidden = true; applyFilters(); $('#searchInput').focus(); });
  $('#searchMode').addEventListener('change', event => { state.searchMode = event.target.value; updateSearchHelp(); applyFilters(); });
  $('#searchScope').addEventListener('change', event => { state.searchScope = event.target.value; applyFilters(); });
  $('#groupSelect').addEventListener('change', event => { state.group = event.target.value; applyFilters(); });
  $('#statusSelect').addEventListener('change', event => { state.status = event.target.value; applyFilters(); });
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.view; render(); }));
  $('#menuButton').addEventListener('click', () => { $('#menu').hidden = !$('#menu').hidden; });
  $('#shuffleButton').addEventListener('click', () => { state.active = [...state.filtered].sort(() => Math.random() - .5); state.index = 0; state.flipped = false; $('#menu').hidden = true; renderDeck(); });
  $('#resetButton').addEventListener('click', () => { if (!confirm('Đặt lại toàn bộ tiến độ về Chưa học?')) return; state.progress = {}; saveProgress(); $('#menu').hidden = true; applyFilters(); });
  $('#deckView').addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action || !state.active.length) return;
    if (action === 'flip') { state.flipped = !state.flipped; renderDeck(); }
    if (action === 'next') { state.index = (state.index + 1) % state.active.length; state.flipped = false; renderDeck(); }
    if (action === 'previous') { state.index = (state.index - 1 + state.active.length) % state.active.length; state.flipped = false; renderDeck(); }
    if (action === 'review') setStatus('REVIEW');
    if (action === 'mastered') setStatus('MASTERED');
    if (action === 'speak-front') speak(state.active[state.index].front);
    if (action === 'speak-example') { const sections = parseSections(state.active[state.index].back, ''); speak(sections['Câu ví dụ'] || state.active[state.index].front); }
  });
  $('#listView').addEventListener('click', event => {
    const pageButton = event.target.closest('[data-page]');
    if (pageButton && !pageButton.disabled) {
      const totalPages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
      if (pageButton.dataset.page === 'first') state.listPage = 1;
      if (pageButton.dataset.page === 'previous') state.listPage -= 1;
      if (pageButton.dataset.page === 'next') state.listPage += 1;
      if (pageButton.dataset.page === 'last') state.listPage = totalPages;
      renderList(); return;
    }
    const button = event.target.closest('[data-card]');
    if (!button) return;
    const index = state.active.findIndex(card => card.id === button.dataset.card);
    if (index < 0) return;
    state.index = index; state.flipped = true; state.view = 'deck'; render();
  });
}

boot();
