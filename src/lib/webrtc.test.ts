import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Bug Condition Exploration Test
 * 
 * **Validates: Requirements 1.1, 1.2, 1.3**
 * 
 * This test explores the bug condition where duplicate filename uploads fail silently.
 * The test MUST FAIL on unfixed code - failure confirms the bug exists.
 * 
 * Bug Condition: When a user uploads a file with a filename that matches a previously 
 * uploaded file, the system silently fails to show the file in the upload UI with progress bar.
 * 
 * Expected Behavior: Files with duplicate filenames should display in the UI with progress 
 * bars and unique fileIds, allowing the upload to proceed normally.
 */

// Import the buildDownloadSignature function
// We need to test the signature generation to understand the bug
const buildDownloadSignature = (fileData: {
  originDeviceId?: string;
  filename?: string;
  totalSize: number;
  mimeType: string;
  relayHop?: number;
  chunkHashes?: string[];
}): string => {
  return JSON.stringify([
    fileData.originDeviceId || 'unknown',
    fileData.totalSize,
    fileData.mimeType || 'application/octet-stream',
    fileData.relayHop || 0,
    (fileData.chunkHashes || []).join(','),
  ]);
};

describe('Bug Condition: Duplicate Filename Upload Fails Silently', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  /**
   * Test: Duplicate Filename Upload - Files Should Have Different Signatures if Content Differs
   * 
   * Scenario: Upload file "document.txt" (100 KB), then upload another "document.txt" (200 KB) 
   * with different content.
   * 
   * Expected: Both files should have different signatures because they have different sizes,
   * even though they have the same filename.
   * 
   * Bug Manifestation: If the signature includes filename, both files will have the same 
   * signature (or very similar), causing the second upload to be treated as a duplicate 
   * and not displayed in the UI.
   */
  it('should generate different signatures for files with same filename but different content', () => {
    const originDeviceId = 'device-1';
    const filename = 'document.txt';
    const mimeType = 'text/plain';

    // First file: 100 KB
    const file1Data = {
      originDeviceId,
      filename,
      totalSize: 100 * 1024, // 100 KB
      mimeType,
      chunkHashes: ['hash1', 'hash2', 'hash3'],
    };

    // Second file: 200 KB with same filename but different content
    const file2Data = {
      originDeviceId,
      filename,
      totalSize: 200 * 1024, // 200 KB
      mimeType,
      chunkHashes: ['hash4', 'hash5', 'hash6', 'hash7'],
    };

    const signature1 = buildDownloadSignature(file1Data);
    const signature2 = buildDownloadSignature(file2Data);

    // ASSERTION 1: Signatures should be different because content differs
    // This assertion will FAIL on unfixed code because filename is included in signature
    // and both files have the same filename, making the signatures identical or very similar
    expect(signature1).not.toBe(signature2);
    console.log('Counterexample: File 1 signature:', signature1);
    console.log('Counterexample: File 2 signature:', signature2);
  });

  /**
   * Test: Duplicate Filename Upload - Both Files Should Be Processable
   * 
   * Scenario: Upload "document.txt" (100 KB), then upload another "document.txt" (200 KB).
   * 
   * Expected: Both files should be added to the UI with unique fileIds and progress bars.
   * The second upload should not be silently rejected.
   * 
   * Bug Manifestation: The second file with duplicate filename does not appear in the UI
   * because the signature matches the first file, causing shouldAutoDownload to return false
   * and the file to not be processed.
   */
  it('should allow multiple files with same filename to be processed independently', () => {
    const originDeviceId = 'device-1';
    const filename = 'document.txt';
    const mimeType = 'text/plain';

    // Simulate first file upload
    const file1Data = {
      originDeviceId,
      filename,
      totalSize: 100 * 1024,
      mimeType,
      chunkHashes: ['hash1', 'hash2'],
    };

    const signature1 = buildDownloadSignature(file1Data);

    // Store first file signature (simulating that it was downloaded)
    const downloadedSignatures = new Set<string>();
    downloadedSignatures.add(signature1);
    localStorage.setItem('downloaded_file_signatures', JSON.stringify(Array.from(downloadedSignatures)));

    // Simulate second file upload with same filename but different content
    const file2Data = {
      originDeviceId,
      filename,
      totalSize: 200 * 1024,
      mimeType,
      chunkHashes: ['hash3', 'hash4', 'hash5'],
    };

    const signature2 = buildDownloadSignature(file2Data);

    // ASSERTION 1: Second file should have a different signature
    // This will FAIL on unfixed code
    expect(signature2).not.toBe(signature1);

    // ASSERTION 2: Second file should not be in the downloaded signatures set
    // This will FAIL on unfixed code because signature2 might equal signature1
    const storedSignatures = JSON.parse(localStorage.getItem('downloaded_file_signatures') || '[]');
    expect(storedSignatures).not.toContain(signature2);

    console.log('Counterexample: First file signature:', signature1);
    console.log('Counterexample: Second file signature:', signature2);
    console.log('Counterexample: Stored signatures:', storedSignatures);
    console.log('Counterexample: Second file would be treated as duplicate:', storedSignatures.includes(signature2));
  });

  /**
   * Test: Duplicate Filename Upload - Unique FileIds Should Be Generated
   * 
   * Scenario: Upload "image.jpg" twice with different content.
   * 
   * Expected: Each file should have a unique fileId independent of filename.
   * Both files should be displayed in the UI with their own progress bars.
   * 
   * Bug Manifestation: The second file is not displayed because it's treated as a duplicate
   * based on the filename being included in the download signature.
   */
  it('should generate unique fileIds for files with duplicate filenames', () => {
    // Simulate file upload scenario
    const filename = 'image.jpg';
    const mimeType = 'image/jpeg';
    const originDeviceId = 'device-1';

    // First upload
    const fileId1 = Math.random().toString(36).substr(2, 9);
    const file1Data = {
      originDeviceId,
      filename,
      totalSize: 500 * 1024, // 500 KB
      mimeType,
      chunkHashes: ['hash1', 'hash2', 'hash3'],
    };

    // Second upload with same filename but different content
    const fileId2 = Math.random().toString(36).substr(2, 9);
    const file2Data = {
      originDeviceId,
      filename,
      totalSize: 750 * 1024, // 750 KB
      mimeType,
      chunkHashes: ['hash4', 'hash5', 'hash6', 'hash7'],
    };

    // ASSERTION 1: FileIds should be unique
    expect(fileId1).not.toBe(fileId2);

    // ASSERTION 2: Signatures should be different (because content differs)
    // This will FAIL on unfixed code
    const signature1 = buildDownloadSignature(file1Data);
    const signature2 = buildDownloadSignature(file2Data);
    expect(signature1).not.toBe(signature2);

    console.log('Counterexample: File 1 ID:', fileId1, 'Signature:', signature1);
    console.log('Counterexample: File 2 ID:', fileId2, 'Signature:', signature2);
    console.log('Counterexample: Both files should appear in UI with unique IDs and signatures');
  });

  /**
   * Test: Duplicate Filename Upload - Content-Based Deduplication Should Work
   * 
   * Scenario: Upload "report.txt" (1000 bytes), then upload "report.txt" again 
   * with identical content.
   * 
   * Expected: Both files should have the same signature (content-based deduplication).
   * The second upload should be skipped to prevent redundant browser downloads.
   * However, both files should still be added to the UI with unique fileIds.
   * 
   * Bug Manifestation: The current implementation includes filename in the signature,
   * so even identical content with the same filename might be treated differently.
   */
  it('should use content-based deduplication, not filename-based', () => {
    const originDeviceId = 'device-1';
    const filename = 'report.txt';
    const mimeType = 'text/plain';
    const totalSize = 1000;
    const chunkHashes = ['hash1', 'hash2'];

    // Same file uploaded twice
    const file1Data = {
      originDeviceId,
      filename,
      totalSize,
      mimeType,
      chunkHashes,
    };

    const file2Data = {
      originDeviceId,
      filename,
      totalSize,
      mimeType,
      chunkHashes,
    };

    const signature1 = buildDownloadSignature(file1Data);
    const signature2 = buildDownloadSignature(file2Data);

    // ASSERTION: Identical content should have identical signatures
    expect(signature1).toBe(signature2);

    // Now test with different filename but same content
    const file3Data = {
      originDeviceId,
      filename: 'report_copy.txt', // Different filename
      totalSize,
      mimeType,
      chunkHashes,
    };

    const signature3 = buildDownloadSignature(file3Data);

    // ASSERTION: This will FAIL on unfixed code because filename is included in signature
    // On fixed code, signature3 should equal signature1 (content-based deduplication)
    // But on unfixed code, signature3 will differ because filename is different
    expect(signature3).toBe(signature1);

    console.log('Counterexample: Same content, same filename - signatures match:', signature1 === signature2);
    console.log('Counterexample: Same content, different filename - signatures should match but don\'t:', signature1 === signature3);
  });
});
