/** Convert the supplied id-keyed Taiwanese Mandarin dataset into view models.
 *  This adapter never invents example sentences, recordings or character meanings.
 */
export function buildStudyCards(source) {
  const cards = [];
  const lessons = source.lessons || {};
  for (const lessonId of source.dataset?.lesson_order || Object.keys(lessons)) {
    const lesson = lessons[lessonId];
    if (!lesson) continue;
    for (const section of lesson.sections || []) {
      for (const entryId of section.entry_ids || []) {
        const entry = source.entries?.[entryId];
        const sense = source.senses?.[entry?.sense_id];
        const word = source.words?.[sense?.word_id];
        if (!sense || !word) continue;
        const characters = (word.character_breakdown || []).map(part => ({
          character: source.characters?.[part.character_id]?.character || '',
          hanViet: part.han_viet || '',
          contextMeaning: part.context_meaning_vi || ''
        })).filter(part => part.character);
        const relationships = (sense.relation_ids || []).map(id => source.relations?.[id]).filter(Boolean);
        const related = relationships.map(link => {
          const targetId = link.from_sense_id === entry.sense_id ? link.to_sense_id : link.from_sense_id;
          const target = source.senses?.[targetId];
          const targetWord = source.words?.[target?.word_id];
          return target && targetWord ? { word: targetWord.traditional, meaning: target.meaning_vi_short || target.meaning_vi, type: link.type } : null;
        }).filter(Boolean);
        const examples = (sense.example_ids || []).map(id => source.examples?.[id]).filter(Boolean);
        const measureWords = (sense.measure_word_ids || []).map(id => source.words?.[id]?.traditional).filter(Boolean);
        const pos = (sense.part_of_speech || []).map(code => source.part_of_speech?.[code]?.label_vi || code);
        cards.push({
          id: entryId, senseId: entry.sense_id, wordId: sense.word_id,
          front: word.traditional, zhuyin: word.zhuyin || '', pinyin: word.pinyin || '',
          audioUrl: word.audio_url || null, ttsOverride: word.tts_override || '',
          meaning: sense.meaning_vi_short || sense.meaning_vi || '',
          meaningFull: sense.meaning_vi || '', hanViet: word.han_viet || '',
          pos, characters, measureWords, usage: sense.usage_vi || '', related,
          examples, variants: word.variants || [],
          group: lessonId, groupName: `Bài ${String(lesson.number).padStart(2, '0')} · ${lesson.title_vi}`,
          section: section.label_vi, sectionOrder: entry.section_order,
          initialStatus: 'NEW'
        });
      }
    }
  }
  return cards;
}

/** Derived quiz references; no Japanese N1 data and no manufactured sentences. */
export function buildVocabularyQuiz(cards) {
  const seen = new Set();
  return cards.filter(card => { if (seen.has(card.senseId)) return false; seen.add(card.senseId); return true; })
    .map(card => ({
      id: card.senseId, title: card.front, category: card.groupName,
      meaningRef: card.meaningFull, hanVietRef: card.hanViet,
      posRef: card.pos.join(', '),
      charsRef: card.characters.map(part => `${part.character} — ${part.hanViet}`).join(' · '),
      exampleRef: card.examples[0]?.traditional || null,
      exampleTranslation: card.examples[0]?.meaning_vi || null
    }));
}
