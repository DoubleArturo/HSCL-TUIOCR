import { createClient } from '@supabase/supabase-js';

export interface VisionOCRResult {
    text: string;
    confidence: number;
}

export const extractTextFromImage = async (
    base64Image: string,
    mimeType: string = 'image/jpeg'
): Promise<VisionOCRResult> => {
    const base64Data = base64Image.includes('base64,')
        ? base64Image.split('base64,')[1]
        : base64Image;

    const useDirectAPI = import.meta.env.VITE_USE_DIRECT_API === 'true';

    let data: any;

    if (useDirectAPI) {
        const visionKey = import.meta.env.VITE_GOOGLE_CLOUD_API_KEY;
        if (!visionKey) {
            throw new Error('Vision API key not configured. Please set VITE_GOOGLE_CLOUD_API_KEY in .env');
        }
        const requestBody = {
            requests: [{
                image: { content: base64Data },
                features: [{ type: 'TEXT_DETECTION', maxResults: 10 }],
                imageContext: { languageHints: ['zh-TW', 'en'] },
            }],
        };
        const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${visionKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Vision API error: ${JSON.stringify(error)}`);
        }
        data = await response.json();
    } else {
        const supabase = createClient(
            import.meta.env.VITE_SUPABASE_URL,
            import.meta.env.VITE_SUPABASE_ANON_KEY,
        );
        const { data: proxyData, error } = await supabase.functions.invoke('vision-ocr-proxy', {
            body: { base64Data, mimeType },
        });
        if (error) throw new Error(`Proxy error: ${error.message}`);
        data = proxyData;
    }

    const result = data.responses[0];
    if (result.error) throw new Error(`Vision API error: ${result.error.message}`);
    if (!result.textAnnotations || result.textAnnotations.length === 0) {
        return { text: '', confidence: 0 };
    }

    const fullText = result.textAnnotations[0].description || '';
    const confidence = result.textAnnotations[0].confidence || 0.8;
    return { text: fullText.trim(), confidence: confidence * 100 };
};

export const extractBuyerTaxId = async (
    base64Image: string,
    mimeType: string = 'image/jpeg'
): Promise<string | null> => {
    try {
        const result = await extractTextFromImage(base64Image, mimeType);
        const text = result.text;

        console.log('[Vision API] Extracted text:', text);

        const digitPatterns = text.match(/\d{8}/g);
        if (digitPatterns && digitPatterns.length > 0) {
            console.log('[Vision API] Found 8-digit patterns:', digitPatterns);
            if (digitPatterns.includes('16547744')) return '16547744';
            return digitPatterns.length > 1 ? digitPatterns[1] : digitPatterns[0];
        }

        console.warn('[Vision API] No 8-digit tax ID found in text');
        return null;
    } catch (error) {
        console.error('[Vision API] Failed to extract buyer tax ID:', error);
        return null;
    }
};

export const validateTaxIdWithVision = async (
    base64Image: string,
    expectedTaxId: string = '16547744',
    mimeType: string = 'image/jpeg'
): Promise<{ isValid: boolean; extractedId: string | null; confidence: number }> => {
    const extractedId = await extractBuyerTaxId(base64Image, mimeType);
    if (!extractedId) return { isValid: false, extractedId: null, confidence: 0 };
    const isValid = extractedId === expectedTaxId;
    return { isValid, extractedId, confidence: isValid ? 95 : 70 };
};
