// Translates with Apple's Translation framework for irodr-local.
//
// Reads one JSON request per line from stdin and writes one JSON response per line to stdout:
//
//     → {"id":1,"texts":["Hello"],"sourceLanguage":"en","targetLanguage":"ja"}
//     ← {"id":1,"texts":["こんにちは"]}   or   {"id":1,"error":"..."}
//
// Translation runs on device with the language packages installed in System Settings.
// TranslationSession(installedSource:target:) needs no UI (macOS 26), as in hotchpotch/trn.
// Requests are translated concurrently; responses may come back in any order and are matched by id.
import Foundation
import Translation

struct TranslateRequest: Decodable {
    let id: Int
    let texts: [String]
    let sourceLanguage: String
    let targetLanguage: String
}

struct TranslateSuccess: Encodable {
    let id: Int
    let texts: [String]
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

func translate(_ request: TranslateRequest) async throws -> [String] {
    let translator = try await session(from: request.sourceLanguage, to: request.targetLanguage)
    let batch = request.texts.enumerated().map { index, text in
        TranslationSession.Request(sourceText: text, clientIdentifier: String(index))
    }
    let responses = try await translator.translations(from: batch)
    // Responses are matched by identifier, not by order.
    var results = request.texts
    for response in responses {
        if let identifier = response.clientIdentifier, let index = Int(identifier), results.indices.contains(index) {
            results[index] = response.targetText
        }
    }
    return results
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
    guard let request = try? decoder.decode(TranslateRequest.self, from: Data(line.utf8)) else {
        FileHandle.standardError.write(Data("irodr-translate: invalid request\n".utf8))
        continue
    }
    Task {
        do {
            let texts = try await translate(request)
            await output.write(encodeLine(TranslateSuccess(id: request.id, texts: texts)))
        } catch {
            await output.write(encodeLine(TranslateFailure(id: request.id, error: String(describing: error))))
        }
    }
}
