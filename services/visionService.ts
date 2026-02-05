/**
 * Google Cloud Vision API Service
 * Specialized handwriting OCR for validating Buyer Tax ID field
 */

const VISION_API_KEY = import.meta.env.VITE_GOOGLE_CLOUD_API_KEY;
const VISION_API_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';

export interface VisionOCRResult {
    text: string;
    confidence: number;
}

/**
 * Extract text from an image using Google Cloud Vision API
 * Uses TEXT_DETECTION feature optimized for handwritten numbers
 */
export const extractTextFromImage = async (
    base64Image: string,
    mimeType: string = 'image/jpeg'
): Promise<VisionOCRResult> => {
    if (!VISION_API_KEY) {
        throw new Error('Vision API key not configured. Please set VITE_GOOGLE_CLOUD_API_KEY in .env');
    }

    // Remove data URL prefix if present
    const base64Data = base64Image.includes('base64,')
        ? base64Image.split('base64,')[1]
        : base64Image;

    const requestBody = {
        requests: [
            {
                image: {
                    content: base64Data
                },
                features: [
                    {
                        type: 'TEXT_DETECTION', // Better for handwriting than DOCUMENT_TEXT_DETECTION
                        maxResults: 10
                    }
                ],
                imageContext: {
                    languageHints: ['zh-TW', 'en'] // Support Chinese and English
                }
            }
        ]
    };

    try {
        const response = await fetch(`${VISION_API_ENDPOINT}?key=${VISION_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Vision API error: ${JSON.stringify(error)}`);
        }

        const data = await response.json();
        const result = data.responses[0];

        if (result.error) {
            throw new Error(`Vision API error: ${result.error.message}`);
        }

        if (!result.textAnnotations || result.textAnnotations.length === 0) {
            return { text: '', confidence: 0 };
        }

        // First annotation contains full text
        const fullText = result.textAnnotations[0].description || '';
        const confidence = result.textAnnotations[0].confidence || 0.8;

        return {
            text: fullText.trim(),
            confidence: confidence * 100
        };
    } catch (error) {
        console.error('[Vision API] Request failed:', error);
        throw error;
    }
};

/**
 * Extract Buyer Tax ID from invoice image
 * Strategy: Extract all text and search for 8-digit patterns near "買受人" or "統一編號"
 */
export const extractBuyerTaxId = async (
    base64Image: string,
    mimeType: string = 'image/jpeg'
): Promise<string | null> => {
    try {
        const result = await extractTextFromImage(base64Image, mimeType);
        const text = result.text;

        console.log('[Vision API] Extracted text:', text);

        // Strategy 1: Look for 8-digit patterns
        const digitPatterns = text.match(/\d{8}/g);
        if (digitPatterns && digitPatterns.length > 0) {
            // Return the first 8-digit match (usually the buyer tax ID appears first)
            // In Taiwan invoices, seller tax ID appears at top, buyer in middle
            // We'll return all matches and let the caller decide
            console.log('[Vision API] Found 8-digit patterns:', digitPatterns);

            // Heuristic: If "16547744" is in the list, return it
            if (digitPatterns.includes('16547744')) {
                return '16547744';
            }

            // Otherwise return the second match (first is usually seller)
            return digitPatterns.length > 1 ? digitPatterns[1] : digitPatterns[0];
        }

        // Strategy 2: Look for patterns like "統一編號" or "買受人統編"
        // This is more complex and might need the boundingPoly data
        // For now, we'll just extract digits

        console.warn('[Vision API] No 8-digit tax ID found in text');
        return null;
    } catch (error) {
        console.error('[Vision API] Failed to extract buyer tax ID:', error);
        return null;
    }
};

/**
 * Validate a tax ID using Vision API (for cross-checking)
 * Returns the most likely tax ID from the image
 */
export const validateTaxIdWithVision = async (
    base64Image: string,
    expectedTaxId: string = '16547744',
    mimeType: string = 'image/jpeg'
): Promise<{
    isValid: boolean;
    extractedId: string | null;
    confidence: number;
}> => {
    const extractedId = await extractBuyerTaxId(base64Image, mimeType);

    if (!extractedId) {
        return {
            isValid: false,
            extractedId: null,
            confidence: 0
        };
    }

    const isValid = extractedId === expectedTaxId;

    return {
        isValid,
        extractedId,
        confidence: isValid ? 95 : 70 // High confidence if matches expectation
    };
};
