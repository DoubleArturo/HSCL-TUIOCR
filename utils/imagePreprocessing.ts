/**
 * Image Preprocessing Utility
 * Enhances image quality before OCR to improve handwriting recognition
 */

/**
 * Sharpen and enhance an image file for better OCR accuracy
 * Uses Canvas API to:
 * 1. Increase contrast (make text darker)
 * 2. Apply sharpening filter
 * 3. Optional: Convert to grayscale for better number recognition
 */
export const preprocessImageForOCR = async (
    file: File,
    options: {
        sharpen?: boolean;
        increaseContrast?: boolean;
        grayscale?: boolean;
    } = {}
): Promise<File> => {
    const { sharpen = true, increaseContrast = true, grayscale = false } = options;

    return new Promise((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();

        reader.onload = (e) => {
            if (!e.target?.result) {
                reject(new Error('Failed to read file'));
                return;
            }

            img.onload = () => {
                // Create canvas with same dimensions
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Failed to get canvas context'));
                    return;
                }

                canvas.width = img.width;
                canvas.height = img.height;

                // Draw original image
                ctx.drawImage(img, 0, 0);

                // Get image data
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imageData.data;

                // 1. Convert to Grayscale (optional, helps with numeric OCR)
                if (grayscale) {
                    for (let i = 0; i < data.length; i += 4) {
                        const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                        data[i] = gray;     // R
                        data[i + 1] = gray; // G
                        data[i + 2] = gray; // B
                    }
                }

                // 2. Increase Contrast (makes handwriting clearer)
                if (increaseContrast) {
                    const factor = 1.3; // Contrast multiplier (1.0 = no change)
                    const intercept = 128 * (1 - factor);

                    for (let i = 0; i < data.length; i += 4) {
                        data[i] = Math.min(255, Math.max(0, data[i] * factor + intercept));
                        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] * factor + intercept));
                        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] * factor + intercept));
                    }
                }

                // 3. Sharpen (enhances edges of text)
                if (sharpen) {
                    const weights = [
                        0, -1, 0,
                        -1, 5, -1,
                        0, -1, 0
                    ];
                    const side = Math.round(Math.sqrt(weights.length));
                    const halfSide = Math.floor(side / 2);
                    const src = new Uint8ClampedArray(data);
                    const w = canvas.width;
                    const h = canvas.height;

                    for (let y = 0; y < h; y++) {
                        for (let x = 0; x < w; x++) {
                            const dstOff = (y * w + x) * 4;
                            let r = 0, g = 0, b = 0;

                            for (let cy = 0; cy < side; cy++) {
                                for (let cx = 0; cx < side; cx++) {
                                    const scy = Math.min(h - 1, Math.max(0, y + cy - halfSide));
                                    const scx = Math.min(w - 1, Math.max(0, x + cx - halfSide));
                                    const srcOff = (scy * w + scx) * 4;
                                    const wt = weights[cy * side + cx];

                                    r += src[srcOff] * wt;
                                    g += src[srcOff + 1] * wt;
                                    b += src[srcOff + 2] * wt;
                                }
                            }

                            data[dstOff] = Math.min(255, Math.max(0, r));
                            data[dstOff + 1] = Math.min(255, Math.max(0, g));
                            data[dstOff + 2] = Math.min(255, Math.max(0, b));
                        }
                    }
                }

                // Put processed image data back
                ctx.putImageData(imageData, 0, 0);

                // Convert canvas to Blob
                canvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error('Failed to create blob from canvas'));
                        return;
                    }

                    // Create new File object with same name
                    const processedFile = new File([blob], file.name, {
                        type: file.type || 'image/png',
                        lastModified: Date.now()
                    });

                    resolve(processedFile);
                }, file.type || 'image/png', 0.95); // High quality
            };

            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = e.target.result as string;
        };

        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
};
