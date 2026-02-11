
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from "@google/genai";

// Manual .env parsing
try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf-8');
        envConfig.split('\n').forEach(line => {
            const parts = line.split('=');
            if (parts.length >= 2 && !line.startsWith('#')) {
                const key = parts[0].trim();
                const value = parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
                if (!process.env[key]) process.env[key] = value;
            }
        });
    }
} catch (e) {
    console.warn("Could not read .env file");
}

const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.API_KEY;

if (!apiKey) {
    console.error("Error: GEMINI_API_KEY or API_KEY not found in environment variables.");
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

const toTest = [
    'gemini-1.5-flash',
    'gemini-2.5-flash',
    'gemini-2.5-pro'
];

// Minimal schema to test
const responseSchema = {
    type: "ARRAY",
    items: {
        type: "OBJECT",
        properties: {
            invoice_number: { type: "STRING" }
        }
    }
};

async function verifyModel(modelName: string) {
    console.log(`Testing access to model: ${modelName}...`);
    try {
        // Mock base64 image (small 1x1 pixel)
        const base64Data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        const contentPart = {
            inlineData: {
                mimeType: "image/png",
                data: base64Data
            }
        };

        const response = await ai.models.generateContent({
            model: modelName,
            contents: {
                parts: [
                    contentPart,
                    { text: "Extract invoice data." }
                ]
            },
            config: {
                systemInstruction: "You are a helpful assistant.",
                responseMimeType: "application/json",
                responseSchema: responseSchema
            }
        });
        const text = response.text;
        console.log(`✅ [${modelName}] Success! Response: ${text?.trim()}`);
        return true;
    } catch (error: any) {
        if (error.status === 404) {
            console.error(`❌ [${modelName}] Failed: Model not found (404).`);
        } else {
            console.error(`❌ [${modelName}] Failed: ${error.message}`);
        }
        return false;
    }
}

async function runVerification() {
    console.log("Starting Model Verification...");
    console.log("--------------------------------");

    for (const model of toTest) {
        await verifyModel(model);
        console.log("--------------------------------");
    }
}

runVerification();
