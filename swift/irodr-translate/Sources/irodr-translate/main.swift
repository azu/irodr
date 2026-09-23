// Translates with Apple's Translation framework for irodr-local.
//
// Reads one JSON request per line from stdin and writes one JSON response per line to stdout:
//
//     → {"id":1,"texts":["Hello"],"sourceLanguage":"en","targetLanguage":"ja"}
//     ← {"id":1,"texts":["こんにちは"]}   or   {"id":1,"error":"..."}
//
// Paragraphs with inline markup come as segments of runs; a run's tag names the element around it:
//
//     → {"id":2,"segments":[{"runs":[{"text":"Read "},{"text":"the docs","tag":0}]}],"sourceLanguage":"en",...}
//     ← {"id":2,"segments":[{"runs":[{"text":"ドキュメント","tag":0},{"text":"を読む"}]}]}
//
// Each segment is translated as one attributed string, so the framework moves the tags (links) with
// the words they are on, wherever the word order puts them (macOS 26.4+).
//
// Translation runs on device with the language packages installed in System Settings.
// TranslationSession(installedSource:target:) needs no UI (macOS 26), as in hotchpotch/trn.
// Requests are translated concurrently; responses may come back in any order and are matched by id.
import Foundation
import Translation

struct Run: Codable {
    let text: String
    var tag: Int? = nil
    var skip: Bool? = nil
}

struct Segment: Codable {
    let runs: [Run]
}

struct TranslateRequest: Decodable {
    let id: Int
    let texts: [String]?
    let segments: [Segment]?
    let sourceLanguage: String
    let targetLanguage: String
}

struct TranslateSuccess: Encodable {
    let id: Int
    var texts: [String]? = nil
    var segments: [Segment]? = nil
}

/// Enough of a request to answer one that could not be decoded.
struct RequestID: Decodable {
    let id: Int
}

struct TranslateFailure: Encodable {
    let id: Int
    let error: String
}

enum HelperError: Error, CustomStringConvertible {
    case unsupportedPair(String, String)
    case notInstalled(String, String)

    var description: String {
        switch self {
        case let .unsupportedPair(source, target):
            "Unsupported language pair: \(source) -> \(target)"
        case let .notInstalled(source, target):
            "The language package is not installed: \(source) -> \(target). Install it in System Settings > General > Language & Region > Translation Languages."
        }
    }
}

/// A session per request, as hotchpotch/trn does, so no state is shared across concurrency domains.
func session(from sourceCode: String, to targetCode: String) async throws -> TranslationSession {
    let source = Locale.Language(identifier: sourceCode)
    let target = Locale.Language(identifier: targetCode)
    switch await LanguageAvailability().status(from: source, to: target) {
    case .installed:
        // The traditional models: about 10x faster than Apple Intelligence's high fidelity models in
        // hotchpotch/trn's measurements (translation-quality-check.md), and good enough for reading.
        if #available(macOS 26.4, *) {
            return TranslationSession(installedSource: source, target: target, preferredStrategy: .lowLatency)
        }
        return TranslationSession(installedSource: source, target: target)
    case .supported:
        throw HelperError.notInstalled(sourceCode, targetCode)
    case .unsupported:
        throw HelperError.unsupportedPair(sourceCode, targetCode)
    @unknown default:
        throw HelperError.unsupportedPair(sourceCode, targetCode)
    }
}

func translate(texts: [String], with translator: TranslationSession) async throws -> [String] {
    let batch = texts.enumerated().map { index, text in
        TranslationSession.Request(sourceText: text, clientIdentifier: String(index))
    }
    let responses = try await translator.translations(from: batch)
    // Responses are matched by identifier, not by order.
    var results = texts
    for response in responses {
        if let identifier = response.clientIdentifier, let index = Int(identifier), results.indices.contains(index) {
            results[index] = response.targetText
        }
    }
    return results
}

/// Tags travel as links, which the framework keeps on the translated words.
let tagScheme = "irodr-tag"

@available(macOS 26.4, *)
func attributedString(_ segment: Segment) -> AttributedString {
    var result = AttributedString()
    for run in segment.runs {
        var part = AttributedString(run.text)
        if let tag = run.tag { part.link = URL(string: "\(tagScheme):\(tag)") }
        if run.skip == true { part.skipsTranslation = true }
        result.append(part)
    }
    return result
}

@available(macOS 26.4, *)
func translatedSegment(_ attributed: AttributedString) -> Segment {
    Segment(runs: attributed.runs.map { run in
        let text = String(attributed[run.range].characters)
        guard let link = run.link, link.scheme == tagScheme, let tag = Int(link.absoluteString.dropFirst(tagScheme.count + 1)) else {
            return Run(text: text)
        }
        return Run(text: text, tag: tag)
    })
}

func translate(segments: [Segment], with translator: TranslationSession) async throws -> [Segment] {
    guard #available(macOS 26.4, *) else {
        // Without formatted translation, each paragraph is still one sentence, without its markup.
        let texts = segments.map { $0.runs.map(\.text).joined() }
        return try await translate(texts: texts, with: translator).map { Segment(runs: [Run(text: $0)]) }
    }
    let batch = segments.enumerated().map { index, segment in
        TranslationSession.Request(sourceText: attributedString(segment), clientIdentifier: String(index))
    }
    let responses = try await translator.translations(from: batch)
    var results = segments
    for response in responses {
        guard let identifier = response.clientIdentifier, let index = Int(identifier), results.indices.contains(index) else {
            continue
        }
        results[index] = response.attributedTargetText.map(translatedSegment) ?? Segment(runs: [Run(text: response.targetText)])
    }
    return results
}

func translate(_ request: TranslateRequest) async throws -> TranslateSuccess {
    let translator = try await session(from: request.sourceLanguage, to: request.targetLanguage)
    if let segments = request.segments {
        return TranslateSuccess(id: request.id, segments: try await translate(segments: segments, with: translator))
    }
    return TranslateSuccess(id: request.id, texts: try await translate(texts: request.texts ?? [], with: translator))
}

func encodeLine<T: Encodable>(_ value: T) -> Data {
    var data = (try? JSONEncoder().encode(value)) ?? Data("{}".utf8)
    data.append(0x0A)
    return data
}

/// Serializes writes so concurrent responses never interleave on a line.
actor Output {
    func write(_ line: Data) {
        // FileHandle writes are unbuffered, unlike print() to a pipe.
        FileHandle.standardOutput.write(line)
    }
}

let output = Output()
let decoder = JSONDecoder()
for try await line in FileHandle.standardInput.bytes.lines {
    let data = Data(line.utf8)
    let request: TranslateRequest
    do {
        request = try decoder.decode(TranslateRequest.self, from: data)
    } catch {
        // Answer it anyway, so the caller does not wait for a response that never comes.
        FileHandle.standardError.write(Data("irodr-translate: invalid request: \(error)\n".utf8))
        if let id = try? decoder.decode(RequestID.self, from: data).id {
            await output.write(encodeLine(TranslateFailure(id: id, error: "Invalid request: \(error)")))
        }
        continue
    }
    Task {
        do {
            let success = try await translate(request)
            await output.write(encodeLine(success))
        } catch {
            await output.write(encodeLine(TranslateFailure(id: request.id, error: String(describing: error))))
        }
    }
}
