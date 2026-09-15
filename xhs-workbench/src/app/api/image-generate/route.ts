import { NextResponse } from 'next/server';
import { buildImageRequestHash, ImageSubmissionUncertainError, submitImageTask } from '@/lib/image-client';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prompt = String(body.prompt || '');
    const referenceImages = Array.isArray(body.reference_images)
      ? body.reference_images.map(String).filter(Boolean)
      : [];
    const task = await submitImageTask({
      prompt,
      negativePrompt: String(body.negative_prompt || ''),
      aspectRatio: String(body.aspect_ratio || '3:4'),
      referenceImages,
      idempotencyKey: typeof body.idempotency_key === 'string'
        ? body.idempotency_key
        : buildImageRequestHash({
          productId: typeof body.product_id === 'string' ? body.product_id : undefined,
          posterTitle: typeof body.poster_title === 'string' ? body.poster_title : undefined,
          prompt,
          referenceImageIds: referenceImages,
        }),
    });
    return NextResponse.json(task);
  } catch (error) {
    if (error instanceof ImageSubmissionUncertainError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 202 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '提交生图任务失败' },
      { status: 500 },
    );
  }
}
