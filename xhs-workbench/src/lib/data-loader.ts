import { SkillData } from '@/types/data';
import { getStaticSkillData } from './static-data';

let cachedData: SkillData | null = null;

export async function loadSkillData(): Promise<SkillData> {
  if (!cachedData) {
    cachedData = getStaticSkillData();
  }
  return cachedData;
}

export function getCachedData(): SkillData | null {
  return cachedData || getStaticSkillData();
}
