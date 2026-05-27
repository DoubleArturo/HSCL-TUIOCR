const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface OCRProxyRequest {
  model: string;
  mimeType: string;
  base64Data: string;
  promptText: string;
  systemPrompt: string;
  responseSchema: unknown;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders() });
  }

  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey) {
    return new Response(
      JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
      { status: 500, headers: getCorsHeaders() },
    );
  }

  try {
    const body: OCRProxyRequest = await req.json();
    const { model, mimeType, base64Data, promptText, systemPrompt, responseSchema } = body;

    const geminiPayload = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mimeType, data: base64Data } },
            { text: promptText },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema,
      },
    };

    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${geminiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload),
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(
        JSON.stringify({ error: `Gemini API error ${response.status}`, detail: errText }),
        { status: response.status, headers: getCorsHeaders() },
      );
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text ?? null;
    const usageMetadata = data.usageMetadata ?? null;

    return new Response(
      JSON.stringify({ text, usageMetadata }),
      { status: 200, headers: getCorsHeaders() },
    );
  } catch (error) {
    console.error('[gemini-ocr-proxy] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: getCorsHeaders() },
    );
  }
});

function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
    'Content-Type': 'application/json',
  };
}
