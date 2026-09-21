import { parseCardSections } from './search.js';

export function buildStudyCards(source, quizData) {
  const quizByTitle = new Map(quizData.map(entry => [entry.title, entry]));
  return source.flashcards.map((entry, index) => {
    const quiz = quizByTitle.get(entry.front.text);
    const sections = parseCardSections(entry.back.text, entry.hint.text);
    const fallbacks = {
      'Nghĩa': quiz?.meaningRef,
      'Câu ví dụ': quiz?.exampleRef,
      'Cách dùng': quiz?.usageRef,
      'Phân biệt/lưu ý': quiz ? `${quiz.diff1Label}\n${quiz.diff1Ref}\n\n${quiz.diff2Label}\n${quiz.diff2Ref}` : ''
    };
    // Keep every supplied flashcard section, supplementing only absent sections
    // from its matching quiz record. Do not infer conjugation rules.
    const supplements = Object.entries(fallbacks).filter(([key, value]) => !sections[key] && value);
    const back = [entry.back.text, ...supplements.map(([key, value]) => `- ${key}: ${value}`)].join('\n');
    return {
      id: quiz?.id || `flashcard-${index}`,
      front: entry.front.text, back, hint: entry.hint.text || quiz?.meaningRef || '',
      initialStatus: entry.sorting_tag || 'NEW', group: entry.group, groupName: entry.groupName
    };
  });
}