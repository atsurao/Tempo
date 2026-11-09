package com.danielerolli.tauri.scopedstorage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ExampleUnitTest {
    @Test
    fun split_normalizes_relative_paths() {
        assertEquals(listOf("docs", "notes.txt"), ScopedStoragePaths.split("./docs//notes.txt"))
    }

    @Test
    fun split_rejects_parent_segments() {
        val error = runCatching { ScopedStoragePaths.split("../notes.txt") }.exceptionOrNull()
        assertTrue(error is ScopedStorageException)
        assertEquals(ErrorCodes.INVALID_PATH, (error as ScopedStorageException).code)
    }

    @Test
    fun mime_inference_covers_text_files() {
        assertEquals("text/plain", ScopedStorageMimeTypes.forPath("logs/output.txt"))
    }
}
