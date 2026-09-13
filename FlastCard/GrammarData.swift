import Foundation

struct Flashcard: Identifiable, Codable {
    let id: String
    let front: String
    let back: String
    let hint: String
    let initialStatus: String
    let group: String
    let groupName: String

    var meaning: String { section(named: "Nghĩa") }
    var example: String { section(named: "Câu ví dụ") }
    var conjugation: String { section(named: "Cách chia") }
    var usage: String { section(named: "Cách dùng") }
    var distinction: String { section(named: "Phân biệt/lưu ý") }

    private func section(named name: String) -> String {
        let marker = "- \(name):"
        guard let start = back.range(of: marker) else { return name == "Nghĩa" ? hint : "" }
        let remainder = back[start.upperBound...]
        let nextSection = remainder.range(of: "\n- ")
        let value = nextSection.map { String(remainder[..<$0.lowerBound]) } ?? String(remainder)
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

private struct FlashcardSource: Decodable {
    struct Entry: Decodable {
        struct Part: Decodable {
            let text: String
        }

        let front: Part
        let back: Part
        let hint: Part
        let sortingTag: String
        let group: String
        let groupName: String

        enum CodingKeys: String, CodingKey {
            case front, back, hint, group, groupName
            case sortingTag = "sorting_tag"
        }
    }

    let flashcards: [Entry]
}

enum FlashcardStore {
    static func load() -> [Flashcard] {
        guard let url = Bundle.main.url(forResource: "grammar", withExtension: "json") else {
            fatalError("grammar.json is missing from the app bundle")
        }

        do {
            let data = try Data(contentsOf: url)
            let source = try JSONDecoder().decode(FlashcardSource.self, from: data)
            return source.flashcards.enumerated().map { index, entry in
                Flashcard(id: "flashcard-\(index)", front: entry.front.text, back: entry.back.text, hint: entry.hint.text, initialStatus: entry.sortingTag, group: entry.group, groupName: entry.groupName)
            }
        } catch {
            fatalError("Could not decode grammar.json: \(error)")
        }
    }
}

let flashcards = FlashcardStore.load()
