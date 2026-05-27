const VISION_API_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';

interface VisionProxyRequest {
  base64Data: string;
  mimeType: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders() });
  }

  const visionKey = Deno.env.get('GOOGLE_CLOUD_API_KEY');
  if (!visionKey) {
    return new Response(
      JSON.stringify({ error: 'GOOGLE_CLOUD_API_KEY not configured' }),
      { status: 500, headers: getCorsHeaders() },
    );
  }

  try {
    const body: VisionProxyRequest = await req.json();
    const { base64Data } = body;

    const requestBody = {
      requests: [
        {
          image: { content: base64Data },
          features: [{ type: 'TEXT_DETECTION', maxResults: 10 }],
          imageContext: { languageHints: ['zh-TW', 'en'] },
        },
      ],
    };

    const response = await fetch(`${VISION_API_ENDPOINT}?key=${visionKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(
        JSON.stringify({ error: `Vision API error ${response.status}`, detail: errText }),
        { status: response.status, headers: getCorsHeaders() },
      );
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), { status: 200, headers: getCorsHeaders() });
  } catch (error) {
    console.error('[vision-ocr-proxy] Error:', error);
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
