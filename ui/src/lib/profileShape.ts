import { durationSeconds } from './format';

/** Offered rate over time for a profile, mirroring load/lib/profiles.js (for the preview charts). */
export function profileShape(profile: string, rate: number, duration: string): { t: number; rate: number }[] {
  const d = durationSeconds(duration);
  switch (profile) {
    case 'smoke':
      return [{ t: 0, rate: 1 }, { t: d, rate: 1 }];
    case 'constant':
    case 'soak':
      return [{ t: 0, rate }, { t: d, rate }];
    case 'stress':
    case 'breakpoint':
      return [{ t: 0, rate: 1 }, { t: d, rate }];
    case 'spike': {
      const base = Math.max(10, Math.round(rate * 0.05));
      return [
        { t: 0, rate: base }, { t: 20, rate: base }, { t: 25, rate },
        { t: 25 + d, rate }, { t: 30 + d, rate: base }, { t: 50 + d, rate: base },
      ];
    }
    default:
      return [];
  }
}
