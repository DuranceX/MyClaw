import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText, UIMessage, convertToModelMessages } from 'ai';

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

const anthro = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL,
});

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }:{ messages: UIMessage[]} = await req.json();

  const response = await streamText({
    model: openai.chat('gemini-2.5-pro'),
    system: '你是一个资深前端开发工程师，回答问题要专业、简洁，并尽量给出代码示例。',
    temperature: 0,
    messages: await convertToModelMessages(messages),
  });

  return response.toUIMessageStreamResponse();
}