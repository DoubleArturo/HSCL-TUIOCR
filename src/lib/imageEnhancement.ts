/**
 * Image enhancement for OCR preprocessing.
 * Improves legibility of low-contrast documents (faint ink, blurry text).
 */

export async function enhanceImageForOCR(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Could not get canvas context');

          // Draw original image
          ctx.drawImage(img, 0, 0);

          // Get pixel data
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;

          // Enhancement: Adaptive contrast + brightness normalization
          // Step 1: Analyze histogram to detect if image is low-contrast
          const histogram = new Uint32Array(256);
          for (let i = 0; i < data.length; i += 4) {
            const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
            histogram[gray]++;
          }

          // Find min/max values (excluding pure black/white outliers which are likely borders)
          let minVal = 0, maxVal = 255;
          let cumsum = 0;
          const totalPixels = canvas.width * canvas.height;
          const threshold = totalPixels * 0.001; // Ignore bottom 0.1%

          for (let i = 0; i < 256; i++) {
            cumsum += histogram[i];
            if (cumsum > threshold && minVal === 0) {
              minVal = i;
              break;
            }
          }

          cumsum = 0;
          for (let i = 255; i >= 0; i--) {
            cumsum += histogram[i];
            if (cumsum > threshold && maxVal === 255) {
              maxVal = i;
              break;
            }
          }

          // If contrast is too low (range < 100), apply aggressive enhancement
          const contrastRange = maxVal - minVal;
          const needsEnhancement = contrastRange < 150;

          // Step 2: Apply contrast stretching
          for (let i = 0; i < data.length; i += 4) {
            let gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

            if (needsEnhancement && contrastRange > 0) {
              // Stretch to full range [0, 255]
              gray = ((gray - minVal) / contrastRange) * 255;
            }

            // Step 3: Apply slight brightness boost for very dark images
            if (maxVal < 200) {
              gray = Math.min(255, gray * 1.15);
            }

            // Step 4: Sharpen by boosting mid-tones (sigmoid-like curve)
            // This makes text boundaries crisper without oversaturation
            const normalized = gray / 255;
            const enhanced = Math.pow(normalized, 0.9) * 255;

            data[i] = enhanced;
            data[i + 1] = enhanced;
            data[i + 2] = enhanced;
            // Keep alpha channel unchanged
          }

          // Put enhanced pixels back
          ctx.putImageData(imageData, 0, 0);

          // Convert to Blob and create new File
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('Canvas toBlob failed'));
              return;
            }
            const enhancedFile = new File([blob], file.name, { type: 'image/png' });
            resolve(enhancedFile);
          }, 'image/png', 0.95);
        } catch (err) {
          reject(err);
        }
      };

      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };

      img.src = e.target?.result as string;
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsDataURL(file);
  });
}
