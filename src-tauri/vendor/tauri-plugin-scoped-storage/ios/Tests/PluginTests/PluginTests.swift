import XCTest
@testable import tauri_plugin_scoped_storage

final class ExamplePluginTests: XCTestCase {
    func testPathSplitRejectsParents() {
        XCTAssertThrowsError(try ScopedStoragePath.split("../secret.txt"))
    }

    func testPathJoinNormalizesSeparators() throws {
        XCTAssertEqual(ScopedStoragePath.join("docs/", "/notes.txt"), "docs/notes.txt")
    }

    func testFolderStorePersistsAndListsEntries() throws {
        let suiteName = "ScopedStoragePluginTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        let store = IOSFolderStore(
            defaults: defaults,
            bookmarkPrefix: "bookmark.",
            namePrefix: "name.",
            uriPrefix: "uri."
        )

        let stored = store.save(bookmark: Data([1, 2, 3]), name: "Docs", uri: "file:///tmp/docs")
        XCTAssertEqual(store.getInfo(id: stored.id)?.name, "Docs")
        XCTAssertEqual(store.list().count, 1)

        store.remove(id: stored.id)
        XCTAssertTrue(store.list().isEmpty)
        defaults.removePersistentDomain(forName: suiteName)
    }
}
