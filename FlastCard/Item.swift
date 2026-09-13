//
//  Item.swift
//  FlastCard
//
//  Created by kasumi Ari on 2026/09/12.
//

import Foundation
import SwiftData

@Model
final class Item {
    var grammarID: String
    var meaning: String
    var usage: String
    var differenceOne: String
    var differenceTwo: String
    var example: String
    var score: Int
    var createdAt: Date
    var status: String

    init(
        grammarID: String,
        meaning: String,
        usage: String,
        differenceOne: String,
        differenceTwo: String,
        example: String,
        score: Int,
        status: String = "NEW",
        createdAt: Date = .now
    ) {
        self.grammarID = grammarID
        self.meaning = meaning
        self.usage = usage
        self.differenceOne = differenceOne
        self.differenceTwo = differenceTwo
        self.example = example
        self.score = score
        self.status = status
        self.createdAt = createdAt
    }
}
