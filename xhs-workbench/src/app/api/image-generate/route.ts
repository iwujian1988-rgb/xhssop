import { NextResponse } from 'next/server';
import { submitImageTask } from '@/lib/image-client';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const task = await submitImageTask({
      prompt: String(body.prompt || ''),
      negativePrompt: String(body.negative_prompt || ''),
      aspectRatio: String(body.aspect_ratio || '3:4'),
      referenceImages: Array.isArray(body.reference_images)
        ? body.reference_images.map(String).filter(Boolean)
        : [],
    });
    return NextResponse.json(task);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '提交生图任务失败' },
      { status: 500 },
    );
  }
}
