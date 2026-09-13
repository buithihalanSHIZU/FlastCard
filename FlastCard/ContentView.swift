import AVFoundation
import SwiftData
import SwiftUI

struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Item.createdAt, order: .reverse) private var progressItems: [Item]

    @State private var viewMode: ViewMode = .deck
    @State private var activeCards = flashcards
    @State private var currentIndex = 0
    @State private var isFlipped = false
    @State private var searchText = ""
    @State private var statusFilter: CardStatus = .all
    @State private var selectedGroupID = "all"
    @State private var selectedCardID: String?
    @State private var showingResetAlert = false
    @State private var speechSynthesizer = AVSpeechSynthesizer()

    private var currentCard: Flashcard? {
        guard activeCards.indices.contains(currentIndex) else { return nil }
        return activeCards[currentIndex]
    }

    private var filteredCards: [Flashcard] {
        flashcards.filter { card in
            let matchesSearch = searchText.isEmpty || card.front.localizedCaseInsensitiveContains(searchText) || card.back.localizedCaseInsensitiveContains(searchText)
            let matchesStatus = statusFilter == .all || status(for: card) == statusFilter.rawValue
            let matchesGroup = selectedGroupID == "all" || card.group == selectedGroupID
            return matchesSearch && matchesStatus && matchesGroup
        }
    }

    private var groupOptions: [(id: String, name: String)] {
        Dictionary(grouping: flashcards, by: { $0.group })
            .compactMap { groupID, cards in
                guard let name = cards.first?.groupName else { return nil }
                return (id: groupID, name: name)
            }
            .sorted { $0.name < $1.name }
    }

    private var masteredCount: Int { flashcards.filter { status(for: $0) == CardStatus.mastered.rawValue }.count }
    private var reviewCount: Int { flashcards.filter { status(for: $0) == CardStatus.review.rawValue }.count }
    private var newCount: Int { flashcards.count - masteredCount - reviewCount }
    private var progressPercent: Int { flashcards.isEmpty ? 0 : masteredCount * 100 / flashcards.count }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    appHeader
                    progressCard
                    controlsCard
                    if viewMode == .deck {
                        deckView
                    } else {
                        listView
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 28)
            }
            .background(
                LinearGradient(
                    colors: [Color(.systemGroupedBackground), Color(.systemBackground)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .navigationTitle("JLPT N1")
            .navigationBarTitleDisplayMode(.inline)
        }
        .alert("Đặt lại tiến độ?", isPresented: $showingResetAlert) {
            Button("Hủy", role: .cancel) { }
            Button("Đặt lại", role: .destructive, action: resetProgress)
        } message: {
            Text("Toàn bộ trạng thái thẻ sẽ trở về Chưa học.")
        }
        .onChange(of: searchText) { _, _ in applyFilters() }
        .onChange(of: statusFilter) { _, _ in applyFilters() }
        .onChange(of: selectedGroupID) { _, _ in applyFilters() }
    }

    private var appHeader: some View {
        HStack(spacing: 12) {
            Text("N1")
                .font(.system(size: 22, weight: .black, design: .rounded))
                .foregroundStyle(.white)
                .frame(width: 50, height: 50)
                .background(
                    LinearGradient(
                        colors: [Color.red, Color.red.opacity(0.75)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

            VStack(alignment: .leading, spacing: 3) {
                Text("JLPT N1 Grammar")
                    .font(.headline)
                    .fontWeight(.bold)
                Text("141 mẫu ngữ pháp trọng điểm")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Menu {
                Button("Xáo trộn", systemImage: "shuffle", action: shuffleCards)
                Button("Đặt lại tiến độ", systemImage: "arrow.counterclockwise", action: { showingResetAlert = true })
            } label: {
                Image(systemName: "ellipsis.circle.fill")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
            .accessibilityLabel("Tùy chọn")
        }
        .padding(16)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(Color.secondary.opacity(0.15), lineWidth: 1)
        )
    }

    private var progressCard: some View {
        VStack(spacing: 12) {
            HStack {
                Text("TIẾN ĐỘ HỌC TẬP")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(masteredCount) / \(flashcards.count) · \(progressPercent)%")
                    .font(.caption.bold())
                    .foregroundStyle(.red)
            }

            ProgressView(value: Double(progressPercent), total: 100)
                .tint(.red)
                .scaleEffect(x: 1, y: 1.2, anchor: .center)

            HStack(spacing: 8) {
                statItem(value: masteredCount, label: "Đã thuộc", color: .green)
                statItem(value: reviewCount, label: "Cần ôn", color: .orange)
                statItem(value: newCount, label: "Chưa học", color: .secondary)
            }
        }
        .padding(16)
        .background(.background, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: .black.opacity(0.04), radius: 8, y: 3)
    }

    private func statItem(value: Int, label: String, color: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(value)").font(.headline).foregroundStyle(color)
            Text(label).font(.caption2).foregroundStyle(color)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(color.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
    }

    private var controlsCard: some View {
        VStack(spacing: 12) {
            Picker("Chế độ xem", selection: $viewMode) {
                ForEach(ViewMode.allCases, id: \.self) { mode in
                    Label(mode.title, systemImage: mode.icon).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Tìm mẫu ngữ pháp hoặc nghĩa...", text: $searchText)
                    .textInputAutocapitalization(.never)
                if !searchText.isEmpty {
                    Button("Xóa", systemImage: "xmark.circle.fill") { searchText = "" }
                        .labelStyle(.iconOnly)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(11)
            .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))

            HStack {
                Menu {
                    Button("Tất cả nhóm") { selectedGroupID = "all" }
                    ForEach(groupOptions, id: \.id) { group in
                        Button(group.name) { selectedGroupID = group.id }
                    }
                } label: {
                    Label(selectedGroupName, systemImage: "square.grid.2x2")
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                }
                .buttonStyle(.bordered)
                Spacer()
            }

            HStack {
                Menu {
                    ForEach(CardStatus.allCases, id: \.self) { status in
                        Button {
                            statusFilter = status
                        } label: {
                            Label(status.title, systemImage: status.icon)
                        }
                    }
                } label: {
                    Label(statusFilter.title, systemImage: statusFilter.icon)
                        .font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.bordered)
                Spacer()
                Text("\(filteredCards.count) thẻ")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .background(.background, in: RoundedRectangle(cornerRadius: 20))
    }

    private var selectedGroupName: String {
        guard selectedGroupID != "all" else { return "Tất cả nhóm" }
        return groupOptions.first(where: { $0.id == selectedGroupID })?.name ?? "Tất cả nhóm"
    }

    private var deckView: some View {
        VStack(spacing: 14) {
            if let card = currentCard {
                HStack {
                    Text("Thẻ \(currentIndex + 1) / \(activeCards.count)")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                    Spacer()
                    statusBadge(for: card)
                }

                flashcard(card)

                HStack(spacing: 10) {
                    deckButton("arrow.left", title: "Trước", action: previousCard)

                    Button(action: flipCard) {
                        Label("Lật thẻ", systemImage: "arrow.triangle.2.circlepath")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.black)

                    deckButton("arrow.right", title: "Tiếp", action: nextCard)
                }
            } else {
                emptyState
            }
        }
    }

    private func flashcard(_ card: Flashcard) -> some View {
        VStack(spacing: 0) {
            if isFlipped {
                cardBack(card)
            } else {
                cardFront(card)
            }
        }
        .frame(minHeight: 430)
        .frame(maxWidth: .infinity)
        .background(
            LinearGradient(
                colors: [Color(.systemBackground), Color.red.opacity(0.04)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .stroke(Color.red.opacity(0.12), lineWidth: 1.5)
        )
        .shadow(color: .black.opacity(0.08), radius: 14, y: 7)
        .rotation3DEffect(.degrees(isFlipped ? 180 : 0), axis: (x: 0, y: 1, z: 0))
        .contentShape(Rectangle())
        .onTapGesture(perform: flipCard)
        .animation(.easeInOut(duration: 0.35), value: isFlipped)
    }

    private func cardFront(_ card: Flashcard) -> some View {
        VStack(spacing: 18) {
            HStack {
                Text("MẶT TRƯỚC")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                Spacer()
                Button(action: { speak(card.front) }) {
                    Image(systemName: "speaker.wave.2.fill")
                        .frame(width: 40, height: 40)
                }
                .buttonStyle(.bordered)
            }

            Spacer()

            Text(card.front)
                .font(.system(size: 34, weight: .black, design: .rounded))
                .multilineTextAlignment(.center)
                .foregroundStyle(.primary)
                .lineLimit(4)

            Text("Chạm để lật thẻ")
                .font(.caption)
                .foregroundStyle(.secondary)

            Spacer()

            HStack {
                statusBadge(for: card)
                Spacer()
                Text(card.groupName)
                    .font(.caption2.bold())
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(Color.secondary.opacity(0.09), in: Capsule())
            }
        }
        .padding(24)
    }

    private func cardBack(_ card: Flashcard) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("MẶT SAU • CHI TIẾT")
                    .font(.caption.bold())
                    .foregroundStyle(.red)
                Spacer()
                Button(action: { speak(card.example) }) {
                    Image(systemName: "speaker.wave.2.fill")
                }
                .buttonStyle(.bordered)
            }

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    detailBlock("Ý nghĩa", card.meaning, color: .primary)
                    detailBlock("Cách chia", card.conjugation, color: .red)
                    detailBlock("Câu ví dụ", card.example, color: .red)
                    detailBlock("Cách dùng", card.usage, color: .primary)
                    detailBlock("Phân biệt / lưu ý", card.distinction, color: .orange)
                }
            }
            .frame(maxHeight: 220)

            HStack(spacing: 10) {
                Button { setStatus(.review, for: card) } label: {
                    Label("Cần ôn", systemImage: "clock.arrow.circlepath")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(.orange)

                Button { setStatus(.mastered, for: card) } label: {
                    Label("Đã thuộc", systemImage: "checkmark")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
            }
        }
        .padding(20)
        .rotation3DEffect(.degrees(180), axis: (x: 0, y: 1, z: 0))
    }

    private func detailBlock(_ title: String, _ text: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title.uppercased())
                .font(.caption2.bold())
                .foregroundStyle(color)
            Text(text.isEmpty ? "Chưa có dữ liệu" : text)
                .font(.subheadline)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(11)
        .background(color.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
    }

    private var listView: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("DANH SÁCH NGỮ PHÁP")
                .font(.caption.bold())
                .foregroundStyle(.secondary)

            if filteredCards.isEmpty {
                emptyState
            } else {
                ForEach(filteredCards) { card in
                    Button {
                        selectedCardID = card.id
                        activeCards = filteredCards
                        currentIndex = activeCards.firstIndex(where: { $0.id == card.id }) ?? 0
                        isFlipped = true
                        viewMode = .deck
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(card.front)
                                    .font(.headline)
                                    .foregroundStyle(.primary)
                                Text(card.meaning)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }

                            Spacer()

                            statusBadge(for: card)
                        }
                        .padding(14)
                        .background(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(Color(.secondarySystemBackground))
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "rectangle.stack.badge.questionmark")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text("Không tìm thấy thẻ phù hợp")
                .font(.headline)
            Text("Thử đổi từ khóa hoặc bộ lọc.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(40)
        .background(.background, in: RoundedRectangle(cornerRadius: 20))
    }

    private func deckButton(_ icon: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
    }

    private func statusBadge(for card: Flashcard) -> some View {
        let cardStatus = CardStatus(rawValue: status(for: card)) ?? .new
        return Label(cardStatus.title, systemImage: cardStatus.icon)
            .font(.caption2.bold())
            .foregroundStyle(cardStatus.color)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(cardStatus.color.opacity(0.12), in: Capsule())
    }

    private func status(for card: Flashcard) -> String {
        progressItems.first(where: { $0.grammarID == card.id })?.status ?? card.initialStatus
    }

    private func setStatus(_ newStatus: CardStatus, for card: Flashcard) {
        if let item = progressItems.first(where: { $0.grammarID == card.id }) {
            item.status = newStatus.rawValue
            item.createdAt = .now
        } else {
            modelContext.insert(Item(grammarID: card.id, meaning: "", usage: "", differenceOne: "", differenceTwo: "", example: "", score: 0, status: newStatus.rawValue))
        }
        isFlipped = false
    }

    private func applyFilters() {
        activeCards = filteredCards
        currentIndex = 0
        isFlipped = false
    }

    private func flipCard() {
        guard currentCard != nil else { return }
        isFlipped.toggle()
    }

    private func nextCard() {
        guard !activeCards.isEmpty else { return }
        currentIndex = (currentIndex + 1) % activeCards.count
        isFlipped = false
    }

    private func previousCard() {
        guard !activeCards.isEmpty else { return }
        currentIndex = (currentIndex - 1 + activeCards.count) % activeCards.count
        isFlipped = false
    }

    private func shuffleCards() {
        activeCards.shuffle()
        currentIndex = 0
        isFlipped = false
    }

    private func resetProgress() {
        for item in progressItems {
            modelContext.delete(item)
        }
        activeCards = filteredCards
        currentIndex = 0
        isFlipped = false
    }

    private func speak(_ text: String) {
        speechSynthesizer.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "ja-JP")
        utterance.rate = 0.45
        speechSynthesizer.speak(utterance)
    }
}

enum ViewMode: CaseIterable {
    case deck, list

    var title: String { self == .deck ? "Thẻ lật" : "Danh sách" }
    var icon: String { self == .deck ? "rectangle.stack" : "list.bullet" }
}

enum CardStatus: String, CaseIterable {
    case all = "ALL"
    case new = "NEW"
    case review = "REVIEW"
    case mastered = "MASTERED"

    var title: String {
        switch self {
        case .all: "Tất cả trạng thái"
        case .new: "Chưa học"
        case .review: "Cần ôn lại"
        case .mastered: "Đã thuộc"
        }
    }

    var icon: String {
        switch self {
        case .all: "line.3.horizontal.decrease.circle"
        case .new: "circle"
        case .review: "clock.arrow.circlepath"
        case .mastered: "checkmark.circle.fill"
        }
    }

    var color: Color {
        switch self {
        case .all: .secondary
        case .new: .secondary
        case .review: .orange
        case .mastered: .green
        }
    }
}

#Preview {
    ContentView()
        .modelContainer(for: Item.self, inMemory: true)
}
