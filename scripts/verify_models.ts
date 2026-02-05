
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

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;

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

async function verifyModel(modelName: string) {
    console.log(`Testing access to model: ${modelName}...`);
    try {
        const response = await ai.models.generateContent({
            model: modelName,
            contents: {
                parts: [{ text: "Hello, just checking availability. Reply with 'OK'." }]
            }
        });
        const text = response.text;
        console.log(`✅ [${modelName}] Success! Response: ${text?.trim()}`);
        return true;
    } catch (error: any) {
        if (error.status === 404 || error.message?.includes('not found') || error.message?.includes('404')) {
            console.error(`❌ [${modelName}] Failed: Model not found (404).`);
        } else if (error.status === 400 || error.message?.includes('400')) {
            console.error(`❌ [${modelName}] Failed: Bad Request (400) - Likely invalid model name.`);
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
