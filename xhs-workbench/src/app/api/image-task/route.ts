import { NextResponse } from 'next/server';
import { getImageTask } from '@/lib/image-client';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('task_id') || '';
    const task = await getImageTask(taskId);
    return NextResponse.json(task);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '查询生图任务失败' },
      { status: 500 },
    );
  }
}
