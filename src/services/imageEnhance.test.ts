/**
 * Tests for image enhancement and PDF conversion service.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { enhanceImageForOCR, isPDF } from './imageEnhance';
import sharp from 'sharp';

describe('imageEnhance service', () => {
  let testImageBuffer: Buffer;

  beforeAll(async () => {
    // Create a simple test image (100x100 gray PNG)
    testImageBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 100, g: 100, b: 100 }, // Mid-tone gray
      },
    })
      .png()
      .toBuffer();
  });

  describe('enhanceImageForOCR', () => {
    it('should enhance valid image buffer', async () => {
      const enhanced = await enhanceImageForOCR(testImageBuffer);

      // Should return a buffer
      expect(enhanced).toBeInstanceOf(Buffer);
      expect(enhanced.length).toBeGreaterThan(0);

      // Enhanced image should be smaller or equal (PNG compression)
      expect(enhanced.length).toBeLessThanOrEqual(testImageBuffer.length * 1.2);
    });

    it('should throw error for empty buffer', async () => {
      const emptyBuffer = Buffer.alloc(0);
      await expect(enhanceImageForOCR(emptyBuffer)).rejects.toThrow(
        'Invalid image buffer'
      );
    });

    it('should throw error for null buffer', async () => {
      await expect(
        enhanceImageForOCR(null as unknown as Buffer)
      ).rejects.toThrow();
    });

    it('should preserve image dimensions after enhancement', async () => {
      const enhanced = await enhanceImageForOCR(testImageBuffer);
      const metadata = await sharp(enhanced).metadata();

      expect(metadata.width).toBe(100);
      expect(metadata.height).toBe(100);
    });

    it('should output PNG format', async () => {
      const enhanced = await enhanceImageForOCR(testImageBuffer);
      const metadata = await sharp(enhanced).metadata();

      expect(metadata.format).toBe('png');
    });
  });

  describe('isPDF', () => {
    it('should detect PDF by MIME type', () => {
      const pdfFile = new File(
        [Buffer.from('test')],
        'test.pdf',
        { type: 'application/pdf' }
      );
      expect(isPDF(pdfFile)).toBe(true);
    });

    it('should return false for non-PDF files', () => {
      const imageFile = new File(
        [testImageBuffer],
        'test.png',
        { type: 'image/png' }
      );
      expect(isPDF(imageFile)).toBe(false);
    });

    it('should return false for unknown MIME type', () => {
      const unknownFile = new File(
        [Buffer.from('test')],
        'test.bin',
        { type: 'application/octet-stream' }
      );
      expect(isPDF(unknownFile)).toBe(false);
    });
  });
});
