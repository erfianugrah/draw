const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3004;

// ============================================
// Configuration
// ============================================

const AI_PROVIDER = process.env.AI_PROVIDER || 'openai'; // openai, anthropic, ollama
const RATE_LIMIT_PER_DAY = parseInt(process.env.AI_RATE_LIMIT_PER_DAY || '100', 10);

// Simple in-memory rate limiting (resets on restart)
const rateLimits = new Map();

const getRateLimitKey = (req) => {
  return req.ip || req.headers['x-forwarded-for'] || 'anonymous';
};

const checkRateLimit = (req) => {
  const key = getRateLimitKey(req);
  const today = new Date().toDateString();
  const userKey = `${key}:${today}`;
  
  const current = rateLimits.get(userKey) || 0;
  if (current >= RATE_LIMIT_PER_DAY) {
    return { allowed: false, remaining: 0, limit: RATE_LIMIT_PER_DAY };
  }
  
  rateLimits.set(userKey, current + 1);
  return { allowed: true, remaining: RATE_LIMIT_PER_DAY - current - 1, limit: RATE_LIMIT_PER_DAY };
};

// ============================================
// AI Provider Clients
// ============================================

let openai = null;
let anthropic = null;

const initializeProviders = () => {
  if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('OpenAI provider initialized');
  }
  
  if (process.env.ANTHROPIC_API_KEY) {
    const Anthropic = require('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    console.log('Anthropic provider initialized');
  }
  
  if (process.env.OLLAMA_HOST) {
    console.log(`Ollama provider configured at ${process.env.OLLAMA_HOST}`);
  }
};

// ============================================
// System Prompts
// ============================================

const TEXT_TO_DIAGRAM_PROMPT = `You are a Mermaid diagram generator. Convert the user's request into valid Mermaid diagram syntax.

Rules:
1. Output ONLY valid Mermaid syntax - no explanations, no markdown code blocks, no backticks
2. Use flowchart TD (top-down) or LR (left-right) for most diagrams
3. Use sequenceDiagram for interactions between entities
4. Use classDiagram for object/class structures
5. Keep node labels concise but descriptive
6. Use appropriate arrow types (-->, --o, --x, -.->)
7. For flowcharts, ALWAYS use a node ID before the shape. Node shapes are: ID[rectangular], ID(rounded), ID{diamond}, ID((circle))
8. NEVER use shapes without an ID prefix - ((Start)) is WRONG, use A((Start)) instead
9. NEVER use parentheses (), brackets [], braces {}, or pipe | characters inside node labels - they break parsing. Use alternative text instead (e.g., "Call fetch" not "fetch()", "Array of items" not "items[]")

Examples of valid output:
flowchart TD
    A((Start)) --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Call API]
    C --> E((End))
    D --> E

sequenceDiagram
    User->>Server: Request
    Server-->>User: Response`;

const DIAGRAM_TO_CODE_PROMPT = `You are a wireframe-to-HTML converter. Analyze the wireframe image and generate clean, semantic HTML with embedded CSS.

Rules:
1. Output ONLY a complete, valid HTML document - no explanations, no markdown
2. Use semantic HTML5 elements (header, main, nav, section, article, footer)
3. Include ALL CSS in a <style> tag inside <head>
4. Match the layout and structure shown in the wireframe
5. Use the text labels visible in the image or provided in the texts array
6. Make it responsive using flexbox or CSS grid
7. Use CSS variables for colors to support theming
8. The output must be immediately renderable in an iframe

For dark theme, use dark backgrounds with light text.
For light theme, use light backgrounds with dark text.`;

// ============================================
// AI Provider Implementations
// ============================================

// Text-to-Diagram using different providers
const generateMermaidOpenAI = async (prompt) => {
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: TEXT_TO_DIAGRAM_PROMPT },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 2000
  });
  return response.choices[0].message.content.trim();
};

const generateMermaidAnthropic = async (prompt) => {
  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-3-haiku-20240307',
    max_tokens: 2000,
    system: TEXT_TO_DIAGRAM_PROMPT,
    messages: [{ role: 'user', content: prompt }]
  });
  return response.content[0].text.trim();
};

const generateMermaidOllama = async (prompt) => {
  const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL || 'llama3.2';
  
  const response = await fetch(`${ollamaHost}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: `${TEXT_TO_DIAGRAM_PROMPT}\n\nUser request: ${prompt}`,
      stream: false
    })
  });
  
  if (!response.ok) {
    throw new Error(`Ollama error: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.response.trim();
};

// Diagram-to-Code using different providers
const generateHTMLOpenAI = async (image, texts, theme) => {
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_VISION_MODEL || 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          { 
            type: 'text', 
            text: `${DIAGRAM_TO_CODE_PROMPT}\n\nText labels found: ${texts.join(', ')}\nTheme: ${theme}\n\nGenerate HTML for this wireframe:` 
          },
          { 
            type: 'image_url', 
            image_url: { url: image, detail: 'high' } 
          }
        ]
      }
    ],
    max_tokens: 4000
  });
  return response.choices[0].message.content.trim();
};

const generateHTMLAnthropic = async (image, texts, theme) => {
  // Extract base64 data and media type from data URL
  const matches = image.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) {
    throw new Error('Invalid image data URL');
  }
  
  const [, mediaType, base64Data] = matches;
  
  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_VISION_MODEL || 'claude-3-5-sonnet-20241022',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { 
            type: 'base64', 
            media_type: mediaType, 
            data: base64Data 
          }
        },
        {
          type: 'text',
          text: `${DIAGRAM_TO_CODE_PROMPT}\n\nText labels found: ${texts.join(', ')}\nTheme: ${theme}\n\nGenerate HTML for this wireframe.`
        }
      ]
    }]
  });
  return response.content[0].text.trim();
};

const generateHTMLOllama = async (image, texts, theme) => {
  const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
  const model = process.env.OLLAMA_VISION_MODEL || 'llava';
  
  // Extract base64 data from data URL
  const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
  
  const response = await fetch(`${ollamaHost}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: `${DIAGRAM_TO_CODE_PROMPT}\n\nText labels found: ${texts.join(', ')}\nTheme: ${theme}\n\nGenerate HTML for this wireframe.`,
      images: [base64Data],
      stream: false
    })
  });
  
  if (!response.ok) {
    throw new Error(`Ollama error: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.response.trim();
};

// ============================================
// Provider Selection
// ============================================

const generateMermaid = async (prompt) => {
  const provider = AI_PROVIDER.toLowerCase();
  
  switch (provider) {
    case 'openai':
      if (!openai) throw new Error('OpenAI not configured. Set OPENAI_API_KEY.');
      return generateMermaidOpenAI(prompt);
    
    case 'anthropic':
      if (!anthropic) throw new Error('Anthropic not configured. Set ANTHROPIC_API_KEY.');
      return generateMermaidAnthropic(prompt);
    
    case 'ollama':
      if (!process.env.OLLAMA_HOST) throw new Error('Ollama not configured. Set OLLAMA_HOST.');
      return generateMermaidOllama(prompt);
    
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
};

const generateHTML = async (image, texts, theme) => {
  const provider = AI_PROVIDER.toLowerCase();
  
  switch (provider) {
    case 'openai':
      if (!openai) throw new Error('OpenAI not configured. Set OPENAI_API_KEY.');
      return generateHTMLOpenAI(image, texts, theme);
    
    case 'anthropic':
      if (!anthropic) throw new Error('Anthropic not configured. Set ANTHROPIC_API_KEY.');
      return generateHTMLAnthropic(image, texts, theme);
    
    case 'ollama':
      if (!process.env.OLLAMA_HOST) throw new Error('Ollama not configured. Set OLLAMA_HOST.');
      return generateHTMLOllama(image, texts, theme);
    
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
};

// ============================================
// Helper: Clean Mermaid output
// ============================================

const cleanMermaidOutput = (output) => {
  // Remove markdown code blocks if present
  let cleaned = output
    .replace(/```mermaid\n?/gi, '')
    .replace(/```\n?/g, '')
    .trim();
  
  return cleaned;
};

// ============================================
// Helper: Clean HTML output
// ============================================

const cleanHTMLOutput = (output) => {
  // Remove markdown code blocks if present
  let cleaned = output
    .replace(/```html\n?/gi, '')
    .replace(/```\n?/g, '')
    .trim();
  
  // Ensure it starts with proper HTML
  if (!cleaned.toLowerCase().startsWith('<!doctype') && !cleaned.toLowerCase().startsWith('<html')) {
    cleaned = `<!DOCTYPE html>\n<html>\n<head><meta charset="UTF-8"></head>\n<body>\n${cleaned}\n</body>\n</html>`;
  }
  
  return cleaned;
};

// ============================================
// Middleware
// ============================================

app.use(cors({
  origin: process.env.CORS_ORIGIN || true, // true = reflect request origin (required for credentials)
  credentials: true, // Allow cookies/auth headers
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'CF-Access-Client-Id', 'CF-Access-Client-Secret'],
  exposedHeaders: ['X-Ratelimit-Limit', 'X-Ratelimit-Remaining']
}));

app.use(express.json({ limit: '50mb' }));

// ============================================
// Health check
// ============================================

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Excalidraw AI server is running',
    provider: AI_PROVIDER,
    rateLimitPerDay: RATE_LIMIT_PER_DAY,
    endpoints: [
      'POST /v1/ai/text-to-diagram/generate',
      'POST /v1/ai/diagram-to-code/generate'
    ]
  });
});

// ============================================
// Text-to-Diagram Endpoint
// ============================================

app.post('/v1/ai/text-to-diagram/generate', async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ message: 'Missing or invalid prompt' });
    }
    
    if (prompt.length < 3 || prompt.length > 1000) {
      return res.status(400).json({ message: 'Prompt must be between 3 and 1000 characters' });
    }
    
    // Check rate limit
    const rateLimit = checkRateLimit(req);
    res.setHeader('X-Ratelimit-Limit', rateLimit.limit);
    res.setHeader('X-Ratelimit-Remaining', rateLimit.remaining);
    
    if (!rateLimit.allowed) {
      return res.status(429).json({ 
        statusCode: 429,
        message: 'Too many requests today, please try again tomorrow!' 
      });
    }
    
    console.log(`[text-to-diagram] Provider: ${AI_PROVIDER}, Prompt: "${prompt.substring(0, 50)}..."`);
    
    const rawOutput = await generateMermaid(prompt);
    const generatedResponse = cleanMermaidOutput(rawOutput);
    
    console.log(`[text-to-diagram] Generated ${generatedResponse.length} chars`);
    
    res.json({ generatedResponse });
    
  } catch (error) {
    console.error('[text-to-diagram] Error:', error.message);
    res.status(500).json({ message: error.message || 'Generation failed' });
  }
});

// ============================================
// Diagram-to-Code Endpoint
// ============================================

app.post('/v1/ai/diagram-to-code/generate', async (req, res) => {
  try {
    const { texts, image, theme } = req.body;
    
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ message: 'Missing or invalid image' });
    }
    
    if (!image.startsWith('data:image/')) {
      return res.status(400).json({ message: 'Image must be a base64 data URL' });
    }
    
    // Check rate limit
    const rateLimit = checkRateLimit(req);
    res.setHeader('X-Ratelimit-Limit', rateLimit.limit);
    res.setHeader('X-Ratelimit-Remaining', rateLimit.remaining);
    
    if (!rateLimit.allowed) {
      return res.status(429).json({ 
        statusCode: 429,
        message: 'Too many requests today, please try again tomorrow!' 
      });
    }
    
    const textLabels = Array.isArray(texts) ? texts : [];
    const selectedTheme = theme || 'light';
    
    console.log(`[diagram-to-code] Provider: ${AI_PROVIDER}, Texts: ${textLabels.length}, Theme: ${selectedTheme}`);
    
    const rawOutput = await generateHTML(image, textLabels, selectedTheme);
    const html = cleanHTMLOutput(rawOutput);
    
    console.log(`[diagram-to-code] Generated ${html.length} chars`);
    
    res.json({ html });
    
  } catch (error) {
    console.error('[diagram-to-code] Error:', error.message);
    res.status(500).json({ message: error.message || 'Generation failed' });
  }
});

// ============================================
// Start Server
// ============================================

initializeProviders();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Excalidraw AI server listening on port ${PORT}`);
  console.log(`Provider: ${AI_PROVIDER}`);
  console.log(`Rate limit: ${RATE_LIMIT_PER_DAY} requests/day`);
  
  if (!openai && !anthropic && !process.env.OLLAMA_HOST) {
    console.warn('WARNING: No AI provider configured! Set one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, or OLLAMA_HOST');
  }
});
